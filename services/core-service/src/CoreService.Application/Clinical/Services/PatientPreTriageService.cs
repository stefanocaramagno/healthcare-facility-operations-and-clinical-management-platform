/*
 * File: services/core-service/src/CoreService.Application/Clinical/Services/PatientPreTriageService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi alla consultazione
 * e alla compilazione del questionario di pre-triage da parte del paziente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Clinical
 * e coordina i workflow che consentono al paziente autenticato di:
 * - consultare il questionario di pre-triage associato a una prenotazione;
 * - creare o aggiornare il questionario di pre-triage;
 * - operare solo su prenotazioni proprie e attive.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare il payload relativo al questionario di pre-triage.
 * - Verificare che la prenotazione esista, appartenga al paziente e sia in stato valido.
 * - Recuperare un questionario già esistente.
 * - Creare o aggiornare un questionario di pre-triage.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - ISchedulingRepository
 * - IPreTriageQuestionnaireRepository
 * - Entità dei domini Clinical e Scheduling
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati ai repository dedicati.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Clinical.Repositories;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Clinical;
using CoreService.Domain.Scheduling;

namespace CoreService.Application.Clinical.Services
{
    public sealed class PatientPreTriageService
    {
        // Repository necessari alla validazione della prenotazione
        // e alla gestione del questionario di pre-triage.
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly IPreTriageQuestionnaireRepository _preTriageRepository;

        /*
         * Inizializza il servizio con le dipendenze necessarie
         * ai workflow di consultazione e salvataggio del pre-triage paziente.
         */
        public PatientPreTriageService(
            ISchedulingRepository schedulingRepository,
            IPreTriageQuestionnaireRepository preTriageRepository)
        {
            _schedulingRepository = schedulingRepository
                ?? throw new ArgumentNullException(nameof(schedulingRepository));
            _preTriageRepository = preTriageRepository
                ?? throw new ArgumentNullException(nameof(preTriageRepository));
        }

        /*
         * Recupera il questionario di pre-triage associato a una prenotazione,
         * dopo aver verificato che la prenotazione sia valida e appartenga al paziente corrente.
         */
        public async Task<OperationResult<PreTriageQuestionnaireDto>> GetForAppointmentAsync(
            Guid patientUserId,
            Guid appointmentId,
            CancellationToken cancellationToken)
        {
            // Verifica preliminarmente che la prenotazione esista,
            // appartenga al paziente e sia in uno stato compatibile con il pre-triage.
            var appointmentResult = await ValidateAppointmentForPatientAsync(
                    patientUserId,
                    appointmentId,
                    cancellationToken)
                .ConfigureAwait(false);

            if (!appointmentResult.IsSuccess)
            {
                return OperationResult<PreTriageQuestionnaireDto>.Failure(
                    appointmentResult.StatusCode,
                    appointmentResult.ErrorCode ?? "pretriage_appointment_invalid",
                    appointmentResult.ErrorMessage ?? "La prenotazione indicata non è valida per il questionario di pre-triage.");
            }

            // Recupera l'eventuale questionario già associato alla prenotazione.
            var questionnaire = await _preTriageRepository
                .GetByAppointmentIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (questionnaire == null)
            {
                return OperationResult<PreTriageQuestionnaireDto>.NotFound(
                    "pretriage_not_found",
                    "Per questa prenotazione non è stato ancora compilato alcun questionario di pre-triage.");
            }

            return OperationResult<PreTriageQuestionnaireDto>.Success(MapToDto(questionnaire));
        }

        /*
         * Crea oppure aggiorna il questionario di pre-triage associato a una prenotazione,
         * dopo aver validato il contenuto e la prenotazione di riferimento.
         */
        public async Task<OperationResult<PreTriageQuestionnaireDto>> UpsertForAppointmentAsync(
            Guid patientUserId,
            Guid appointmentId,
            UpsertPreTriageQuestionnaireRequest request,
            CancellationToken cancellationToken)
        {
            // Il payload deve essere presente per poter creare o aggiornare il questionario.
            if (request == null)
            {
                return OperationResult<PreTriageQuestionnaireDto>.BadRequest(
                    "invalid_payload",
                    "Il payload della richiesta non può essere nullo.");
            }

            var content = request.Content?.Trim() ?? string.Empty;

            // Il contenuto del questionario non può essere vuoto o composto solo da spazi.
            if (string.IsNullOrWhiteSpace(content))
            {
                return OperationResult<PreTriageQuestionnaireDto>.BadRequest(
                    "empty_content",
                    "È necessario fornire un contenuto non vuoto per il questionario di pre-triage.");
            }

            // Verifica preliminarmente che la prenotazione esista,
            // appartenga al paziente e sia in uno stato compatibile con il pre-triage.
            var appointmentResult = await ValidateAppointmentForPatientAsync(
                    patientUserId,
                    appointmentId,
                    cancellationToken)
                .ConfigureAwait(false);

            if (!appointmentResult.IsSuccess)
            {
                return OperationResult<PreTriageQuestionnaireDto>.Failure(
                    appointmentResult.StatusCode,
                    appointmentResult.ErrorCode ?? "pretriage_appointment_invalid",
                    appointmentResult.ErrorMessage ?? "La prenotazione indicata non è valida per il questionario di pre-triage.");
            }

            var nowUtc = DateTime.UtcNow;

            // Recupera l'eventuale questionario già presente per capire
            // se l'operazione debba creare una nuova entità o aggiornare quella esistente.
            var existing = await _preTriageRepository
                .GetByAppointmentIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (existing == null)
            {
                var questionnaire = new PreTriageQuestionnaire
                {
                    Id = Guid.NewGuid(),
                    AppointmentId = appointmentId,
                    PatientUserId = patientUserId,
                    Content = content,
                    CreatedAtUtc = nowUtc,
                    UpdatedAtUtc = nowUtc
                };

                await _preTriageRepository
                    .AddAsync(questionnaire, cancellationToken)
                    .ConfigureAwait(false);

                return OperationResult<PreTriageQuestionnaireDto>.Success(MapToDto(questionnaire));
            }
            else
            {
                existing.Content = content;
                existing.UpdatedAtUtc = nowUtc;

                await _preTriageRepository
                    .UpdateAsync(existing, cancellationToken)
                    .ConfigureAwait(false);

                return OperationResult<PreTriageQuestionnaireDto>.Success(MapToDto(existing));
            }
        }

        /*
         * Converte un'entità PreTriageQuestionnaire del dominio
         * nel corrispondente DTO applicativo.
         */
        private static PreTriageQuestionnaireDto MapToDto(PreTriageQuestionnaire entity)
        {
            return new PreTriageQuestionnaireDto(
                entity.AppointmentId,
                entity.Content,
                entity.CreatedAtUtc,
                entity.UpdatedAtUtc
            );
        }

        /*
         * Verifica che la prenotazione indicata sia valida per il paziente corrente
         * e che si trovi in uno stato che consenta consultazione o compilazione del pre-triage.
         */
        private async Task<OperationResult<Appointment>> ValidateAppointmentForPatientAsync(
            Guid patientUserId,
            Guid appointmentId,
            CancellationToken cancellationToken)
        {
            // L'identificativo della prenotazione deve essere valido.
            if (appointmentId == Guid.Empty)
            {
                return OperationResult<Appointment>.BadRequest(
                    "invalid_appointment_id",
                    "È necessario specificare un identificativo di prenotazione valido.");
            }

            // Recupera la prenotazione dal repository di scheduling.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment == null)
            {
                return OperationResult<Appointment>.NotFound(
                    "appointment_not_found",
                    "La prenotazione indicata non esiste.");
            }

            // Il paziente può operare soltanto su prenotazioni di propria competenza.
            if (appointment.PatientUserId != patientUserId)
            {
                return OperationResult<Appointment>.Forbidden(
                    "appointment_forbidden",
                    "Il paziente corrente non è autorizzato ad accedere a questa prenotazione.");
            }

            // Il pre-triage è consentito solo per prenotazioni attive,
            // cioè ancora prenotate oppure già accettate/check-in.
            if (appointment.Status != AppointmentStatus.Booked &&
                appointment.Status != AppointmentStatus.CheckedIn)
            {
                return OperationResult<Appointment>.BadRequest(
                    "appointment_not_active_for_pretriage",
                    "Il questionario di pre-triage può essere compilato solo per prenotazioni attive.");
            }

            return OperationResult<Appointment>.Success(appointment);
        }
    }
}
