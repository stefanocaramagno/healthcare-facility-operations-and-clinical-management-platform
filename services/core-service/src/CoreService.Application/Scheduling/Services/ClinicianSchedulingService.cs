/*
 * File: services/core-service/src/CoreService.Application/Scheduling/Services/ClinicianSchedulingService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi del dominio Scheduling
 * relativi alla consultazione dell'agenda del clinico autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Scheduling
 * e coordina i workflow che consentono al clinico
 * di visualizzare i propri appuntamenti nel range temporale richiesto,
 * arricchiti con le informazioni anagrafiche essenziali del paziente.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'agenda del clinico autenticato.
 * - Validare gli input applicativi relativi all'intervallo temporale.
 * - Normalizzare i valori temporali in UTC.
 * - Arricchire gli appuntamenti con il nominativo del paziente.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - ISchedulingRepository
 * - IPatientProfileRepository
 * - Entità dei domini Scheduling e Registry
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
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Common;
using CoreService.Application.Registry.Repositories;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Registry;
using CoreService.Domain.Scheduling;

namespace CoreService.Application.Scheduling.Services
{
    public sealed class ClinicianSchedulingService
    {
        // Repository necessari al recupero degli appuntamenti del clinico
        // e dei profili anagrafici dei pazienti coinvolti.
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly IPatientProfileRepository _patientProfileRepository;

        /*
         * Inizializza il servizio applicativo di scheduling lato clinico
         * con tutte le dipendenze necessarie ai relativi casi d'uso.
         */
        public ClinicianSchedulingService(
            ISchedulingRepository schedulingRepository,
            IPatientProfileRepository patientProfileRepository)
        {
            _schedulingRepository = schedulingRepository
                ?? throw new ArgumentNullException(nameof(schedulingRepository));
            _patientProfileRepository = patientProfileRepository
                ?? throw new ArgumentNullException(nameof(patientProfileRepository));
        }

        /*
         * Recupera l'agenda del clinico autenticato nel range temporale richiesto,
         * arricchendo ciascun appuntamento con il nominativo del paziente associato.
         */
        public async Task<OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>> GetMyAgendaAsync(
            Guid clinicianUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken)
        {
            var nowUtc = DateTime.UtcNow;

            // Normalizza gli estremi temporali opzionali imponendo una semantica UTC esplicita.
            if (!UtcDateTimeInput.TryNormalizeOptional(fromUtc, "fromUtc", out var normalizedFromUtc, out var fromError))
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.BadRequest(
                    "invalid_datetime",
                    fromError!);
            }

            if (!UtcDateTimeInput.TryNormalizeOptional(toUtc, "toUtc", out var normalizedToUtc, out var toError))
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.BadRequest(
                    "invalid_datetime",
                    toError!);
            }

            // Definisce il range temporale effettivo di consultazione.
            var effectiveFrom = normalizedFromUtc ?? nowUtc.AddDays(-7);
            var effectiveTo = normalizedToUtc ?? nowUtc.AddDays(30);

            // Verifica la coerenza dell'intervallo richiesto.
            if (effectiveFrom >= effectiveTo)
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.BadRequest(
                    "invalid_date_range",
                    "Il parametro 'fromUtc' deve essere precedente a 'toUtc'.");
            }

            // Recupera gli appuntamenti del clinico insieme ai relativi slot.
            var items = await _schedulingRepository
                .GetAppointmentsForClinicianWithSlotsAsync(
                    clinicianUserId,
                    effectiveFrom,
                    effectiveTo,
                    cancellationToken)
                .ConfigureAwait(false);

            if (items.Count == 0)
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>
                    .Success(Array.Empty<ClinicianAgendaItemDto>());
            }

            // Cache locale dei profili paziente per evitare accessi ripetuti al repository.
            var patientProfiles = new Dictionary<Guid, PatientProfile>();
            var result = new List<ClinicianAgendaItemDto>(items.Count);

            foreach (var item in items)
            {
                var appointment = item.appointment;
                var slot = item.slot;

                if (!patientProfiles.TryGetValue(appointment.PatientUserId, out var patientProfile))
                {
                    patientProfile = await _patientProfileRepository
                        .GetByUserIdAsync(appointment.PatientUserId, cancellationToken)
                        .ConfigureAwait(false);

                    if (patientProfile != null)
                    {
                        patientProfiles[appointment.PatientUserId] = patientProfile;
                    }
                }

                var patientDisplayName = patientProfile == null
                    ? string.Empty
                    : string.Concat(patientProfile.FirstName, " ", patientProfile.LastName);

                result.Add(new ClinicianAgendaItemDto(
                    appointment.Id,
                    appointment.SlotId,
                    appointment.PatientUserId,
                    patientDisplayName,
                    appointment.ServiceId,
                    appointment.ServiceCode,
                    appointment.Status.ToString(),
                    slot.StartUtc,
                    slot.EndUtc,
                    appointment.Notes));
            }

            return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.Success(result.AsReadOnly());
        }
    }
}
