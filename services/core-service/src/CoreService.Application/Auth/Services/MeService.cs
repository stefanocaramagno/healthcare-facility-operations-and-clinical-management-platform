/*
 * File: services/core-service/src/CoreService.Application/Auth/MeService.cs
 *
 * Scopo
 * -----
 * Fornire il caso d'uso applicativo per il recupero delle informazioni essenziali
 * dell'utente corrente a partire dal suo identificativo.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Auth
 * e incapsula la logica necessaria a recuperare i dati minimi
 * dell'utente autenticato, così da poterli esporre ai layer superiori
 * in modo uniforme e controllato.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'utente corrente a partire dal suo identificativo.
 * - Restituire un risultato applicativo uniforme tramite OperationResult.
 * - Tradurre l'entità utente in un DTO leggero orientato alla presentazione.
 *
 * Interazioni principali
 * ----------------------
 * - IUserRepository
 * - OperationResult
 * - Layer API/Auth controller
 *
 * Note
 * ----
 * Il servizio non contiene logica infrastrutturale:
 * delega il recupero dei dati al repository e si occupa
 * esclusivamente dell'orchestrazione applicativa del caso d'uso.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Common;
using CoreService.Application.Registry.Repositories;

namespace CoreService.Application.Auth.Services
{
    public sealed class MeService
    {
        // Repository usato per recuperare l'utente a partire dal suo identificativo.
        private readonly IUserRepository _userRepository;

        /*
         * Inizializza il servizio con il repository necessario
         * al recupero dei dati dell'utente corrente.
         */
        public MeService(IUserRepository userRepository)
        {
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
        }

        /*
         * Recupera le informazioni essenziali dell'utente corrente
         * a partire dal relativo identificativo.
         */
        public async Task<OperationResult<CurrentUserInfo>> GetCurrentUserAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            // Recupera l'entità utente dal repository applicativo.
            var user = await _userRepository
                .GetByIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se l'utente non esiste, restituisce un risultato standardizzato di not found.
            if (user is null)
            {
                return OperationResult<CurrentUserInfo>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            // Mappa l'entità utente in un DTO minimale destinato ai layer superiori.
            var info = new CurrentUserInfo
            {
                Id = user.Id,
                Email = user.Email,
                Role = user.Role.ToString()
            };

            return OperationResult<CurrentUserInfo>.Success(info);
        }

        /*
         * DTO interno che rappresenta le informazioni essenziali
         * dell'utente corrente restituite dal servizio.
         */
        public sealed class CurrentUserInfo
        {
            // Identificativo univoco dell'utente.
            public Guid Id { get; init; }

            // Indirizzo e-mail dell'utente.
            public string Email { get; init; } = string.Empty;

            // Ruolo applicativo dell'utente.
            public string Role { get; init; } = string.Empty;
        }
    }
}
