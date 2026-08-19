/*
 * File: services/core-service/src/CoreService.Application/Payments/Services/PaymentCheckoutWorkflowService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi del dominio Payments
 * relativi al workflow di checkout del pagamento digitale,
 * comprendendo la creazione del Payment Intent
 * e l'avvio dell'elaborazione del pagamento tramite provider.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Payments
 * e coordina i workflow che consentono al paziente autenticato di:
 * - creare un Payment Intent associato a un appuntamento pagabile;
 * - riutilizzare un Payment Intent già esistente quando possibile;
 * - inoltrare la richiesta di elaborazione al provider di pagamento;
 * - registrare le transazioni prodotte durante il ciclo di checkout.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare la titolarità dell'appuntamento da parte del paziente corrente.
 * - Verificare che lo stato dell'appuntamento consenta il pagamento.
 * - Creare o riattivare un Payment Intent coerente con l'appuntamento.
 * - Inviare le richieste di creazione ed elaborazione al provider di pagamento.
 * - Persistire Payment Intent e Payment Transaction nel repository pagamenti.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - ISchedulingRepository
 * - IPaymentsRepository
 * - IPaymentProvider
 * - Entità dei domini Payments e Scheduling
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati ai repository e al provider dedicato.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Payments.Providers;
using CoreService.Application.Payments.Repositories;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Payments;
using CoreService.Domain.Scheduling;

namespace CoreService.Application.Payments.Services
{
    public sealed class PaymentCheckoutWorkflowService
    {
        // Repository e provider necessari per validare l'appuntamento,
        // gestire il Payment Intent e dialogare con il provider di pagamento.
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly IPaymentsRepository _paymentsRepository;
        private readonly IPaymentProvider _paymentProvider;

        /*
         * Inizializza il servizio con tutte le dipendenze necessarie
         * ai workflow di checkout del pagamento digitale.
         */
        public PaymentCheckoutWorkflowService(
            ISchedulingRepository schedulingRepository,
            IPaymentsRepository paymentsRepository,
            IPaymentProvider paymentProvider)
        {
            _schedulingRepository = schedulingRepository
                ?? throw new ArgumentNullException(nameof(schedulingRepository));
            _paymentsRepository = paymentsRepository
                ?? throw new ArgumentNullException(nameof(paymentsRepository));
            _paymentProvider = paymentProvider
                ?? throw new ArgumentNullException(nameof(paymentProvider));
        }

        /*
         * Crea un Payment Intent per un appuntamento del paziente corrente,
         * oppure restituisce quello già esistente se ancora utilizzabile.
         */
        public async Task<OperationResult<PaymentIntentDto>> CreatePaymentIntentForAppointmentAsync(
            Guid patientUserId,
            Guid appointmentId,
            CreatePaymentIntentForAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            // Recupera l'appuntamento per verificarne esistenza e appartenenza al paziente corrente.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment is null || appointment.PatientUserId != patientUserId)
            {
                return OperationResult<PaymentIntentDto>.NotFound(
                    "appointment_not_found",
                    "L'appuntamento specificato non esiste oppure non appartiene all'utente corrente.");
            }

            // Il pagamento digitale può essere avviato solo per appuntamenti in stati compatibili.
            if (!IsPaymentAllowedAppointmentStatus(appointment.Status))
            {
                return OperationResult<PaymentIntentDto>.Conflict(
                    "invalid_appointment_status_for_payment",
                    "È possibile generare un pagamento solo per appuntamenti in stato 'Booked', 'CheckedIn' o 'Completed'.");
            }

            // Determina l'importo del pagamento usando, se presente, il valore richiesto dal client,
            // altrimenti il prezzo quotato dell'appuntamento.
            var amountCents = request?.AmountCents ?? appointment.QuotedPriceCents;
            if (amountCents <= 0)
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "invalid_amount",
                    "L'importo del pagamento deve essere strettamente positivo.");
            }

            // Verifica se esiste già un Payment Intent associato all'appuntamento.
            var existingIntent = await _paymentsRepository
                .GetIntentByAppointmentIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            // Se esiste già un intent non annullato, lo restituisce direttamente
            // evitando la creazione duplicata di nuovi intent.
            if (existingIntent is not null && existingIntent.Status != PaymentStatus.Canceled)
            {
                return OperationResult<PaymentIntentDto>.Success(MapToIntentDto(existingIntent));
            }

            var nowUtc = DateTime.UtcNow;
            var idempotencyKey = existingIntent?.IdempotencyKey;

            // Genera o riutilizza una chiave di idempotenza stabile per l'appuntamento.
            if (string.IsNullOrWhiteSpace(idempotencyKey))
            {
                idempotencyKey = $"appointment:{appointmentId}";
            }

            // Richiede al provider la creazione del Payment Intent remoto.
            var providerResult = await _paymentProvider
                .CreateIntentAsync(amountCents, appointment.Currency, idempotencyKey, cancellationToken)
                .ConfigureAwait(false);

            PaymentIntent intent;
            if (existingIntent is null)
            {
                // Crea un nuovo Payment Intent locale se non esisteva alcun record precedente.
                intent = new PaymentIntent
                {
                    Id = Guid.NewGuid(),
                    AppointmentId = appointmentId,
                    AmountCents = amountCents,
                    Currency = appointment.Currency,
                    Status = providerResult.InitialStatus,
                    Provider = providerResult.Provider,
                    ProviderIntentId = providerResult.ProviderIntentId,
                    IdempotencyKey = idempotencyKey,
                    CreatedAtUtc = nowUtc,
                    UpdatedAtUtc = nowUtc
                };

                await _paymentsRepository
                    .AddIntentAsync(intent, cancellationToken)
                    .ConfigureAwait(false);
            }
            else
            {
                // Riattiva e aggiorna l'intent annullato precedente,
                // mantenendo la continuità logica del pagamento associato all'appuntamento.
                intent = existingIntent;
                intent.AmountCents = amountCents;
                intent.Currency = appointment.Currency;
                intent.Status = providerResult.InitialStatus;
                intent.Provider = providerResult.Provider;
                intent.ProviderIntentId = providerResult.ProviderIntentId;
                intent.UpdatedAtUtc = nowUtc;

                await _paymentsRepository
                    .UpdateIntentAsync(intent, cancellationToken)
                    .ConfigureAwait(false);
            }

            // Registra la transazione tecnica iniziale prodotta dalla creazione del Payment Intent.
            var creationTransaction = new PaymentTransaction
            {
                Id = Guid.NewGuid(),
                IntentId = intent.Id,
                ProviderTransactionId = providerResult.ProviderTransactionId,
                Status = providerResult.InitialStatus,
                AmountCents = intent.AmountCents,
                ProcessedAtUtc = nowUtc,
                RawResponseJson = providerResult.RawResponseJson
            };

            await _paymentsRepository
                .AddTransactionAsync(creationTransaction, cancellationToken)
                .ConfigureAwait(false);

            return OperationResult<PaymentIntentDto>.Success(MapToIntentDto(intent));
        }

        /*
         * Avvia l'elaborazione di un Payment Intent esistente
         * tramite il provider configurato.
         */
        public async Task<OperationResult<PaymentIntentDto>> ProcessPaymentAsync(
            Guid patientUserId,
            Guid intentId,
            ProcessPaymentRequest? request,
            CancellationToken cancellationToken)
        {
            // Recupera il Payment Intent richiesto.
            var intent = await _paymentsRepository
                .GetIntentByIdAsync(intentId, cancellationToken)
                .ConfigureAwait(false);

            if (intent is null)
            {
                return OperationResult<PaymentIntentDto>.NotFound(
                    "payment_intent_not_found",
                    "Il PaymentIntent specificato non esiste.");
            }

            // Recupera l'appuntamento associato e ne verifica la titolarità rispetto al paziente corrente.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(intent.AppointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment is null || appointment.PatientUserId != patientUserId)
            {
                return OperationResult<PaymentIntentDto>.NotFound(
                    "appointment_not_found",
                    "L'appuntamento associato non esiste oppure non appartiene all'utente corrente.");
            }

            // Il workflow di elaborazione è disponibile solo per il provider simulato.
            if (!string.Equals(intent.Provider, "SIMULATED", StringComparison.OrdinalIgnoreCase))
            {
                return OperationResult<PaymentIntentDto>.Conflict(
                    "unsupported_provider_for_processing",
                    "Il PaymentIntent corrente non è gestito dal provider digitale simulato.");
            }

            // Impedisce di avviare nuovamente un pagamento già in corso.
            if (intent.Status == PaymentStatus.Pending)
            {
                return OperationResult<PaymentIntentDto>.Conflict(
                    "payment_already_processing",
                    "Il pagamento risulta già in elaborazione.");
            }

            // Impedisce di rielaborare un pagamento già finalizzato.
            if (intent.Status is PaymentStatus.Succeeded or PaymentStatus.Canceled)
            {
                return OperationResult<PaymentIntentDto>.Conflict(
                    "payment_already_finalized",
                    "Il pagamento risulta già finalizzato.");
            }

            // Delega al provider la fase di elaborazione effettiva del Payment Intent.
            var providerResult = await _paymentProvider
                .ProcessIntentAsync(
                    intent.ProviderIntentId,
                    intent.AmountCents,
                    intent.Currency,
                    request?.Method,
                    cancellationToken)
                .ConfigureAwait(false);

            var nowUtc = DateTime.UtcNow;

            // Registra la transazione prodotta dall'elaborazione del pagamento.
            var processingTransaction = new PaymentTransaction
            {
                Id = Guid.NewGuid(),
                IntentId = intent.Id,
                ProviderTransactionId = providerResult.ProviderTransactionId,
                Status = providerResult.Status,
                AmountCents = intent.AmountCents,
                ProcessedAtUtc = nowUtc,
                RawResponseJson = providerResult.RawResponseJson
            };

            // Aggiorna lo stato del Payment Intent in coerenza con l'esito restituito dal provider.
            intent.Status = providerResult.Status;
            intent.UpdatedAtUtc = nowUtc;

            await _paymentsRepository
                .AddTransactionAsync(processingTransaction, cancellationToken)
                .ConfigureAwait(false);

            await _paymentsRepository
                .UpdateIntentAsync(intent, cancellationToken)
                .ConfigureAwait(false);

            return OperationResult<PaymentIntentDto>.Success(MapToIntentDto(intent));
        }

        /*
         * Determina se lo stato dell'appuntamento consente l'avvio del pagamento.
         */
        private static bool IsPaymentAllowedAppointmentStatus(AppointmentStatus status)
        {
            return status is AppointmentStatus.Booked or AppointmentStatus.CheckedIn or AppointmentStatus.Completed;
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
    }
}
