/*
 * File: services/core-service/src/CoreService.Application/Clinical/Repositories/IClinicalPathwayRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * degli elementi che compongono il percorso clinico del paziente,
 * inclusi encounter, anamnesi, parametri vitali, ordini, esecuzioni e referti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Clinical
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono interrogare e modificare il percorso clinico
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Gestire il ciclo di vita degli encounter clinici.
 * - Persistire e recuperare anamnesi e parametri vitali.
 * - Persistire e recuperare ordini clinici ed esecuzioni procedurali.
 * - Persistire e recuperare i referti clinici.
 * - Recuperare i referti pubblicati accessibili al paziente.
 *
 * Interazioni principali
 * ----------------------
 * - ClinicianClinicalService
 * - ClinicalReportWorkflowService
 * - PatientClinicalService
 * - Implementazioni infrastrutturali dei repository
 * - Entità del dominio Clinical
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * sul database o sul meccanismo di persistenza:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Domain.Clinical;

namespace CoreService.Application.Clinical.Repositories
{
    public interface IClinicalPathwayRepository
    {
        /*
         * Recupera un encounter clinico a partire dal suo identificativo univoco.
         */
        Task<ClinicalEncounter?> GetEncounterByIdAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera l'encounter associato a una specifica prenotazione.
         */
        Task<ClinicalEncounter?> GetEncounterForAppointmentAsync(
            Guid appointmentId,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo encounter clinico nel sistema.
         */
        Task AddEncounterAsync(
            ClinicalEncounter encounter,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un encounter clinico esistente.
         */
        Task UpdateEncounterAsync(
            ClinicalEncounter encounter,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutti gli encounter associati a un clinico
         * nel range temporale specificato.
         */
        Task<IReadOnlyList<ClinicalEncounter>> GetEncountersForClinicianAsync(
            Guid clinicianUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default);

        /*
         * Persiste una nuova anamnesi associata a un encounter.
         */
        Task AddAnamnesisAsync(
            AnamnesisRecord anamnesis,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutte le anamnesi associate a un encounter specifico.
         */
        Task<IReadOnlyList<AnamnesisRecord>> GetAnamnesesForEncounterAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo parametro vitale associato a un encounter.
         */
        Task AddVitalSignAsync(
            VitalSign vitalSign,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutti i parametri vitali associati a un encounter specifico.
         */
        Task<IReadOnlyList<VitalSign>> GetVitalSignsForEncounterAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo ordine clinico associato a un encounter.
         */
        Task AddOrderAsync(
            ClinicalOrder order,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un ordine clinico esistente.
         */
        Task UpdateOrderAsync(
            ClinicalOrder order,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un ordine clinico a partire dal suo identificativo univoco.
         */
        Task<ClinicalOrder?> GetOrderByIdAsync(
            Guid orderId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutti gli ordini clinici associati a un encounter specifico.
         */
        Task<IReadOnlyList<ClinicalOrder>> GetOrdersForEncounterAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default);

        /*
         * Persiste una nuova esecuzione procedurale associata a un ordine clinico.
         */
        Task AddExecutionAsync(
            ProcedureExecution execution,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutte le esecuzioni procedurali associate a un ordine clinico specifico.
         */
        Task<IReadOnlyList<ProcedureExecution>> GetExecutionsForOrderAsync(
            Guid orderId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera il referto clinico associato a un encounter specifico.
         */
        Task<ClinicalReport?> GetReportByEncounterIdAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo referto clinico oppure aggiorna un referto già esistente.
         */
        Task AddOrUpdateReportAsync(
            ClinicalReport report,
            CancellationToken cancellationToken = default);

        /*
         * Recupera i referti clinici pubblicati per un paziente
         * insieme agli encounter a cui appartengono,
         * eventualmente filtrati per intervallo temporale.
         */
        Task<IReadOnlyList<(ClinicalReport Report, ClinicalEncounter Encounter)>> GetPublishedReportsForPatientAsync(
            Guid patientUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken = default);
    }
}
