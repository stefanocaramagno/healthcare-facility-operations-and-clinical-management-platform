/*
 * File: services/core-service/src/CoreService.Application/Payments/Services/PaymentWebhookService.cs
 *
 * Scopo
 * -----
 * Implementare il workflow applicativo di gestione dei webhook di pagamento
 * provenienti dal provider simulato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Payments
 * e coordina il trattamento degli eventi di webhook relativi ai pagamenti digitali,
 * traducendo l'esito ricevuto dal provider simulato
 * nell'aggiornamento coerente di PaymentIntent e PaymentTransaction,
 * oltre alla pianificazione delle notifiche collegate all'esito del pagamento.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare il payload del webhook ricevuto.
 * - Recuperare il PaymentIntent associato al provider intent.
 * - Verificare la coerenza dell'importo eventualmente ricevuto.
 * - Tradurre l'event type del webhook nello stato finale del pagamento.
 * - Registrare una nuova transazione tecnica derivante dal webhook.
 * - Aggiornare lo stato del PaymentIntent.
 * - Pianificare le notifiche di pagamento riuscito o fallito.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IPaymentsRepository
 * - ISchedulingRepository
 * - NotificationSchedulingService
 * - Entità del dominio Payments
 * - DTO del layer Application
 *
 * Note
 * ----
 * Questo servizio gestisce esclusivamente il provider simulato
 * e applica regole di idempotenza logica rispetto agli stati finali del pagamento.
 */

using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Events.Services;
using CoreService.Application.Payments.Repositories;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Payments;

namespace CoreService.Application.Payments.Services
{
    public sealed class PaymentWebhookService
    {
        // Repository e servizi necessari alla gestione del webhook,
        // all'aggiornamento del pagamento e alla pianificazione delle notifiche.
        private readonly IPaymentsRepository _paymentsRepository;
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly NotificationSchedulingService _notificationSchedulingService;

        /*
         * Inizializza il servizio con tutte le dipendenze necessarie
         * al workflow di gestione dei webhook di pagamento.
         */
        public PaymentWebhookService(
            IPaymentsRepository paymentsRepository,
            ISchedulingRepository schedulingRepository,
            NotificationSchedulingService notificationSchedulingService)
        {
            _paymentsRepository = paymentsRepository
                ?? throw new ArgumentNullException(nameof(paymentsRepository));
            _schedulingRepository = schedulingRepository
                ?? throw new ArgumentNullException(nameof(schedulingRepository));
            _notificationSchedulingService = notificationSchedulingService
                ?? throw new ArgumentNullException(nameof(notificationSchedulingService));
        }

        /*
         * Gestisce un webhook proveniente dal provider simulato,
         * aggiornando PaymentIntent e PaymentTransaction in base all'esito ricevuto.
         */
        public async Task<OperationResult<PaymentIntentDto>> HandleSimulatedWebhookAsync(
            SimulatedPaymentWebhookRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload del webhook è obbligatorio.
            if (request is null)
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "invalid_request",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Il provider intent id è necessario per risalire al PaymentIntent locale.
            if (string.IsNullOrWhiteSpace(request.ProviderIntentId))
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "provider_intent_id_missing",
                    "Il campo ProviderIntentId è obbligatorio.");
            }

