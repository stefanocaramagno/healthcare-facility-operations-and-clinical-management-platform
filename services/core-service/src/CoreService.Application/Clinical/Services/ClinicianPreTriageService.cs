/*
 * File: services/core-service/src/CoreService.Application/Clinical/Services/ClinicianPreTriageService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi alla consultazione
 * del questionario di pre-triage da parte del clinico associato a una prenotazione.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Clinical
 * e coordina il workflow che consente al clinico autenticato
 * di recuperare il questionario di pre-triage compilato dal paziente
 * per uno specifico appuntamento di propria competenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare gli identificativi del clinico e della prenotazione.
 * - Verificare l'esistenza della prenotazione richiesta.
 * - Verificare che la prenotazione appartenga al clinico corrente.
 * - Recuperare il questionario di pre-triage associato all'appuntamento.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - ISchedulingRepository
 * - IPreTriageQuestionnaireRepository
 * - Entità del dominio Clinical
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
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Clinical.Repositories;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Clinical;

namespace CoreService.Application.Clinical.Services
{
    public sealed class ClinicianPreTriageService
    {
        // Repository necessari alla validazione della prenotazione
        // e al recupero del questionario di pre-triage associato.
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly IPreTriageQuestionnaireRepository _preTriageRepository;

        /*
         * Inizializza il servizio con le dipendenze necessarie
         * al workflow di consultazione del pre-triage lato clinico.
         */
        public ClinicianPreTriageService(
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
         * verificando che la prenotazione esista e appartenga al clinico corrente.
         */
        public async Task<OperationResult<PreTriageQuestionnaireDto>> GetPreTriageForAppointmentAsync(
            Guid clinicianUserId,
            Guid appointmentId,
            CancellationToken cancellationToken)
        {
            // L'identificativo del clinico deve essere valorizzato.
            if (clinicianUserId == Guid.Empty)
            {
                return OperationResult<PreTriageQuestionnaireDto>.BadRequest(
                    "invalid_clinician_id",
                    "È necessario un identificativo valido per il clinico che richiede il questionario."
                );
            }

            // L'identificativo della prenotazione deve essere valorizzato.
            if (appointmentId == Guid.Empty)
            {
                return OperationResult<PreTriageQuestionnaireDto>.BadRequest(
                    "invalid_appointment_id",
                    "È necessario specificare un identificativo di prenotazione valido."
                );
            }

            // Recupera la prenotazione per verificare esistenza e titolarità lato clinico.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment is null)
            {
                return OperationResult<PreTriageQuestionnaireDto>.NotFound(
                    "appointment_not_found",
                    "La prenotazione indicata non esiste."
                );
            }

            // Il questionario può essere visualizzato solo dal clinico associato all'appuntamento.
            if (appointment.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<PreTriageQuestionnaireDto>.Forbidden(
                    "appointment_forbidden",
                    "Il clinico corrente non è autorizzato a visualizzare il pre-triage per questa prenotazione."
                );
            }

            // Recupera il questionario di pre-triage collegato all'appuntamento.
            var questionnaire = await _preTriageRepository
                .GetByAppointmentIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (questionnaire is null)
            {
                return OperationResult<PreTriageQuestionnaireDto>.NotFound(
                    "pretriage_not_found",
                    "Per l'appuntamento indicato non risulta ancora alcun questionario di pre-triage compilato."
                );
            }

            var dto = MapToDto(questionnaire);
            return OperationResult<PreTriageQuestionnaireDto>.Success(dto);
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
    }
}
