/*
 * File: services/core-service/src/CoreService.Application/Clinical/Repositories/IPreTriageQuestionnaireRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * dei questionari di pre-triage del dominio Clinical.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Clinical
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono recuperare, creare e aggiornare i questionari di pre-triage
 * associati alle prenotazioni, senza dipendere dai dettagli
 * infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un questionario di pre-triage tramite identificativo di prenotazione.
 * - Persistire un nuovo questionario di pre-triage.
 * - Aggiornare un questionario di pre-triage esistente.
 *
 * Interazioni principali
 * ----------------------
 * - PatientPreTriageService
 * - ClinicianPreTriageService
 * - Implementazioni infrastrutturali dei repository
 * - Entità PreTriageQuestionnaire del dominio
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * sul database o sul meccanismo di persistenza:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Domain.Clinical;

namespace CoreService.Application.Clinical.Repositories
{
    public interface IPreTriageQuestionnaireRepository
    {
        /*
         * Recupera il questionario di pre-triage associato
         * alla prenotazione specificata.
         */
        Task<PreTriageQuestionnaire?> GetByAppointmentIdAsync(
            Guid appointmentId,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo questionario di pre-triage nel sistema.
         */
        Task AddAsync(
            PreTriageQuestionnaire questionnaire,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un questionario di pre-triage esistente.
         */
        Task UpdateAsync(
            PreTriageQuestionnaire questionnaire,
            CancellationToken cancellationToken = default);
    }
}