            // L'event type è necessario per determinare lo stato finale del pagamento.
            if (string.IsNullOrWhiteSpace(request.EventType))
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "event_type_missing",
                    "Il campo EventType è obbligatorio.");
            }

            // Traduce l'event type ricevuto nello stato finale del dominio pagamenti.
            if (!TryMapEventTypeToFinalStatus(request.EventType, out var finalStatus))
            {
                return OperationResult<PaymentIntentDto>.BadRequest(
                    "invalid_event_type",
                    "Il valore di EventType non è supportato.");
            }

            var providerIntentId = request.ProviderIntentId.Trim();

            // Recupera il PaymentIntent associato al provider simulato e al provider intent id ricevuto.
            var intent = await _paymentsRepository
                .GetIntentByProviderAsync("SIMULATED", providerIntentId, cancellationToken)
                .ConfigureAwait(false);

            if (intent is null)
            {
                return OperationResult<PaymentIntentDto>.NotFound(
                    "payment_intent_not_found",
                    "Nessun PaymentIntent associato al provider intent specificato.");
            }

            // Se il webhook include un importo, ne verifica la coerenza con quello del PaymentIntent.
            if (request.AmountCents.HasValue && request.AmountCents.Value != intent.AmountCents)
            {
                return OperationResult<PaymentIntentDto>.Conflict(
                    "amount_mismatch",
                    "L'importo ricevuto nel webhook non corrisponde all'importo del PaymentIntent.");
            }

            // Se il pagamento è già finalizzato, consente solo una risposta idempotente
            // nel caso in cui il nuovo webhook confermi lo stesso stato finale.
            if (intent.Status is PaymentStatus.Succeeded or PaymentStatus.Failed or PaymentStatus.Canceled)
            {
                if (intent.Status == finalStatus)
                {
                    return OperationResult<PaymentIntentDto>.Success(MapToIntentDto(intent));
                }

                return OperationResult<PaymentIntentDto>.Conflict(
                    "payment_already_finalized",
                    "Il PaymentIntent risulta già finalizzato con uno stato differente.");
            }

            var nowUtc = DateTime.UtcNow;

            // Normalizza gli eventuali metadati opzionali ricevuti dal webhook.
            var normalizedMethod = string.IsNullOrWhiteSpace(request.Method)
                ? null
                : request.Method.Trim();

            var normalizedFailureReason = string.IsNullOrWhiteSpace(request.FailureReason)
                ? null
                : request.FailureReason.Trim();

            // Se il provider transaction id non è presente, ne genera uno tecnico locale.
            var providerTransactionId = string.IsNullOrWhiteSpace(request.ProviderTransactionId)
                ? $"tx_webhook_{Guid.NewGuid():N}"
                : request.ProviderTransactionId.Trim();

            // Costruisce il payload tecnico della transazione derivante dal webhook,
            // utile per audit e tracciabilità.
            var payload = new
            {
                provider = "SIMULATED",
                eventType = request.EventType.Trim(),
                simulated = true,
                providerIntentId,
                providerTransactionId,
                amountCents = intent.AmountCents,
                currency = intent.Currency,
                method = normalizedMethod,
                failureReason = normalizedFailureReason,
                status = finalStatus.ToString().ToUpperInvariant()
            };

            var transaction = new PaymentTransaction
            {
                Id = Guid.NewGuid(),
                IntentId = intent.Id,
                ProviderTransactionId = providerTransactionId,
                Status = finalStatus,
                AmountCents = intent.AmountCents,
                ProcessedAtUtc = nowUtc,
                RawResponseJson = JsonSerializer.Serialize(payload)
            };

            // Aggiorna lo stato del PaymentIntent in base all'esito finale comunicato dal webhook.
            intent.Status = finalStatus;
            intent.UpdatedAtUtc = nowUtc;

            await _paymentsRepository
                .AddTransactionAsync(transaction, cancellationToken)
                .ConfigureAwait(false);

            await _paymentsRepository
                .UpdateIntentAsync(intent, cancellationToken)
                .ConfigureAwait(false);

            // Recupera l'appuntamento associato per poter pianificare le notifiche verso l'utente.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(intent.AppointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment is not null)
            {
                if (finalStatus == PaymentStatus.Succeeded)
                {
                    await _notificationSchedulingService
                        .SchedulePaymentSucceededNotificationAsync(
                            appointment,
                            intent,
                            inPerson: false,
                            cancellationToken)
                        .ConfigureAwait(false);
                }
                else if (finalStatus == PaymentStatus.Failed)
                {
                    await _notificationSchedulingService
                        .SchedulePaymentFailedNotificationAsync(
                            appointment,
                            intent,
                            inPerson: false,
                            cancellationToken)
                        .ConfigureAwait(false);
                }
            }

            return OperationResult<PaymentIntentDto>.Success(MapToIntentDto(intent));
        }

        /*
         * Traduce l'event type ricevuto dal provider simulato
         * nel corrispondente stato finale del dominio Payments.
         */
        private static bool TryMapEventTypeToFinalStatus(
            string eventType,
            out PaymentStatus status)
        {
            status = PaymentStatus.Created;

            switch (eventType.Trim().ToLowerInvariant())
            {
                case "payment.succeeded":
                case "succeeded":
                    status = PaymentStatus.Succeeded;
                    return true;

                case "payment.failed":
                case "failed":
                    status = PaymentStatus.Failed;
                    return true;

                case "payment.canceled":
                case "canceled":
                case "cancelled":
                    status = PaymentStatus.Canceled;
                    return true;

                default:
                    return false;
            }
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
