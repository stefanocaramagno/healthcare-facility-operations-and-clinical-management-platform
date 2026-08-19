/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IUserRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * delle entità utente del dominio Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Registry
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono recuperare, creare e aggiornare gli utenti del sistema
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un utente a partire dal suo identificativo.
 * - Recuperare un utente a partire dal suo indirizzo e-mail.
 * - Persistire un nuovo utente.
 * - Aggiornare un utente esistente.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Registry
 * - Servizi applicativi del dominio Auth
 * - Implementazioni infrastrutturali dei repository
 * - Entità User del dominio
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
    public interface IUserRepository
    {
        /*
         * Recupera un utente a partire dal suo identificativo univoco.
         */
        Task<User?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un utente a partire dal suo indirizzo e-mail.
         */
        Task<User?> GetByEmailAsync(
            string email,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo utente nel sistema.
         */
        Task AddAsync(
            User user,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un utente esistente.
         */
        Task UpdateAsync(
            User user,
            CancellationToken cancellationToken = default);
    }
}

