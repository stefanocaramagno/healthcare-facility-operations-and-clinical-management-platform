/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IClinicianProfileRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * dei profili clinico del dominio Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Registry
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono recuperare, creare e aggiornare i profili clinician
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un profilo clinician a partire dall'identificativo utente.
 * - Recuperare un profilo clinician a partire dall'identificativo del profilo.
 * - Recuperare un profilo clinician a partire dal numero di iscrizione.
 * - Persistire un nuovo profilo clinician.
 * - Aggiornare un profilo clinician esistente.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Registry
 * - Implementazioni infrastrutturali dei repository
 * - Entità ClinicianProfile del dominio
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
using CoreService.Domain.Registry;

namespace CoreService.Application.Registry.Repositories
{
    public interface IClinicianProfileRepository
    {
        /*
         * Recupera un profilo clinician a partire dall'identificativo
         * dell'utente a cui il profilo appartiene.
         */
        Task<ClinicianProfile?> GetByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un profilo clinician a partire dal suo identificativo univoco.
         */
        Task<ClinicianProfile?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un profilo clinician a partire dal numero di iscrizione professionale.
         */
        Task<ClinicianProfile?> GetByLicenseNumberAsync(
            string licenseNumber,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo profilo clinician nel sistema.
         */
        Task AddAsync(
            ClinicianProfile profile,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un profilo clinician esistente.
         */
        Task UpdateAsync(
            ClinicianProfile profile,
            CancellationToken cancellationToken = default);
    }
}

