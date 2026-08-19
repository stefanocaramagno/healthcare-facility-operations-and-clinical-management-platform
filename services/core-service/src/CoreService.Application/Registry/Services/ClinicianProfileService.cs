/*
 * File: services/core-service/src/CoreService.Application/Registry/Services/ClinicianProfileService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi alla consultazione
 * e all'aggiornamento del profilo del clinico autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Registry
 * e coordina i workflow self-service che consentono al clinico
 * di leggere e modificare il proprio profilo professionale.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare il profilo del clinico autenticato.
 * - Creare o aggiornare il profilo del clinico autenticato.
 * - Verificare esistenza utente e correttezza del ruolo Clinician.
 * - Validare gli input applicativi relativi al profilo.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IUserRepository
 * - IClinicianProfileRepository
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
using CoreService.Application.Contracts;
using CoreService.Application.Common;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;
using Microsoft.AspNetCore.Http;

namespace CoreService.Application.Registry.Services
{
    public sealed class ClinicianProfileService
    {
        // Repository applicativi necessari al recupero dell'utente
        // e alla gestione del profilo clinico.
        private readonly IUserRepository _userRepository;
        private readonly IClinicianProfileRepository _clinicianProfiles;

        /*
         * Inizializza il servizio con le dipendenze necessarie
         * ai workflow self-service del profilo clinico.
         */
        public ClinicianProfileService(
            IUserRepository userRepository,
            IClinicianProfileRepository clinicianProfiles)
        {
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _clinicianProfiles = clinicianProfiles
                ?? throw new ArgumentNullException(nameof(clinicianProfiles));
        }

        /*
         * Recupera il profilo del clinico autenticato
         * dopo aver verificato esistenza utente e correttezza del ruolo.
         */
        public async Task<OperationResult<ClinicianProfileDto>> GetMyProfileAsync(
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
                return OperationResult<ClinicianProfileDto>.Failure(
                    StatusCodes.Status401Unauthorized,
                    "user_not_found",
                    "L'utente autenticato non esiste più nel sistema.");
            }

            // L'operazione è consentita solo a utenti con ruolo Clinician.
            if (user.Role != UserRole.Clinician)
            {
                return OperationResult<ClinicianProfileDto>.Forbidden(
                    "invalid_user_role",
                    "L'utente autenticato non ha il ruolo 'Clinician' richiesto per questo tipo di profilo.");
            }

            // Recupera il profilo clinico associato all'utente corrente.
            var profile = await _clinicianProfiles
                .GetByUserIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se il profilo non è ancora stato creato, restituisce un not found applicativo.
            if (profile is null)
            {
                return OperationResult<ClinicianProfileDto>.NotFound(
                    "profile_not_found",
                    "Non è stato ancora configurato alcun profilo clinico per l'utente corrente.");
            }

            // Mappa l'entità di dominio nel DTO esposto ai layer superiori.
            var dto = new ClinicianProfileDto(
                profile.Id,
                profile.UserId,
                profile.FirstName,
                profile.LastName,
                profile.Phone,
                profile.Specialty,
                profile.LicenseNumber,
                profile.OfficeLocation
            );

            return OperationResult<ClinicianProfileDto>.Success(dto);
        }

        /*
         * Crea oppure aggiorna il profilo del clinico autenticato
         * dopo aver validato il payload e il contesto utente corrente.
         */
        public async Task<OperationResult<ClinicianProfileDto>> UpsertMyProfileAsync(
            Guid userId,
            UpsertClinicianProfileRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload è obbligatorio per poter creare o aggiornare il profilo.
            if (request is null)
            {
                return OperationResult<ClinicianProfileDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Tutti i campi professionali essenziali devono essere presenti.
            if (string.IsNullOrWhiteSpace(request.FirstName) ||
                string.IsNullOrWhiteSpace(request.LastName) ||
                string.IsNullOrWhiteSpace(request.Specialty) ||
                string.IsNullOrWhiteSpace(request.LicenseNumber) ||
                string.IsNullOrWhiteSpace(request.OfficeLocation))
            {
                return OperationResult<ClinicianProfileDto>.BadRequest(
                    "invalid_payload",
                    "Nome, cognome, specializzazione, numero di iscrizione e sede principale sono obbligatori.");
            }

            // Recupera l'utente autenticato per verificare esistenza e ruolo.
            var user = await _userRepository
                .GetByIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se l'utente non esiste più nel sistema, il contesto autenticato
            // non è più considerabile valido.
            if (user is null)
            {
                return OperationResult<ClinicianProfileDto>.Failure(
                    StatusCodes.Status401Unauthorized,
                    "user_not_found",
                    "L'utente autenticato non esiste più nel sistema.");
            }

            // L'operazione è consentita solo a utenti con ruolo Clinician.
            if (user.Role != UserRole.Clinician)
            {
                return OperationResult<ClinicianProfileDto>.Forbidden(
                    "invalid_user_role",
                    "L'utente autenticato non ha il ruolo 'Clinician' richiesto per questo tipo di profilo.");
            }

            var now = DateTime.UtcNow;

            // Verifica se per l'utente corrente esiste già un profilo persistito.
            var existing = await _clinicianProfiles
                .GetByUserIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se il profilo non esiste, crea una nuova entità ClinicianProfile.
            if (existing is null)
            {
                var profile = new ClinicianProfile
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    FirstName = request.FirstName.Trim(),
                    LastName = request.LastName.Trim(),
                    Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
                    Specialty = request.Specialty.Trim(),
                    LicenseNumber = request.LicenseNumber.Trim(),
                    OfficeLocation = request.OfficeLocation.Trim(),
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now
                };

                await _clinicianProfiles
                    .AddAsync(profile, cancellationToken)
                    .ConfigureAwait(false);

                // Mappa il nuovo profilo creato nel DTO di risposta.
                var dto = new ClinicianProfileDto(
                    profile.Id,
                    profile.UserId,
                    profile.FirstName,
                    profile.LastName,
                    profile.Phone,
                    profile.Specialty,
                    profile.LicenseNumber,
                    profile.OfficeLocation
                );

                return OperationResult<ClinicianProfileDto>.Success(dto);
            }

            // Se il profilo esiste già, aggiorna i campi modificabili.
            existing.FirstName = request.FirstName.Trim();
            existing.LastName = request.LastName.Trim();
            existing.Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
            existing.Specialty = request.Specialty.Trim();
            existing.LicenseNumber = request.LicenseNumber.Trim();
            existing.OfficeLocation = request.OfficeLocation.Trim();
            existing.UpdatedAtUtc = now;

            await _clinicianProfiles
                .UpdateAsync(existing, cancellationToken)
                .ConfigureAwait(false);

            // Mappa il profilo aggiornato nel DTO di risposta.
            var updatedDto = new ClinicianProfileDto(
                existing.Id,
                existing.UserId,
                existing.FirstName,
                existing.LastName,
                existing.Phone,
                existing.Specialty,
                existing.LicenseNumber,
                existing.OfficeLocation
            );

            return OperationResult<ClinicianProfileDto>.Success(updatedDto);
        }
    }
}
