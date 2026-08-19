/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IAccountActivationTokenRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * dei token di attivazione account del dominio Registry/Auth.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono creare, recuperare e aggiornare i token di attivazione account
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Persistire un nuovo token di attivazione account.
 * - Recuperare un token di attivazione valido a partire dal suo hash.
 * - Aggiornare lo stato persistito di un token di attivazione esistente.
 *
 * Interazioni principali
 * ----------------------
 * - AccountActivationService
 * - Implementazioni infrastrutturali dei repository
 * - Entità AccountActivationToken del dominio
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * sul database o sul meccanismo di persistenza:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System.Threading;
using System.Threading.Tasks;
using CoreService.Domain.Registry;

namespace CoreService.Application.Registry.Repositories
{
    public interface IAccountActivationTokenRepository
    {
        /*
         * Persiste un nuovo token di attivazione account nel sistema.
         */
        Task AddAsync(
            AccountActivationToken token,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un token di attivazione valido a partire dal suo hash.
         */
        Task<AccountActivationToken?> GetValidByTokenHashAsync(
            string tokenHash,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un token di attivazione esistente.
         */
        Task UpdateAsync(
            AccountActivationToken token,
            CancellationToken cancellationToken = default);
    }
}

