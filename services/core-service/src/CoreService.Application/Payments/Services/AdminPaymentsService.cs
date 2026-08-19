/*
 * File: services/core-service/src/CoreService.Application/Payments/Services/AdminPaymentsService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi amministrativi del dominio Payments,
 * includendo consultazione dei Payment Intent, consultazione delle transazioni,
 * registrazione di pagamenti in presenza, riconciliazione amministrativa
 * e simulazione dell'esito del provider di pagamento.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Payments
 * e coordina i workflow che consentono all'amministratore di:
 * - consultare i Payment Intent con filtri temporali e di stato;
 * - recuperare il dettaglio delle transazioni associate a un Payment Intent;
 * - registrare un pagamento effettuato in presenza;
 * - forzare una riconciliazione amministrativa dello stato del pagamento;
 * - simulare l'esito del provider per i pagamenti digitali simulati.
 *
 * Responsabilità principali
 * -------------------------
 * - Normalizzare e validare i filtri temporali richiesti.
 * - Recuperare e aggregare Payment Intent e Payment Transaction.
 * - Validare lo stato degli appuntamenti e dei pagamenti.
 * - Aggiornare Payment Intent e Payment Transaction in coerenza con il workflow.
 * - Delegare la simulazione provider al servizio webhook dedicato.
 * - Pianificare le notifiche collegate agli esiti di pagamento.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - ISchedulingRepository
 * - IPaymentsRepository
 * - PaymentWebhookService
 * - NotificationSchedulingService
 * - Entità dei domini Payments e Scheduling
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati ai repository e servizi dedicati.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Events.Services;
using CoreService.Application.Payments.Repositories;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Payments;
using CoreService.Domain.Scheduling;

namespace CoreService.Application.Payments.Services
{
    public sealed class AdminPaymentsService
    {
        // Repository e servizi necessari ai workflow amministrativi
        // di consultazione e gestione dei pagamenti.
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly IPaymentsRepository _paymentsRepository;
        private readonly PaymentWebhookService _paymentWebhookService;
        private readonly NotificationSchedulingService _notificationSchedulingService;

        /*
         * Inizializza il servizio con tutte le dipendenze necessarie
         * ai casi d'uso amministrativi del dominio Payments.
         */
        public AdminPaymentsService(
            ISchedulingRepository schedulingRepository,
            IPaymentsRepository paymentsRepository,
            PaymentWebhookService paymentWebhookService,
            NotificationSchedulingService notificationSchedulingService)
        {
            _schedulingRepository = schedulingRepository
                ?? throw new ArgumentNullException(nameof(schedulingRepository));
            _paymentsRepository = paymentsRepository
                ?? throw new ArgumentNullException(nameof(paymentsRepository));
            _paymentWebhookService = paymentWebhookService
                ?? throw new ArgumentNullException(nameof(paymentWebhookService));
            _notificationSchedulingService = notificationSchedulingService
                ?? throw new ArgumentNullException(nameof(notificationSchedulingService));
        }

        /*
         * Recupera l'elenco dei Payment Intent secondo i filtri richiesti,
         * arricchendo ciascun risultato con le informazioni dell'ultima transazione disponibile.
         */
        public async Task<OperationResult<IReadOnlyList<AdminPaymentIntentDto>>> GetPaymentIntentsAsync(
            DateTime? fromUtc,
            DateTime? toUtc,
            string? status,
            string? provider,
            CancellationToken cancellationToken)
        {
            // Normalizza l'intervallo temporale secondo le regole applicative del servizio.
            NormalizeToUtcRange(ref fromUtc, ref toUtc);

            // Valida la coerenza dell'intervallo temporale.
            if (toUtc <= fromUtc)
            {
                return OperationResult<IReadOnlyList<AdminPaymentIntentDto>>.BadRequest(
                    "invalid_date_range",
                    "Il parametro 'toUtc' deve essere strettamente maggiore di 'fromUtc'.");
            }

            // Converte opzionalmente il filtro di stato nella corrispondente enum di dominio.
            PaymentStatus? parsedStatus = null;
            if (!string.IsNullOrWhiteSpace(status))
            {
                if (!Enum.TryParse<PaymentStatus>(status, ignoreCase: true, out var tmpStatus))
                {
                    return OperationResult<IReadOnlyList<AdminPaymentIntentDto>>.BadRequest(
                        "invalid_status",
                        "Il valore dello stato di pagamento specificato non è valido.");
                }

                parsedStatus = tmpStatus;
            }

            // Recupera i Payment Intent filtrati.
            var intents = await _paymentsRepository
                .GetIntentsByFilterAsync(fromUtc, toUtc, parsedStatus, provider, cancellationToken)
                .ConfigureAwait(false);

            var result = new List<AdminPaymentIntentDto>(intents.Count);

            // Per ciascun intent recupera la transazione più recente,
            // così da esporre all'amministratore un riepilogo arricchito.
            foreach (var intent in intents)
            {
                var transactions = await _paymentsRepository
                    .GetTransactionsForIntentAsync(intent.Id, cancellationToken)
                    .ConfigureAwait(false);

                var lastTransaction = transactions
                    .OrderByDescending(t => t.ProcessedAtUtc)
                    .FirstOrDefault();

                var dto = new AdminPaymentIntentDto(
                    intent.Id,
                    intent.AppointmentId,
                    intent.AmountCents,
                    intent.Currency,
                    intent.Status.ToString(),
                    intent.Provider,
                    intent.ProviderIntentId,
                    intent.IdempotencyKey,
                    intent.CreatedAtUtc,
                    intent.UpdatedAtUtc,
                    lastTransaction?.Id,
                    lastTransaction?.Status.ToString(),
                    lastTransaction?.ProcessedAtUtc,
                    lastTransaction?.AmountCents);

                result.Add(dto);
            }

            return OperationResult<IReadOnlyList<AdminPaymentIntentDto>>.Success(result.AsReadOnly());
        }

        /*
         * Recupera tutte le transazioni associate a un Payment Intent,
         * ordinate cronologicamente per data di elaborazione.
         */
        public async Task<OperationResult<IReadOnlyList<PaymentTransactionDto>>> GetTransactionsForIntentAsync(
            Guid intentId,
            CancellationToken cancellationToken)
        {
            // Verifica preliminarmente che il Payment Intent esista.
            var intent = await _paymentsRepository
                .GetIntentByIdAsync(intentId, cancellationToken)
                .ConfigureAwait(false);

            if (intent is null)
            {
                return OperationResult<IReadOnlyList<PaymentTransactionDto>>.NotFound(
                    "payment_intent_not_found",
                    "Il PaymentIntent specificato non esiste.");
            }

            // Recupera le transazioni associate al Payment Intent.
            var transactions = await _paymentsRepository
                .GetTransactionsForIntentAsync(intentId, cancellationToken)
                .ConfigureAwait(false);

            var result = transactions
                .OrderBy(t => t.ProcessedAtUtc)
                .Select(MapToTransactionDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<PaymentTransactionDto>>.Success(result);
        }

        /*
         * Registra amministrativamente un pagamento effettuato in presenza
         * per un appuntamento valido e pagabile.
         */
        public async Task<OperationResult<PaymentIntentDto>> RegisterInPersonPaymentAsync(
            Guid appointmentId,
            RegisterInPersonPaymentRequest? request,
            CancellationToken cancellationToken)
        {
            // Recupera l'appuntamento su cui registrare il pagamento.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment is null)
            {
                return OperationResult<PaymentIntentDto>.NotFound(
                    "appointment_not_found",
                    "L'appuntamento specificato non esiste.");
            }

            // Impedisce la registrazione di pagamenti per appuntamenti non più pagabili.
            if (appointment.Status is AppointmentStatus.Canceled or AppointmentStatus.NoShow)
            {
                return OperationResult<PaymentIntentDto>.Conflict(
                    "appointment_not_payable",
                    "Non è possibile registrare un pagamento per un appuntamento annullato o marcato come assente.");
            }

            // Se non viene specificato un importo, usa il prezzo quotato dell'appuntamento.
            var amount = request?.AmountCents ?? appointment.QuotedPriceCents;
            if (amount <= 0)
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "invalid_amount",
                    "L'importo del pagamento deve essere strettamente positivo.");
            }

            // Verifica se per l'appuntamento esiste già un Payment Intent.
            var existingIntent = await _paymentsRepository
                .GetIntentByAppointmentIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            var now = DateTime.UtcNow;

            PaymentIntent intent;
            if (existingIntent is null)
            {
                // In assenza di intent preesistente, ne crea uno nuovo già in stato Succeeded.
                intent = new PaymentIntent
                {
                    Id = Guid.NewGuid(),
                    AppointmentId = appointmentId,
                    AmountCents = amount,
                    Currency = appointment.Currency,
                    Status = PaymentStatus.Succeeded,
                    Provider = "SIMULATED",
                    ProviderIntentId = $"pi_pos_{Guid.NewGuid():N}",
                    IdempotencyKey = $"appointment:{appointmentId}:in-person",
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now
                };

                await _paymentsRepository
                    .AddIntentAsync(intent, cancellationToken)
                    .ConfigureAwait(false);
            }
            else
            {
                // Se l'intent esiste già, lo aggiorna per riflettere il pagamento in presenza registrato.
                intent = existingIntent;
                intent.AmountCents = amount;
                intent.Status = PaymentStatus.Succeeded;
                intent.UpdatedAtUtc = now;

                await _paymentsRepository
                    .UpdateIntentAsync(intent, cancellationToken)
                    .ConfigureAwait(false);
            }

            // Determina il metodo di pagamento da tracciare nel payload della transazione.
            var method = string.IsNullOrWhiteSpace(request?.Method)
                ? "IN_PERSON"
                : request.Method!.Trim();

            var payload = new
            {
                channel = "IN_PERSON",
                method,
                simulated = true,
                status = "SUCCEEDED"
            };

            // Registra una transazione coerente con il pagamento amministrativo in presenza.
            var transaction = new PaymentTransaction
            {
                Id = Guid.NewGuid(),
                IntentId = intent.Id,
                ProviderTransactionId = $"tx_pos_{Guid.NewGuid():N}",
                Status = PaymentStatus.Succeeded,
                AmountCents = amount,
                ProcessedAtUtc = now,
                RawResponseJson = JsonSerializer.Serialize(payload)
            };

            await _paymentsRepository
                .AddTransactionAsync(transaction, cancellationToken)
                .ConfigureAwait(false);

            // Pianifica la notifica di pagamento riuscito.
            await _notificationSchedulingService
                .SchedulePaymentSucceededNotificationAsync(
                    appointment,
                    intent,
                    inPerson: true,
                    cancellationToken)
                .ConfigureAwait(false);

            var dto = MapToIntentDto(intent);

            return OperationResult<PaymentIntentDto>.Success(dto);
        }

        /*
         * Applica una riconciliazione amministrativa forzando lo stato di un Payment Intent
         * e registrando una nuova transazione tecnica di riconciliazione.
         */
        public async Task<OperationResult<PaymentIntentDto>> ReconcilePaymentAsync(
            Guid intentId,
            ReconcilePaymentRequest? request,
            CancellationToken cancellationToken)
        {
            // Il nuovo stato deve essere esplicitamente specificato.
            if (request is null || string.IsNullOrWhiteSpace(request.NewStatus))
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "status_missing",
                    "È necessario specificare il nuovo stato del pagamento.");
            }

            // Valida il nuovo stato richiesto.
            if (!Enum.TryParse<PaymentStatus>(request.NewStatus, ignoreCase: true, out var newStatus))
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "invalid_status",
                    "Il valore dello stato di pagamento specificato non è valido.");
            }

            // Recupera il Payment Intent da riconciliare.
            var intent = await _paymentsRepository
                .GetIntentByIdAsync(intentId, cancellationToken)
                .ConfigureAwait(false);

            if (intent is null)
            {
                return OperationResult<PaymentIntentDto>.NotFound(
                    "payment_intent_not_found",
                    "Il PaymentIntent specificato non esiste.");
            }

            // Recupera opzionalmente l'appuntamento associato per la generazione delle notifiche.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(intent.AppointmentId, cancellationToken)
                .ConfigureAwait(false);

            var now = DateTime.UtcNow;

            var payload = new
            {
                channel = "RECONCILIATION",
                simulated = true,
                status = newStatus.ToString().ToUpperInvariant()
            };

            // Registra una nuova transazione che traccia la riconciliazione amministrativa.
            var transaction = new PaymentTransaction
            {
                Id = Guid.NewGuid(),
                IntentId = intent.Id,
                ProviderTransactionId = $"tx_rec_{Guid.NewGuid():N}",
                Status = newStatus,
                AmountCents = intent.AmountCents,
                ProcessedAtUtc = now,
                RawResponseJson = JsonSerializer.Serialize(payload)
            };

            // Aggiorna lo stato dell'intent in modo coerente con la riconciliazione.
            intent.Status = newStatus;
            intent.UpdatedAtUtc = now;

            await _paymentsRepository
                .AddTransactionAsync(transaction, cancellationToken)
                .ConfigureAwait(false);

            await _paymentsRepository
                .UpdateIntentAsync(intent, cancellationToken)
                .ConfigureAwait(false);

            // Se l'appuntamento esiste, notifica l'esito amministrativamente riconciliato.
            if (appointment != null)
            {
                if (newStatus == PaymentStatus.Succeeded)
                {
                    await _notificationSchedulingService
                        .SchedulePaymentSucceededNotificationAsync(
                            appointment,
                            intent,
                            inPerson: true,
                            cancellationToken)
                        .ConfigureAwait(false);
                }
                else if (newStatus == PaymentStatus.Failed)
                {
                    await _notificationSchedulingService
                        .SchedulePaymentFailedNotificationAsync(
                            appointment,
                            intent,
                            inPerson: true,
                            cancellationToken)
                        .ConfigureAwait(false);
                }
            }

            var dto = MapToIntentDto(intent);

            return OperationResult<PaymentIntentDto>.Success(dto);
        }

        /*
         * Simula l'esito del provider di pagamento per un Payment Intent digitale simulato,
         * delegando la logica di aggiornamento al servizio webhook dedicato.
         */
        public async Task<OperationResult<PaymentIntentDto>> SimulateProviderOutcomeAsync(
            Guid intentId,
            SimulateProviderOutcomeRequest? request,
            CancellationToken cancellationToken)
        {
            // L'esito da simulare deve essere esplicitamente fornito.
            if (request is null || string.IsNullOrWhiteSpace(request.Outcome))
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "outcome_missing",
                    "È necessario specificare l'esito da simulare.");
            }

            // Recupera il Payment Intent da aggiornare tramite simulazione.
            var intent = await _paymentsRepository
                .GetIntentByIdAsync(intentId, cancellationToken)
                .ConfigureAwait(false);

            if (intent is null)
            {
                return OperationResult<PaymentIntentDto>.NotFound(
                    "payment_intent_not_found",
                    "Il PaymentIntent specificato non esiste.");
            }

            // La simulazione è ammessa solo per il provider simulato.
            if (!string.Equals(intent.Provider, "SIMULATED", StringComparison.OrdinalIgnoreCase))
            {
                return OperationResult<PaymentIntentDto>.Conflict(
                    "unsupported_provider",
                    "La simulazione dell'esito è disponibile solo per il provider digitale simulato.");
            }

            var currentStatus = intent.Status;

            // Non consente di simulare nuovamente un pagamento già finalizzato.
            if (currentStatus == PaymentStatus.Succeeded ||
                currentStatus == PaymentStatus.Failed ||
                currentStatus == PaymentStatus.Canceled)
            {
                return OperationResult<PaymentIntentDto>.Conflict(
                    "payment_already_finalized",
                    "Il PaymentIntent risulta già finalizzato.");
            }

            string normalizedOutcome = request.Outcome.Trim();
            string eventType;
            string? failureReason = null;

            // Traduce l'input amministrativo nel corrispondente event type del webhook simulato.
            if (string.Equals(normalizedOutcome, "Succeeded", StringComparison.OrdinalIgnoreCase))
            {
                eventType = "payment.succeeded";
            }
            else if (string.Equals(normalizedOutcome, "Failed", StringComparison.OrdinalIgnoreCase))
            {
                eventType = "payment.failed";
                failureReason = "Simulated provider failure triggered by admin.";
            }
            else if (string.Equals(normalizedOutcome, "Canceled", StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(normalizedOutcome, "Cancelled", StringComparison.OrdinalIgnoreCase))
            {
                eventType = "payment.canceled";
            }
            else
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "invalid_outcome",
                    "Il valore di Outcome non è supportato.");
            }

            // Costruisce la richiesta di webhook simulato e la inoltra al servizio dedicato.
            var webhookRequest = new SimulatedPaymentWebhookRequest(
                ProviderIntentId: intent.ProviderIntentId,
                EventType: eventType,
                AmountCents: intent.AmountCents,
                ProviderTransactionId: null,
                Method: "CARD",
                FailureReason: failureReason);

            var result = await _paymentWebhookService
                .HandleSimulatedWebhookAsync(webhookRequest, cancellationToken)
                .ConfigureAwait(false);

            return result;
        }

        /*
         * Converte un'entità PaymentIntent del dominio
         * nel corrispondente DTO applicativo.
         */
        private static PaymentIntentDto MapToIntentDto(PaymentIntent intent)
        {
            return new PaymentIntentDto(
                intent.Id,
                intent.AppointmentId,
                intent.AmountCents,
                intent.Currency,
                intent.Status.ToString(),
                intent.Provider,
                intent.ProviderIntentId,
                intent.IdempotencyKey,
                intent.CreatedAtUtc,
                intent.UpdatedAtUtc);
        }

        /*
         * Converte un'entità PaymentTransaction del dominio
         * nel corrispondente DTO applicativo.
         */
        private static PaymentTransactionDto MapToTransactionDto(PaymentTransaction tx)
        {
            return new PaymentTransactionDto(
                tx.Id,
                tx.IntentId,
                tx.ProviderTransactionId,
                tx.Status.ToString(),
                tx.AmountCents,
                tx.ProcessedAtUtc,
                tx.RawResponseJson
            );
        }

        /*
         * Normalizza l'intervallo temporale di ricerca dei Payment Intent.
         *
         * Regole applicate:
         * - se entrambi gli estremi sono null, usa [-30 giorni, +1 giorno] rispetto a oggi;
         * - se manca solo fromUtc, usa toUtc - 30 giorni;
         * - se manca solo toUtc, usa fromUtc + 30 giorni.
         */
        private static void NormalizeToUtcRange(
            ref DateTime? fromUtc,
            ref DateTime? toUtc)
        {
            if (fromUtc is null && toUtc is null)
            {
                var now = DateTime.UtcNow;
                fromUtc = now.Date.AddDays(-30);
                toUtc = now.Date.AddDays(1);
                return;
            }

            if (fromUtc is null && toUtc is not null)
            {
                fromUtc = toUtc.Value.AddDays(-30);
                return;
            }

            if (fromUtc is not null && toUtc is null)
            {
                toUtc = fromUtc.Value.AddDays(30);
            }
        }
    }
}
