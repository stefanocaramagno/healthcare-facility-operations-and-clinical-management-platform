/*
 * File: services/core-service/src/CoreService.Application/Registry/Services/AdminRegistryService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso amministrativi del dominio Registry relativi
 * alla gestione dei profili, delle deleghe e dei consensi.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Registry
 * e coordina i workflow applicativi che consentono all'amministratore
 * e, in alcuni casi specifici, al paziente, di leggere e aggiornare
 * profili anagrafici, relazioni di delega e consensi informati.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare e aggiornare profili Patient e Clinician.
 * - Gestire la creazione e l'aggiornamento delle deleghe.
 * - Gestire la lettura e l'upsert dei consensi del paziente.
 * - Validare gli input applicativi e il ruolo degli utenti coinvolti.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IUserRepository
 * - IPatientProfileRepository
 * - IClinicianProfileRepository
 * - IDelegationRepository
 * - IConsentRepository
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
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Common;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;

namespace CoreService.Application.Registry.Services
{
    public sealed class AdminRegistryService
    {
        // Repository applicativi necessari alla gestione amministrativa
        // di utenti, profili, deleghe e consensi.
        private readonly IUserRepository _userRepository;
        private readonly IPatientProfileRepository _patientProfiles;
        private readonly IClinicianProfileRepository _clinicianProfiles;
        private readonly IDelegationRepository _delegations;
        private readonly IConsentRepository _consents;

        /*
         * Inizializza il servizio amministrativo del dominio Registry
         * con tutte le dipendenze necessarie ai workflow applicativi.
         */
        public AdminRegistryService(
            IUserRepository userRepository,
            IPatientProfileRepository patientProfiles,
            IClinicianProfileRepository clinicianProfiles,
            IDelegationRepository delegations,
            IConsentRepository consents)
        {
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _patientProfiles = patientProfiles
                ?? throw new ArgumentNullException(nameof(patientProfiles));
            _clinicianProfiles = clinicianProfiles
                ?? throw new ArgumentNullException(nameof(clinicianProfiles));
            _delegations = delegations
                ?? throw new ArgumentNullException(nameof(delegations));
            _consents = consents
                ?? throw new ArgumentNullException(nameof(consents));
        }

        /*
         * Recupera il profilo anagrafico di un utente Patient
         * dopo aver verificato esistenza utente e correttezza del ruolo.
         */
        public async Task<OperationResult<PatientProfileDto>> GetPatientProfileAsync(
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
                return OperationResult<PatientProfileDto>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            // L'operazione è valida solo per utenti con ruolo Patient.
            if (user.Role != UserRole.Patient)
            {
                return OperationResult<PatientProfileDto>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Patient' richiesto per questo tipo di profilo.");
            }

            // Recupera il profilo paziente associato all'utente.
            var profile = await _patientProfiles
                .GetByUserIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se il profilo non esiste ancora, restituisce un not found applicativo.
            if (profile is null)
            {
                return OperationResult<PatientProfileDto>.NotFound(
                    "profile_not_found",
                    "Per l'utente specificato non è ancora stato registrato alcun profilo paziente.");
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
         * Crea oppure aggiorna il profilo di un utente Patient,
         * restituendo anche l'informazione se l'operazione ha prodotto una creazione.
         */
        public async Task<OperationResult<UpsertPatientProfileResult>> UpsertPatientProfileAsync(
            Guid userId,
            UpsertPatientProfileRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload è obbligatorio per poter creare o aggiornare il profilo.
            if (request is null)
            {
                return OperationResult<UpsertPatientProfileResult>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Nome e cognome sono campi minimi obbligatori.
            if (string.IsNullOrWhiteSpace(request.FirstName) ||
                string.IsNullOrWhiteSpace(request.LastName))
            {
                return OperationResult<UpsertPatientProfileResult>.BadRequest(
                    "invalid_payload",
                    "Nome e cognome sono obbligatori.");
            }

            // Recupera l'utente per verificare esistenza e ruolo.
            var user = await _userRepository
                .GetByIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            if (user is null)
            {
                return OperationResult<UpsertPatientProfileResult>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            if (user.Role != UserRole.Patient)
            {
                return OperationResult<UpsertPatientProfileResult>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Patient' richiesto per questo tipo di profilo.");
            }

            var now = DateTime.UtcNow;

            // Normalizza la data di nascita imponendo semantica temporale esplicita.
            if (!UtcDateTimeInput.TryNormalizeRequired(request.DateOfBirthUtc, "dateOfBirthUtc", out var dateOfBirthUtc, out var dateOfBirthError))
            {
                return OperationResult<UpsertPatientProfileResult>.BadRequest(
                    "invalid_datetime",
                    dateOfBirthError!);
            }

            // Verifica se per l'utente esiste già un profilo persistito.
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

                var dto = new PatientProfileDto(
                    profile.Id,
                    profile.UserId,
                    profile.FirstName,
                    profile.LastName,
                    profile.DateOfBirthUtc,
                    profile.Phone,
                    profile.Address
                );

                var payload = new UpsertPatientProfileResult(dto, true);
                return OperationResult<UpsertPatientProfileResult>.Success(payload);
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

            var updatedDto = new PatientProfileDto(
                existing.Id,
                existing.UserId,
                existing.FirstName,
                existing.LastName,
                existing.DateOfBirthUtc,
                existing.Phone,
                existing.Address
            );

            var updatedPayload = new UpsertPatientProfileResult(updatedDto, false);
            return OperationResult<UpsertPatientProfileResult>.Success(updatedPayload);
        }

        /*
         * Recupera il profilo professionale di un utente Clinician
         * dopo aver verificato esistenza utente e correttezza del ruolo.
         */
        public async Task<OperationResult<ClinicianProfileDto>> GetClinicianProfileAsync(
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
                return OperationResult<ClinicianProfileDto>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            // L'operazione è valida solo per utenti con ruolo Clinician.
            if (user.Role != UserRole.Clinician)
            {
                return OperationResult<ClinicianProfileDto>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Clinician' richiesto per questo tipo di profilo.");
            }

            // Recupera il profilo clinico associato all'utente.
            var profile = await _clinicianProfiles
                .GetByUserIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Se il profilo non esiste ancora, restituisce un not found applicativo.
            if (profile is null)
            {
                return OperationResult<ClinicianProfileDto>.NotFound(
                    "profile_not_found",
                    "Per l'utente specificato non è ancora stato registrato alcun profilo clinico.");
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
         * Crea oppure aggiorna il profilo di un utente Clinician,
         * restituendo anche l'informazione se l'operazione ha prodotto una creazione.
         */
        public async Task<OperationResult<UpsertClinicianProfileResult>> UpsertClinicianProfileAsync(
            Guid userId,
            UpsertClinicianProfileRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload è obbligatorio per poter creare o aggiornare il profilo.
            if (request is null)
            {
                return OperationResult<UpsertClinicianProfileResult>.BadRequest(
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
                return OperationResult<UpsertClinicianProfileResult>.BadRequest(
                    "invalid_payload",
                    "Nome, cognome, specializzazione, numero di iscrizione e sede principale sono obbligatori.");
            }

            // Recupera l'utente per verificare esistenza e ruolo.
            var user = await _userRepository
                .GetByIdAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            if (user is null)
            {
                return OperationResult<UpsertClinicianProfileResult>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            if (user.Role != UserRole.Clinician)
            {
                return OperationResult<UpsertClinicianProfileResult>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Clinician' richiesto per questo tipo di profilo.");
            }

            var now = DateTime.UtcNow;

            // Verifica se per l'utente esiste già un profilo clinico persistito.
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

                var payload = new UpsertClinicianProfileResult(dto, true);
                return OperationResult<UpsertClinicianProfileResult>.Success(payload);
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

            var updatedPayload = new UpsertClinicianProfileResult(updatedDto, false);
            return OperationResult<UpsertClinicianProfileResult>.Success(updatedPayload);
        }

        /*
         * Recupera l'elenco delle deleghe associate a un paziente,
         * dopo aver verificato validità dell'identificativo e ruolo dell'utente.
         */
        public async Task<OperationResult<IReadOnlyList<DelegationDto>>> GetPatientDelegationsAsync(
            Guid patientUserId,
            CancellationToken cancellationToken)
        {
            // L'identificativo del paziente deve essere valorizzato.
            if (patientUserId == Guid.Empty)
            {
                return OperationResult<IReadOnlyList<DelegationDto>>.BadRequest(
                    "invalid_user_id",
                    "L'identificativo del paziente non può essere vuoto.");
            }

            // Recupera l'utente per verificare esistenza e ruolo.
            var user = await _userRepository
                .GetByIdAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            if (user is null)
            {
                return OperationResult<IReadOnlyList<DelegationDto>>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            if (user.Role != UserRole.Patient)
            {
                return OperationResult<IReadOnlyList<DelegationDto>>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Patient' richiesto per la gestione delle deleghe.");
            }

            // Recupera tutte le deleghe del paziente indicato.
            var delegations = await _delegations
                .GetByPatientUserIdAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            // Mappa le entità di dominio in DTO di risposta.
            var dtoList = delegations
                .Select(MapDelegationToDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<DelegationDto>>.Success(dtoList);
        }

        /*
         * Crea una nuova delega oppure riattiva/aggiorna una delega esistente
         * tra un paziente e un delegato.
         */
        public async Task<OperationResult<DelegationDto>> CreateDelegationAsync(
            Guid patientUserId,
            CreateDelegationRequest? request,
            CancellationToken cancellationToken)
        {
            // Valida l'identificativo del paziente.
            if (patientUserId == Guid.Empty)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_user_id",
                    "L'identificativo del paziente non può essere vuoto.");
            }

            // Il payload è obbligatorio per poter creare la delega.
            if (request is null)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Il delegato deve essere indicato esplicitamente.
            if (request.DelegateUserId == Guid.Empty)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_delegate_id",
                    "L'identificativo del delegato è obbligatorio.");
            }

            // Lo scope applicativo della delega è obbligatorio.
            if (string.IsNullOrWhiteSpace(request.Scope))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_scope",
                    "Lo scope della delega è obbligatorio.");
            }

            // Normalizza l'inizio validità della delega imponendo semantica UTC esplicita.
            if (!UtcDateTimeInput.TryNormalizeRequired(request.StartsAtUtc, "startsAtUtc", out var normalizedStartsAtUtc, out var startsAtError))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_datetime",
                    startsAtError!);
            }

            // Normalizza la fine validità della delega imponendo semantica UTC esplicita.
            if (!UtcDateTimeInput.TryNormalizeRequired(request.EndsAtUtc, "endsAtUtc", out var normalizedEndsAtUtc, out var endsAtError))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_datetime",
                    endsAtError!);
            }

            // Verifica la coerenza dell'intervallo temporale della delega.
            if (normalizedStartsAtUtc >= normalizedEndsAtUtc)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_time_range",
                    "L'intervallo di validità della delega non è valido (StartsAt deve essere precedente a EndsAt).");
            }

            // Verifica che lo scope richiesto corrisponda a un valore valido dell'enum.
            if (!Enum.TryParse<DelegationScope>(request.Scope, ignoreCase: true, out var scope))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_scope",
                    "Il valore dello scope della delega non è valido.");
            }

            // Recupera e valida il paziente destinatario della delega.
            var patientUser = await _userRepository
                .GetByIdAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            if (patientUser is null)
            {
                return OperationResult<DelegationDto>.NotFound(
                    "user_not_found",
                    "L'utente paziente specificato non esiste.");
            }

            if (patientUser.Role != UserRole.Patient)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Patient' richiesto per la gestione delle deleghe.");
            }

            // Recupera e valida il delegato destinatario.
            var delegateUser = await _userRepository
                .GetByIdAsync(request.DelegateUserId, cancellationToken)
                .ConfigureAwait(false);

            if (delegateUser is null)
            {
                return OperationResult<DelegationDto>.NotFound(
                    "delegate_not_found",
                    "L'utente delegato specificato non esiste.");
            }

            if (delegateUser.Role != UserRole.Delegate)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_delegate_role",
                    "L'utente delegato specificato non ha il ruolo 'Delegate' richiesto per questa operazione.");
            }

            // Verifica se esiste già una delega per la stessa coppia paziente/delegato.
            var existing = await _delegations
                .GetByPatientAndDelegateAsync(patientUserId, request.DelegateUserId, cancellationToken)
                .ConfigureAwait(false);

            var nowUtc = DateTime.UtcNow;

            // Se esiste già una delega attiva, impedisce la duplicazione.
            if (existing is not null)
            {
                if (existing.Status == DelegationStatus.Active)
                {
                    return OperationResult<DelegationDto>.Conflict(
                        "delegation_already_exists",
                        "Esiste già una delega per questa coppia paziente/delegato.");
                }

                // Se la delega esiste ma non è attiva, la riattiva e ne aggiorna i dati principali.
                existing.Scope = scope;
                existing.Status = DelegationStatus.Active;
                existing.StartsAtUtc = normalizedStartsAtUtc;
                existing.EndsAtUtc = normalizedEndsAtUtc;

                await _delegations
                    .UpdateAsync(existing, cancellationToken)
                    .ConfigureAwait(false);

                var reusedDto = MapDelegationToDto(existing);
                return OperationResult<DelegationDto>.Success(reusedDto);
            }

            // Crea una nuova entità Delegation.
            var delegation = new Delegation
            {
                Id = Guid.NewGuid(),
                PatientUserId = patientUserId,
                DelegateUserId = request.DelegateUserId,
                Scope = scope,
                Status = DelegationStatus.Active,
                StartsAtUtc = normalizedStartsAtUtc,
                EndsAtUtc = normalizedEndsAtUtc,
                CreatedAtUtc = nowUtc
            };

            await _delegations
                .AddAsync(delegation, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapDelegationToDto(delegation);
            return OperationResult<DelegationDto>.Success(dto);
        }

        /*
         * Aggiorna lo stato di una delega esistente
         * dopo aver validato identificativo e nuovo stato richiesto.
         */
        public async Task<OperationResult<DelegationDto>> UpdateDelegationStatusAsync(
            Guid delegationId,
            UpdateDelegationStatusRequest? request,
            CancellationToken cancellationToken)
        {
            // L'identificativo della delega deve essere valorizzato.
            if (delegationId == Guid.Empty)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_delegation_id",
                    "L'identificativo della delega non può essere vuoto.");
            }

            // Il payload deve contenere uno stato esplicito e non vuoto.
            if (request is null || string.IsNullOrWhiteSpace(request.Status))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta deve specificare uno stato valido.");
            }

            // Verifica che il nuovo stato corrisponda a un valore valido dell'enum.
            if (!Enum.TryParse<DelegationStatus>(request.Status, ignoreCase: true, out var newStatus))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_status",
                    "Il valore dello stato della delega non è valido.");
            }

            // Recupera la delega da aggiornare.
            var delegation = await _delegations
                .GetByIdAsync(delegationId, cancellationToken)
                .ConfigureAwait(false);

            if (delegation is null)
            {
                return OperationResult<DelegationDto>.NotFound(
                    "delegation_not_found",
                    "La delega specificata non esiste.");
            }

            // Aggiorna lo stato della delega.
            delegation.Status = newStatus;

            await _delegations
                .UpdateAsync(delegation, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapDelegationToDto(delegation);
            return OperationResult<DelegationDto>.Success(dto);
        }

        /*
         * Aggiorna i permessi di una delega esistente
         * dopo aver validato identificativo e nuovo scope richiesto.
         */
        public async Task<OperationResult<DelegationDto>> UpdateDelegationPermissionsAsync(
            Guid delegationId,
            UpdateDelegationPermissionsRequest? request,
            CancellationToken cancellationToken)
        {
            // L'identificativo della delega deve essere valorizzato.
            if (delegationId == Guid.Empty)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_delegation_id",
                    "L'identificativo della delega non può essere vuoto.");
            }

            // Il payload deve contenere uno scope esplicito e non vuoto.
            if (request is null || string.IsNullOrWhiteSpace(request.Scope))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta deve specificare un insieme di permessi valido.");
            }

            // Verifica che il nuovo scope corrisponda a un valore valido dell'enum.
            if (!Enum.TryParse<DelegationScope>(request.Scope, ignoreCase: true, out var newScope))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_scope",
                    "Il valore dei permessi della delega non è valido.");
            }

            // Recupera la delega da aggiornare.
            var delegation = await _delegations
                .GetByIdAsync(delegationId, cancellationToken)
                .ConfigureAwait(false);

            if (delegation is null)
            {
                return OperationResult<DelegationDto>.NotFound(
                    "delegation_not_found",
                    "La delega specificata non esiste.");
            }

            // Aggiorna lo scope della delega.
            delegation.Scope = newScope;

            await _delegations
                .UpdateAsync(delegation, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapDelegationToDto(delegation);
            return OperationResult<DelegationDto>.Success(dto);
        }

        /*
         * Aggiorna i permessi di una delega appartenente al paziente corrente,
         * impedendo modifiche su deleghe di altri pazienti.
         */
        public async Task<OperationResult<DelegationDto>> UpdateMyDelegationPermissionsAsync(
            Guid patientUserId,
            Guid delegationId,
            UpdateDelegationPermissionsRequest? request,
            CancellationToken cancellationToken)
        {
            // Valida l'identificativo del paziente.
            if (patientUserId == Guid.Empty)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_user_id",
                    "L'identificativo del paziente non può essere vuoto.");
            }

            // Valida l'identificativo della delega.
            if (delegationId == Guid.Empty)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_delegation_id",
                    "L'identificativo della delega non può essere vuoto.");
            }

            // Il payload deve contenere uno scope esplicito e non vuoto.
            if (request is null || string.IsNullOrWhiteSpace(request.Scope))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta deve specificare un insieme di permessi valido.");
            }

            // Verifica che il nuovo scope corrisponda a un valore valido dell'enum.
            if (!Enum.TryParse<DelegationScope>(request.Scope, ignoreCase: true, out var newScope))
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_scope",
                    "Il valore dei permessi della delega non è valido.");
            }

            // Recupera e valida il paziente corrente.
            var patientUser = await _userRepository
                .GetByIdAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            if (patientUser is null)
            {
                return OperationResult<DelegationDto>.NotFound(
                    "user_not_found",
                    "L'utente paziente specificato non esiste.");
            }

            if (patientUser.Role != UserRole.Patient)
            {
                return OperationResult<DelegationDto>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Patient' richiesto per la gestione delle deleghe.");
            }

            // Recupera la delega da modificare.
            var delegation = await _delegations
                .GetByIdAsync(delegationId, cancellationToken)
                .ConfigureAwait(false);

            if (delegation is null)
            {
                return OperationResult<DelegationDto>.NotFound(
                    "delegation_not_found",
                    "La delega specificata non esiste.");
            }

            // Impedisce al paziente di modificare una delega che non gli appartiene.
            if (delegation.PatientUserId != patientUserId)
            {
                return OperationResult<DelegationDto>.Forbidden(
                    "delegation_forbidden",
                    "La delega specificata non appartiene al paziente corrente.");
            }

            // Aggiorna lo scope della delega.
            delegation.Scope = newScope;

            await _delegations
                .UpdateAsync(delegation, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapDelegationToDto(delegation);
            return OperationResult<DelegationDto>.Success(dto);
        }

        /*
         * Recupera l'elenco dei consensi associati a un paziente,
         * dopo aver verificato validità dell'identificativo e ruolo dell'utente.
         */
        public async Task<OperationResult<IReadOnlyList<ConsentDto>>> GetPatientConsentsAsync(
            Guid patientUserId,
            CancellationToken cancellationToken)
        {
            // L'identificativo del paziente deve essere valorizzato.
            if (patientUserId == Guid.Empty)
            {
                return OperationResult<IReadOnlyList<ConsentDto>>.BadRequest(
                    "invalid_user_id",
                    "L'identificativo del paziente non può essere vuoto.");
            }

            // Recupera e valida l'utente paziente.
            var user = await _userRepository
                .GetByIdAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            if (user is null)
            {
                return OperationResult<IReadOnlyList<ConsentDto>>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            if (user.Role != UserRole.Patient)
            {
                return OperationResult<IReadOnlyList<ConsentDto>>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Patient' richiesto per la gestione dei consensi.");
            }

            // Recupera tutti i consensi del paziente.
            var consents = await _consents
                .GetByPatientUserIdAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            // Mappa le entità di dominio in DTO di risposta.
            var dtoList = consents
                .Select(MapConsentToDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<ConsentDto>>.Success(dtoList);
        }

        /*
         * Crea oppure aggiorna in blocco i consensi di un paziente,
         * applicando le regole di normalizzazione e coerenza previste dal dominio.
         */
        public async Task<OperationResult<IReadOnlyList<ConsentDto>>> UpsertPatientConsentsAsync(
            Guid patientUserId,
            UpsertPatientConsentsRequest? request,
            CancellationToken cancellationToken)
        {
            // Valida l'identificativo del paziente.
            if (patientUserId == Guid.Empty)
            {
                return OperationResult<IReadOnlyList<ConsentDto>>.BadRequest(
                    "invalid_user_id",
                    "L'identificativo del paziente non può essere vuoto.");
            }

            // Deve essere presente almeno un consenso da elaborare.
            if (request is null || request.Consents is null || request.Consents.Count == 0)
            {
                return OperationResult<IReadOnlyList<ConsentDto>>.BadRequest(
                    "invalid_payload",
                    "È necessario specificare almeno un consenso da aggiornare.");
            }

            // Recupera e valida l'utente paziente.
            var user = await _userRepository
                .GetByIdAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            if (user is null)
            {
                return OperationResult<IReadOnlyList<ConsentDto>>.NotFound(
                    "user_not_found",
                    "L'utente specificato non esiste.");
            }

            if (user.Role != UserRole.Patient)
            {
                return OperationResult<IReadOnlyList<ConsentDto>>.BadRequest(
                    "invalid_user_role",
                    "L'utente specificato non ha il ruolo 'Patient' richiesto per la gestione dei consensi.");
            }

            var nowUtc = DateTime.UtcNow;

            // Elabora ciascun consenso richiesto uno per uno.
            foreach (var consentRequest in request.Consents)
            {
                // Il tipo di consenso è obbligatorio.
                if (string.IsNullOrWhiteSpace(consentRequest.Type))
                {
                    return OperationResult<IReadOnlyList<ConsentDto>>.BadRequest(
                        "invalid_consent_type",
                        "Il tipo di consenso è obbligatorio.");
                }

                // Verifica che il tipo corrisponda a un valore valido dell'enum.
                if (!Enum.TryParse<ConsentType>(consentRequest.Type, ignoreCase: true, out var type))
                {
                    return OperationResult<IReadOnlyList<ConsentDto>>.BadRequest(
                        "invalid_consent_type",
                        $"Il tipo di consenso '{consentRequest.Type}' non è valido.");
                }

                // Recupera l'eventuale consenso già esistente per quella tipologia.
                var existing = await _consents
                    .GetByPatientAndTypeAsync(patientUserId, type, cancellationToken)
                    .ConfigureAwait(false);

                // Normalizza il campo note, rendendolo null se privo di contenuto significativo.
                var normalizedNotes = string.IsNullOrWhiteSpace(consentRequest.Notes)
                    ? null
                    : consentRequest.Notes.Trim();

                // Se il consenso non esiste, ne crea uno nuovo.
                if (existing is null)
                {
                    var consent = new Consent
                    {
                        Id = Guid.NewGuid(),
                        PatientUserId = patientUserId,
                        Type = type,
                        Granted = consentRequest.Granted,
                        GrantedAtUtc = nowUtc,
                        RevokedAtUtc = consentRequest.Granted ? null : nowUtc,
                        Notes = normalizedNotes,
                        CreatedAtUtc = nowUtc
                    };

                    await _consents
                        .AddAsync(consent, cancellationToken)
                        .ConfigureAwait(false);
                }
                else
                {
                    // Se cambia il valore Granted, aggiorna i relativi timestamp coerentemente.
                    if (existing.Granted != consentRequest.Granted)
                    {
                        if (consentRequest.Granted)
                        {
                            existing.Granted = true;
                            existing.GrantedAtUtc = nowUtc;
                            existing.RevokedAtUtc = null;
                        }
                        else
                        {
                            existing.Granted = false;
                            existing.RevokedAtUtc = nowUtc;
                        }
                    }

                    // Aggiorna sempre le note con il valore normalizzato più recente.
                    existing.Notes = normalizedNotes;

                    await _consents
                        .UpdateAsync(existing, cancellationToken)
                        .ConfigureAwait(false);
                }
            }

            // Rilegge tutti i consensi aggiornati per restituire al chiamante la vista finale completa.
            var updatedConsents = await _consents
                .GetByPatientUserIdAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            var dtoList = updatedConsents
                .Select(MapConsentToDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<ConsentDto>>.Success(dtoList);
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
         * Converte un'entità Consent del dominio nel corrispondente DTO applicativo.
         */
        private static ConsentDto MapConsentToDto(Consent consent)
        {
            return new ConsentDto(
                consent.Id,
                consent.PatientUserId,
                consent.Type.ToString(),
                consent.Granted,
                consent.GrantedAtUtc,
                consent.RevokedAtUtc,
                consent.Notes,
                consent.CreatedAtUtc
            );
        }

        /*
         * DTO di output interno al servizio che rappresenta l'esito
         * di una operazione di upsert sul profilo paziente.
         */
        public sealed record UpsertPatientProfileResult(
            PatientProfileDto Profile,
            bool Created
        );

        /*
         * DTO di output interno al servizio che rappresenta l'esito
         * di una operazione di upsert sul profilo clinico.
         */
        public sealed record UpsertClinicianProfileResult(
            ClinicianProfileDto Profile,
            bool Created
        );
    }
}
