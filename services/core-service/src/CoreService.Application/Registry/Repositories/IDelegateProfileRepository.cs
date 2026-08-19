/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IDelegateProfileRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * dei profili delegato del dominio Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Registry
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono recuperare, creare e aggiornare i profili delegate
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un profilo delegate a partire dall'identificativo utente.
 * - Recuperare un profilo delegate a partire dall'identificativo del profilo.
 * - Persistire un nuovo profilo delegate.
 * - Aggiornare un profilo delegate esistente.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Registry
 * - Implementazioni infrastrutturali dei repository
 * - Entità DelegateProfile del dominio
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
    public interface IDelegateProfileRepository
    {
        /*
         * Recupera un profilo delegate a partire dall'identificativo
         * dell'utente a cui il profilo appartiene.
         */
        Task<DelegateProfile?> GetByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un profilo delegate a partire dal suo identificativo univoco.
         */
        Task<DelegateProfile?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo profilo delegate nel sistema.
         */
        Task AddAsync(
            DelegateProfile profile,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un profilo delegate esistente.
         */
        Task UpdateAsync(
            DelegateProfile profile,
            CancellationToken cancellationToken = default);
    }
}

