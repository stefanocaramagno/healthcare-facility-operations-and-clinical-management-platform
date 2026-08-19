/*
 * File: services/core-service/src/CoreService.Application/Payments/Services/PatientPaymentsService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi del dominio Payments
 * relativi alla consultazione dei Payment Intent associati
 * agli appuntamenti del paziente autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Payments
 * e coordina il workflow che consente al paziente di:
 * - individuare gli appuntamenti di propria competenza in un intervallo temporale;
 * - recuperare i Payment Intent associati a tali appuntamenti;
 * - ottenere il risultato in forma di DTO applicativi ordinati temporalmente.
 *
 * Responsabilità principali
 * -------------------------
 * - Normalizzare l'intervallo temporale richiesto.
 * - Validare la coerenza del range temporale.
 * - Recuperare gli appuntamenti del paziente dal dominio Scheduling.
 * - Recuperare i Payment Intent associati agli appuntamenti individuati.
 * - Mappare le entità PaymentIntent nei corrispondenti DTO applicativi.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - ISchedulingRepository
 * - IPaymentsRepository
 * - Entità del dominio Payments
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati ai repository dedicati.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Common;
using CoreService.Application.Payments.Repositories;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Payments;

namespace CoreService.Application.Payments.Services
{
    public sealed class PatientPaymentsService
    {
        // Repository necessari al recupero degli appuntamenti del paziente
        // e dei relativi Payment Intent associati.
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly IPaymentsRepository _paymentsRepository;

        /*
         * Inizializza il servizio con le dipendenze necessarie
         * ai workflow di consultazione pagamenti lato paziente.
         */
        public PatientPaymentsService(
            ISchedulingRepository schedulingRepository,
            IPaymentsRepository paymentsRepository)
        {
            _schedulingRepository = schedulingRepository
                ?? throw new ArgumentNullException(nameof(schedulingRepository));
            _paymentsRepository = paymentsRepository
                ?? throw new ArgumentNullException(nameof(paymentsRepository));
        }

        /*
         * Recupera tutti i Payment Intent associati agli appuntamenti
         * del paziente nel range temporale richiesto.
         */
        public async Task<OperationResult<IReadOnlyList<PaymentIntentDto>>> GetMyPaymentIntentsAsync(
            Guid patientUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken)
        {
            // Normalizza il range temporale, valorizzando eventuali estremi mancanti
            // secondo le regole applicative previste dal servizio.
            NormalizeToUtcRange(ref fromUtc, ref toUtc);

            // Dopo la normalizzazione entrambi gli estremi devono risultare valorizzati.
            if (fromUtc is null || toUtc is null)
            {
                return OperationResult<IReadOnlyList<PaymentIntentDto>>.ServerError(
                    "date_range_normalization_error",
                    "Si è verificato un errore nella normalizzazione dell'intervallo temporale.");
            }

            // Il range temporale deve essere strettamente crescente.
            if (toUtc <= fromUtc)
            {
                return OperationResult<IReadOnlyList<PaymentIntentDto>>.BadRequest(
                    "invalid_date_range",
                    "Il parametro 'toUtc' deve essere strettamente maggiore di 'fromUtc'.");
            }

            // Recupera tutti gli appuntamenti del paziente nel range richiesto,
            // includendo anche gli slot associati.
            var appointmentsWithSlots = await _schedulingRepository
                .GetAppointmentsForPatientWithSlotsAsync(
                    patientUserId,
                    fromUtc.Value,
                    toUtc.Value,
                    cancellationToken)
                .ConfigureAwait(false);

            // Estrae gli identificativi univoci degli appuntamenti
            // per usarli come chiave di ricerca dei Payment Intent.
            var appointmentIds = appointmentsWithSlots
                .Select(x => x.appointment.Id)
                .Distinct()
                .ToArray();

            // Se il paziente non ha appuntamenti nel periodo,
            // restituisce un risultato valido ma vuoto.
            if (appointmentIds.Length == 0)
            {
                return OperationResult<IReadOnlyList<PaymentIntentDto>>.Success(Array.Empty<PaymentIntentDto>());
            }

            // Recupera tutti i Payment Intent associati agli appuntamenti trovati.
            var intents = await _paymentsRepository
                .GetIntentsByAppointmentIdsAsync(appointmentIds, cancellationToken)
                .ConfigureAwait(false);

            // Ordina i Payment Intent per data di creazione
            // e li converte nei DTO destinati ai layer superiori.
            var result = intents
                .OrderBy(x => x.CreatedAtUtc)
                .Select(MapToIntentDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<PaymentIntentDto>>.Success(result);
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
         * Normalizza l'intervallo temporale di ricerca dei Payment Intent.
         *
         * Regole applicate:
         * - se entrambi gli estremi sono null, usa oggi come inizio e +30 giorni come fine;
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
                fromUtc = now.Date;
                toUtc = now.Date.AddDays(30);
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
