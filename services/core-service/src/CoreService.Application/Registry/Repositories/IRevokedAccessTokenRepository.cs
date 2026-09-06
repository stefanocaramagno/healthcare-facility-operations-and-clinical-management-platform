/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IRevokedAccessTokenRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * dei token di accesso revocati del dominio Registry/Auth.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono registrare la revoca di token di accesso
 * e verificare se un token risulta ancora revocato,
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Persistire un nuovo token di accesso revocato.
 * - Verificare l'esistenza di una revoca attiva a partire dall'hash del token.
 *
 * Interazioni principali
 * ----------------------
 * - AuthService
 * - Implementazioni infrastrutturali dei repository
 * - Entità RevokedAccessToken del dominio
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
    public interface IRevokedAccessTokenRepository
    {
        /*
         * Persiste un nuovo token di accesso revocato nel sistema.
         */
        Task AddAsync(
            RevokedAccessToken revokedToken,
            CancellationToken cancellationToken = default);

        /*
         * Verifica se esiste una revoca attiva associata all'hash del token specificato.
         */
        Task<bool> ExistsActiveByTokenHashAsync(
            string tokenHash,
            CancellationToken cancellationToken = default);
    }
}

