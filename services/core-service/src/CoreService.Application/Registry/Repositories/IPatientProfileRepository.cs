/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IPatientProfileRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * dei profili paziente del dominio Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Registry
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono recuperare, creare e aggiornare i profili paziente
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un profilo paziente a partire dall'identificativo utente.
 * - Recuperare un profilo paziente a partire dall'identificativo del profilo.
 * - Persistire un nuovo profilo paziente.
 * - Aggiornare un profilo paziente esistente.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Registry
 * - Implementazioni infrastrutturali dei repository
 * - Entità PatientProfile del dominio
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
    public interface IPatientProfileRepository
    {
        /*
         * Recupera un profilo paziente a partire dall'identificativo
         * dell'utente a cui il profilo appartiene.
         */
        Task<PatientProfile?> GetByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un profilo paziente a partire dal suo identificativo univoco.
         */
        Task<PatientProfile?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo profilo paziente nel sistema.
         */
        Task AddAsync(
            PatientProfile profile,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un profilo paziente esistente.
         */
        Task UpdateAsync(
            PatientProfile profile,
            CancellationToken cancellationToken = default);
    }
}

