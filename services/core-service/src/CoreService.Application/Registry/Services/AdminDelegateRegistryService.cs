/*
 * File: services/core-service/src/CoreService.Application/Registry/Services/AdminDelegateRegistryService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso amministrativi del dominio Registry relativi
 * alla gestione dei profili Delegate e alla consultazione delle deleghe
 * associate ai delegati.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Registry
 * e coordina i workflow applicativi che consentono di leggere e aggiornare
 * i profili dei delegati, oltre a recuperare l'elenco delle deleghe
 * a essi collegate.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare il profilo di un utente con ruolo Delegate.
 * - Creare o aggiornare il profilo di un delegato.
 * - Recuperare l'elenco delle deleghe associate a un delegato.
 * - Validare gli input applicativi e il ruolo degli utenti coinvolti.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IUserRepository
 * - IDelegateProfileRepository
 * - IDelegationRepository
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
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;

namespace CoreService.Application.Registry.Services
{
    public sealed class AdminDelegateRegistryService
    {
        // Repository applicativi necessari alla gestione dei profili delegate
        // e delle deleghe a essi collegate.
        private readonly IUserRepository _userRepository;
        private readonly IDelegateProfileRepository _delegateProfiles;
        private readonly IDelegationRepository _delegations;

        /*
         * Inizializza il servizio amministrativo dedicato ai delegati
         * con tutte le dipendenze necessarie ai workflow applicativi.
         */
        public AdminDelegateRegistryService(
            IUserRepository userRepository,
            IDelegateProfileRepository delegateProfiles,
            IDelegationRepository delegations)
        {
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _delegateProfiles = delegateProfiles
                ?? throw new ArgumentNullException(nameof(delegateProfiles));
            _delegations = delegations
                ?? throw new ArgumentNullException(nameof(delegations));
        }

        /*
         * Recupera il profilo di un utente Delegate
         * dopo aver verificato esistenza utente e correttezza del ruolo.
         */
        public async Task<OperationResult<DelegateProfileDto>> GetDelegateProfileAsync(
            Guid userId,
            CancellationToken cancellationToken)
        {
            // Recupera l'utente a partire dall'identificativo specificato.
            var user = await _userRepository
                .GetByIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se l'utente non esiste, il profilo non può essere recuperato.
            if (user is null)
            {
                return OperationResult<DelegateProfileDto>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            // L'operazione è valida solo per utenti con ruolo Delegate.
            if (user.Role != UserRole.Delegate)
            {
                return OperationResult<DelegateProfileDto>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Delegate' richiesto per questo tipo di profilo.");
            }

            // Recupera il profilo delegate associato all'utente.
            var profile = await _delegateProfiles
                .GetByUserIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se il profilo non esiste ancora, restituisce un not found applicativo.
            if (profile is null)
            {
                return OperationResult<DelegateProfileDto>.NotFound(
                    "profile_not_found",
                    "Per l'utente specificato non è ancora stato registrato alcun profilo delegato.");
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
         * Crea oppure aggiorna il profilo di un utente Delegate,
         * restituendo anche l'informazione se l'operazione ha prodotto una creazione.
         */
        public async Task<OperationResult<UpsertDelegateProfileResult>> UpsertDelegateProfileAsync(
            Guid userId,
            UpsertDelegateProfileRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload è obbligatorio per poter creare o aggiornare il profilo.
            if (request is null)
            {
                return OperationResult<UpsertDelegateProfileResult>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Nome e cognome sono campi minimi obbligatori.
            if (string.IsNullOrWhiteSpace(request.FirstName) ||
                string.IsNullOrWhiteSpace(request.LastName))
            {
                return OperationResult<UpsertDelegateProfileResult>.BadRequest(
                    "invalid_payload",
                    "Nome e cognome sono obbligatori.");
            }

            // Recupera l'utente per verificare esistenza e ruolo.
            var user = await _userRepository
                .GetByIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            if (user is null)
            {
                return OperationResult<UpsertDelegateProfileResult>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            if (user.Role != UserRole.Delegate)
            {
                return OperationResult<UpsertDelegateProfileResult>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Delegate' richiesto per questo tipo di profilo.");
            }

            var now = DateTime.UtcNow;

            // Verifica se per l'utente esiste già un profilo persistito.
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

                var dto = new DelegateProfileDto(
                    profile.Id,
                    profile.UserId,
                    profile.FirstName,
                    profile.LastName,
                    profile.Phone,
                    profile.Address
                );

                var payload = new UpsertDelegateProfileResult(dto, true);
                return OperationResult<UpsertDelegateProfileResult>.Success(payload);
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

            var updatedDto = new DelegateProfileDto(
                existing.Id,
                existing.UserId,
                existing.FirstName,
                existing.LastName,
                existing.Phone,
                existing.Address
            );

            var updatedPayload = new UpsertDelegateProfileResult(updatedDto, false);
            return OperationResult<UpsertDelegateProfileResult>.Success(updatedPayload);
        }

        /*
         * Recupera l'elenco delle deleghe associate a un utente Delegate,
         * dopo aver verificato validità dell'identificativo e ruolo dell'utente.
         */
        public async Task<OperationResult<IReadOnlyList<DelegationDto>>> GetDelegateDelegationsAsync(
            Guid delegateUserId,
            CancellationToken cancellationToken)
        {
            // L'identificativo del delegato deve essere valorizzato.
            if (delegateUserId == Guid.Empty)
            {
                return OperationResult<IReadOnlyList<DelegationDto>>.BadRequest(
                    "invalid_user_id",
                    "L'identificativo del delegato non può essere vuoto.");
            }

            // Recupera l'utente per verificare esistenza e ruolo.
            var user = await _userRepository
                .GetByIdAsync(delegateUserId, cancellationToken)
                .ConfigureAwait(false);

            if (user is null)
            {
                return OperationResult<IReadOnlyList<DelegationDto>>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            if (user.Role != UserRole.Delegate)
            {
                return OperationResult<IReadOnlyList<DelegationDto>>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Delegate' richiesto per la consultazione delle deleghe.");
            }

            // Recupera tutte le deleghe associate al delegato indicato.
            var delegations = await _delegations
                .GetByDelegateUserIdAsync(delegateUserId, cancellationToken)
                .ConfigureAwait(false);

            // Mappa le entità di dominio in DTO di risposta.
            var dtoList = delegations
                .Select(MapDelegationToDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<DelegationDto>>.Success(dtoList);
        }

        /*
         * Converte un'entità Delegation del dominio nel corrispondente DTO applicativo.
         */
        private static DelegationDto MapDelegationToDto(Delegation delegation)
        {
            return new DelegationDto(
                delegation.Id,
                delegation.PatientUserId,
                delegation.DelegateUserId,
                delegation.Scope.ToString(),
                delegation.Status.ToString(),
                delegation.StartsAtUtc,
                delegation.EndsAtUtc,
                delegation.CreatedAtUtc
            );
        }

        /*
         * DTO di output interno al servizio che rappresenta l'esito
         * di una operazione di upsert sul profilo delegate.
         */
        public sealed record UpsertDelegateProfileResult(
            DelegateProfileDto Profile,
            bool Created
        );
    }
}
