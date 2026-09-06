/*
 * File: services/core-service/src/CoreService.Application/Registry/Services/DelegateProfileService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi alla consultazione
 * e all'aggiornamento del profilo del delegato autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Registry
 * e coordina i workflow self-service che consentono al delegato
 * di leggere e modificare il proprio profilo anagrafico.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare il profilo del delegato autenticato.
 * - Creare o aggiornare il profilo del delegato autenticato.
 * - Verificare esistenza utente e correttezza del ruolo Delegate.
 * - Validare gli input applicativi relativi al profilo.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IUserRepository
 * - IDelegateProfileRepository
 * - Entità del dominio Registry
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati ai repository dedicati.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;
using Microsoft.AspNetCore.Http;

namespace CoreService.Application.Registry.Services
{
    public sealed class DelegateProfileService
    {
        // Repository applicativi necessari al recupero dell'utente
        // e alla gestione del profilo delegato.
        private readonly IUserRepository _userRepository;
        private readonly IDelegateProfileRepository _delegateProfiles;

        /*
         * Inizializza il servizio con le dipendenze necessarie
         * ai workflow self-service del profilo delegato.
         */
        public DelegateProfileService(
            IUserRepository userRepository,
            IDelegateProfileRepository delegateProfiles)
        {
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _delegateProfiles = delegateProfiles
                ?? throw new ArgumentNullException(nameof(delegateProfiles));
        }

        /*
         * Recupera il profilo del delegato autenticato
         * dopo aver verificato esistenza utente e correttezza del ruolo.
         */
        public async Task<OperationResult<DelegateProfileDto>> GetMyProfileAsync(
            Guid userId,
            CancellationToken cancellationToken)
        {
            // Recupera l'utente autenticato a partire dal suo identificativo.
            var user = await _userRepository
                .GetByIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se l'utente non esiste più nel sistema, restituisce un errore coerente
            // con il fatto che il contesto autenticato non è più valido.
            if (user is null)
            {
                return OperationResult<DelegateProfileDto>.Failure(
                    StatusCodes.Status401Unauthorized,
                    "user_not_found",
                    "L'utente autenticato non esiste più nel sistema.");
            }

            // L'operazione è consentita solo a utenti con ruolo Delegate.
            if (user.Role != UserRole.Delegate)
            {
                return OperationResult<DelegateProfileDto>.Forbidden(
                    "invalid_user_role",
                    "L'utente autenticato non ha il ruolo 'Delegate' richiesto per questo tipo di profilo.");
            }

            // Recupera il profilo delegato associato all'utente corrente.
            var profile = await _delegateProfiles
                .GetByUserIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se il profilo non è ancora stato creato, restituisce un not found applicativo.
            if (profile is null)
            {
                return OperationResult<DelegateProfileDto>.NotFound(
                    "profile_not_found",
                    "Non è stato ancora configurato alcun profilo delegato per l'utente corrente.");
            }

            // Mappa l'entità di dominio nel DTO esposto ai layer superiori.
            var dto = new DelegateProfileDto(
                profile.Id,
                profile.UserId,
                profile.FirstName,
                profile.LastName,
                profile.Phone,
                profile.Address
            );

            return OperationResult<DelegateProfileDto>.Success(dto);
        }

        /*
         * Crea oppure aggiorna il profilo del delegato autenticato
         * dopo aver validato il payload e il contesto utente corrente.
         */
        public async Task<OperationResult<DelegateProfileDto>> UpsertMyProfileAsync(
            Guid userId,
            UpsertDelegateProfileRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload è obbligatorio per poter creare o aggiornare il profilo.
            if (request is null)
            {
                return OperationResult<DelegateProfileDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Nome e cognome sono campi minimi obbligatori del profilo.
            if (string.IsNullOrWhiteSpace(request.FirstName) ||
                string.IsNullOrWhiteSpace(request.LastName))
            {
                return OperationResult<DelegateProfileDto>.BadRequest(
                    "invalid_payload",
                    "Nome e cognome sono obbligatori.");
            }

            // Recupera l'utente autenticato per verificare esistenza e ruolo.
            var user = await _userRepository
                .GetByIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se l'utente non esiste più nel sistema, il contesto autenticato
            // non è più considerabile valido.
            if (user is null)
            {
                return OperationResult<DelegateProfileDto>.Failure(
                    StatusCodes.Status401Unauthorized,
                    "user_not_found",
                    "L'utente autenticato non esiste più nel sistema.");
            }

            // L'operazione è consentita solo a utenti con ruolo Delegate.
            if (user.Role != UserRole.Delegate)
            {
                return OperationResult<DelegateProfileDto>.Forbidden(
                    "invalid_user_role",
                    "L'utente autenticato non ha il ruolo 'Delegate' richiesto per questo tipo di profilo.");
            }

            var now = DateTime.UtcNow;

            // Verifica se per l'utente corrente esiste già un profilo persistito.
            var existing = await _delegateProfiles
                .GetByUserIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se il profilo non esiste, crea una nuova entità DelegateProfile.
            if (existing is null)
            {
                var profile = new DelegateProfile
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    FirstName = request.FirstName.Trim(),
                    LastName = request.LastName.Trim(),
                    Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
                    Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim(),
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now
                };

                await _delegateProfiles
                    .AddAsync(profile, cancellationToken)
                    .ConfigureAwait(false);

                // Mappa il nuovo profilo creato nel DTO di risposta.
                var dto = new DelegateProfileDto(
                    profile.Id,
                    profile.UserId,
                    profile.FirstName,
                    profile.LastName,
                    profile.Phone,
                    profile.Address
                );

                return OperationResult<DelegateProfileDto>.Success(dto);
            }

            // Se il profilo esiste già, aggiorna i campi modificabili.
            existing.FirstName = request.FirstName.Trim();
            existing.LastName = request.LastName.Trim();
            existing.Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
            existing.Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim();
            existing.UpdatedAtUtc = now;

            await _delegateProfiles
                .UpdateAsync(existing, cancellationToken)
                .ConfigureAwait(false);

            // Mappa il profilo aggiornato nel DTO di risposta.
            var updatedDto = new DelegateProfileDto(
                existing.Id,
                existing.UserId,
                existing.FirstName,
                existing.LastName,
                existing.Phone,
                existing.Address
            );

            return OperationResult<DelegateProfileDto>.Success(updatedDto);
        }
    }
}
