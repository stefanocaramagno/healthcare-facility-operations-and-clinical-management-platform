/*
 * File: services/core-service/src/CoreService.Application/Registry/Services/PatientProfileService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi alla consultazione
 * e all'aggiornamento del profilo del paziente autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Registry
 * e coordina i workflow self-service che consentono al paziente
 * di leggere e modificare il proprio profilo anagrafico.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare il profilo del paziente autenticato.
 * - Creare o aggiornare il profilo del paziente autenticato.
 * - Verificare esistenza utente e correttezza del ruolo Patient.
 * - Validare gli input applicativi relativi al profilo.
 * - Normalizzare i campi temporali in UTC.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IUserRepository
 * - IPatientProfileRepository
 * - UtcDateTimeInput
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
    public sealed class PatientProfileService
    {
        // Repository applicativi necessari al recupero dell'utente
        // e alla gestione del profilo paziente.
        private readonly IUserRepository _userRepository;
        private readonly IPatientProfileRepository _patientProfiles;

        /*
         * Inizializza il servizio con le dipendenze necessarie
         * ai workflow self-service del profilo paziente.
         */
        public PatientProfileService(
            IUserRepository userRepository,
            IPatientProfileRepository patientProfiles)
        {
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _patientProfiles = patientProfiles
                ?? throw new ArgumentNullException(nameof(patientProfiles));
        }

        /*
         * Recupera il profilo del paziente autenticato
         * dopo aver verificato esistenza utente e correttezza del ruolo.
         */
        public async Task<OperationResult<PatientProfileDto>> GetMyProfileAsync(
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
                return OperationResult<PatientProfileDto>.Failure(
                    StatusCodes.Status401Unauthorized,
                    "user_not_found",
                    "L'utente autenticato non esiste più nel sistema.");
            }

            // L'operazione è consentita solo a utenti con ruolo Patient.
            if (user.Role != UserRole.Patient)
            {
                return OperationResult<PatientProfileDto>.Forbidden(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Patient' richiesto per questo tipo di profilo.");
            }

            // Recupera il profilo paziente associato all'utente corrente.
            var profile = await _patientProfiles
                .GetByUserIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se il profilo non è ancora stato creato, restituisce un not found applicativo.
            if (profile is null)
            {
                return OperationResult<PatientProfileDto>.NotFound(
                    "profile_not_found",
                    "Non è stato ancora configurato alcun profilo paziente per l'utente corrente.");
            }

            // Mappa l'entità di dominio nel DTO esposto ai layer superiori.
            var dto = new PatientProfileDto(
                profile.Id,
                profile.UserId,
                profile.FirstName,
                profile.LastName,
                profile.DateOfBirthUtc,
                profile.Phone,
                profile.Address
            );

            return OperationResult<PatientProfileDto>.Success(dto);
        }

        /*
         * Crea oppure aggiorna il profilo del paziente autenticato
         * dopo aver validato il payload e il contesto utente corrente.
         */
        public async Task<OperationResult<PatientProfileDto>> UpsertMyProfileAsync(
            Guid userId,
            UpsertPatientProfileRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload è obbligatorio per poter creare o aggiornare il profilo.
            if (request is null)
            {
                return OperationResult<PatientProfileDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Nome e cognome sono campi minimi obbligatori del profilo.
            if (string.IsNullOrWhiteSpace(request.FirstName) ||
                string.IsNullOrWhiteSpace(request.LastName))
            {
                return OperationResult<PatientProfileDto>.BadRequest(
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
                return OperationResult<PatientProfileDto>.Failure(
                    StatusCodes.Status401Unauthorized,
                    "user_not_found",
                    "L'utente autenticato non esiste più nel sistema.");
            }

            // L'operazione è consentita solo a utenti con ruolo Patient.
            if (user.Role != UserRole.Patient)
            {
                return OperationResult<PatientProfileDto>.Forbidden(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Patient' richiesto per questo tipo di profilo.");
            }

            var now = DateTime.UtcNow;

            // Normalizza la data di nascita imponendo una semantica temporale esplicita.
            if (!UtcDateTimeInput.TryNormalizeRequired(request.DateOfBirthUtc, "dateOfBirthUtc", out var dateOfBirthUtc, out var dateOfBirthError))
            {
                return OperationResult<PatientProfileDto>.BadRequest(
                    "invalid_datetime",
                    dateOfBirthError!);
            }

            // Verifica se per l'utente corrente esiste già un profilo persistito.
            var existing = await _patientProfiles
                .GetByUserIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se il profilo non esiste, crea una nuova entità PatientProfile.
            if (existing is null)
            {
                var profile = new PatientProfile
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    FirstName = request.FirstName.Trim(),
                    LastName = request.LastName.Trim(),
                    DateOfBirthUtc = dateOfBirthUtc,
                    Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
                    Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim(),
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now
                };

                await _patientProfiles
                    .AddAsync(profile, cancellationToken)
                    .ConfigureAwait(false);

                // Mappa il nuovo profilo creato nel DTO di risposta.
                var dto = new PatientProfileDto(
                    profile.Id,
                    profile.UserId,
                    profile.FirstName,
                    profile.LastName,
                    profile.DateOfBirthUtc,
                    profile.Phone,
                    profile.Address
                );

                return OperationResult<PatientProfileDto>.Success(dto);
            }

            // Se il profilo esiste già, aggiorna i campi modificabili.
            existing.FirstName = request.FirstName.Trim();
            existing.LastName = request.LastName.Trim();
            existing.DateOfBirthUtc = dateOfBirthUtc;
            existing.Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
            existing.Address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim();
            existing.UpdatedAtUtc = now;

            await _patientProfiles
                .UpdateAsync(existing, cancellationToken)
                .ConfigureAwait(false);

            // Mappa il profilo aggiornato nel DTO di risposta.
            var updatedDto = new PatientProfileDto(
                existing.Id,
                existing.UserId,
                existing.FirstName,
                existing.LastName,
                existing.DateOfBirthUtc,
                existing.Phone,
                existing.Address
            );

            return OperationResult<PatientProfileDto>.Success(updatedDto);
        }
    }
}
