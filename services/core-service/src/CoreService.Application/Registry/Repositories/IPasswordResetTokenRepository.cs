/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IPasswordResetTokenRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * dei token di reset password del dominio Registry/Auth.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono creare, recuperare e aggiornare i token di reset password
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Persistire un nuovo token di reset password.
 * - Recuperare un token di reset valido a partire dal suo hash.
 * - Aggiornare lo stato persistito di un token di reset esistente.
 *
 * Interazioni principali
 * ----------------------
 * - AuthService
 * - Implementazioni infrastrutturali dei repository
 * - Entità PasswordResetToken del dominio
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
    public interface IPasswordResetTokenRepository
    {
        /*
         * Persiste un nuovo token di reset password nel sistema.
         */
        Task AddAsync(
            PasswordResetToken token,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un token di reset password valido a partire dal suo hash.
         */
        Task<PasswordResetToken?> GetValidByTokenHashAsync(
            string tokenHash,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un token di reset password esistente.
         */
        Task UpdateAsync(
            PasswordResetToken token,
            CancellationToken cancellationToken = default);
    }
}

