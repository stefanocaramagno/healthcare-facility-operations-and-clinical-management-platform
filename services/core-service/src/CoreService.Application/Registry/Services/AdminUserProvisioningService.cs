/*
 * File: services/core-service/src/CoreService.Application/Registry/Services/AdminUserProvisioningService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso amministrativi del dominio Registry relativi
 * al provisioning iniziale di utenti Patient, Delegate e Clinician,
 * con la contestuale creazione dei rispettivi profili applicativi.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Registry
 * e coordina i workflow con cui un amministratore può creare nuovi utenti
 * del sistema insieme ai relativi profili di dominio.
 * Per Patient e Delegate il flusso prevede anche l'invio dell'e-mail
 * di attivazione account; per Clinician l'account viene invece creato
 * già attivo.
 *
 * Responsabilità principali
 * -------------------------
 * - Creare utenti Patient con relativo profilo paziente.
 * - Creare utenti Delegate con relativo profilo delegato.
 * - Creare utenti Clinician con relativo profilo clinico.
 * - Validare gli input applicativi prima della persistenza.
 * - Verificare unicità di e-mail e, per i clinici, del numero di iscrizione.
 * - Coordinare l'invio dell'e-mail di attivazione quando richiesto.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IUserRepository
 * - IClinicianProfileRepository
 * - IAdminUserProvisioningRepository
 * - AccountActivationService
 * - PasswordSecurity
 * - UtcDateTimeInput
 * - Entità del dominio Registry
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza o invio e-mail,
 * che rimangono delegati ai repository e ai servizi dedicati.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Auth.Security;
using CoreService.Application.Auth.Services;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;

namespace CoreService.Application.Registry.Services
{
    public sealed class AdminUserProvisioningService
    {
        // Repository e servizi collaboratori necessari al provisioning
        // dei diversi tipi di utenti gestiti dall'amministratore.
        private readonly IUserRepository _userRepository;
        private readonly IClinicianProfileRepository _clinicianProfileRepository;
        private readonly IAdminUserProvisioningRepository _provisioningRepository;
        private readonly AccountActivationService _accountActivationService;

        /*
         * Inizializza il servizio di provisioning amministrativo
         * con tutte le dipendenze necessarie ai workflow applicativi.
         */
        public AdminUserProvisioningService(
            IUserRepository userRepository,
            IClinicianProfileRepository clinicianProfileRepository,
            IAdminUserProvisioningRepository provisioningRepository,
            AccountActivationService accountActivationService)
        {
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _clinicianProfileRepository = clinicianProfileRepository
                ?? throw new ArgumentNullException(nameof(clinicianProfileRepository));
            _provisioningRepository = provisioningRepository
                ?? throw new ArgumentNullException(nameof(provisioningRepository));
            _accountActivationService = accountActivationService
                ?? throw new ArgumentNullException(nameof(accountActivationService));
        }

        /*
         * Crea un nuovo utente Patient con relativo profilo anagrafico,
         * persiste i dati e avvia il flusso di invio dell'e-mail di attivazione.
         */
        public async Task<OperationResult<CreatedAdminPatientDto>> CreatePatientAsync(
            CreateAdminPatientRequest? request,
            CancellationToken cancellationToken = default)
        {
            // Il payload è obbligatorio per poter creare un nuovo paziente.
            if (request is null)
            {
                return OperationResult<CreatedAdminPatientDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Normalizza i principali campi testuali in ingresso
            // per evitare incoerenze dovute a spazi o casing.
            var email = PasswordSecurity.NormalizeEmail(request.Email);
            var password = request.Password?.Trim() ?? string.Empty;
            var firstName = request.FirstName?.Trim() ?? string.Empty;
            var lastName = request.LastName?.Trim() ?? string.Empty;
            var phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
            var address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim();

            // Verifica la presenza dei campi minimi richiesti dal provisioning.
            if (string.IsNullOrWhiteSpace(email) ||
                string.IsNullOrWhiteSpace(password) ||
                string.IsNullOrWhiteSpace(firstName) ||
                string.IsNullOrWhiteSpace(lastName))
            {
                return OperationResult<CreatedAdminPatientDto>.BadRequest(
                    "invalid_payload",
                    "E-mail, password, nome e cognome sono obbligatori.");
            }

            // Applica una validazione minima sulla robustezza della password.
            if (password.Length < 8)
            {
                return OperationResult<CreatedAdminPatientDto>.BadRequest(
                    "invalid_password",
                    "La password deve contenere almeno 8 caratteri.");
            }

            // Verifica che non esista già un account registrato con la stessa e-mail.
            var existingUser = await _userRepository
                .GetByEmailAsync(email, cancellationToken)
                .ConfigureAwait(false);

            if (existingUser is not null)
            {
                return OperationResult<CreatedAdminPatientDto>.Conflict(
                    "email_already_exists",
                    "Esiste già un account registrato con questa e-mail.");
            }

            var nowUtc = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            // Normalizza la data di nascita imponendo una semantica temporale esplicita.
            if (!UtcDateTimeInput.TryNormalizeRequired(request.DateOfBirthUtc, "dateOfBirthUtc", out var dateOfBirthUtc, out var dateOfBirthError))
            {
                return OperationResult<CreatedAdminPatientDto>.BadRequest(
                    "invalid_datetime",
                    dateOfBirthError!);
            }

            // Costruisce l'entità User del nuovo paziente.
            var user = new User
            {
                Id = userId,
                Email = email,
                PasswordHash = PasswordSecurity.HashPassword(password),
                Role = UserRole.Patient,
                IsActive = false,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            // Costruisce il profilo anagrafico del nuovo paziente.
            var profile = new PatientProfile
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                FirstName = firstName,
                LastName = lastName,
                DateOfBirthUtc = dateOfBirthUtc,
                Phone = phone,
                Address = address,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            // Persiste in modo coordinato utente e profilo paziente.
            await _provisioningRepository
                .CreatePatientWithProfileAsync(user, profile, cancellationToken)
                .ConfigureAwait(false);

            // Avvia il workflow di invio dell'e-mail di attivazione account.
            var activationResult = await _accountActivationService
                .SendActivationEmailAsync(user, cancellationToken)
                .ConfigureAwait(false);

            // Se l'invio dell'e-mail fallisce, converte l'errore in un esito applicativo coerente.
            if (activationResult.IsFailure)
            {
                return OperationResult<CreatedAdminPatientDto>.Failure(
                    activationResult.StatusCode,
                    activationResult.ErrorCode ?? "activation_email_delivery_failed",
                    activationResult.ErrorMessage ?? "Impossibile inviare l'e-mail di attivazione account.");
            }

            // Mappa il profilo creato nel DTO da restituire al chiamante.
            var profileDto = new PatientProfileDto(
                profile.Id,
                profile.UserId,
                profile.FirstName,
                profile.LastName,
                profile.DateOfBirthUtc,
                profile.Phone,
                profile.Address);

            // Costruisce il DTO finale del nuovo paziente provisioned.
            var dto = new CreatedAdminPatientDto(
                user.Id,
                user.Email,
                user.IsActive,
                user.Role.ToString(),
                true,
                profileDto);

            return OperationResult<CreatedAdminPatientDto>.Success(dto);
        }

        /*
         * Crea un nuovo utente Delegate con relativo profilo,
         * persiste i dati e avvia il flusso di invio dell'e-mail di attivazione.
         */
        public async Task<OperationResult<CreatedAdminDelegateDto>> CreateDelegateAsync(
            CreateAdminDelegateRequest? request,
            CancellationToken cancellationToken = default)
        {
            // Il payload è obbligatorio per poter creare un nuovo delegato.
            if (request is null)
            {
                return OperationResult<CreatedAdminDelegateDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Normalizza i principali campi testuali in ingresso.
            var email = PasswordSecurity.NormalizeEmail(request.Email);
            var password = request.Password?.Trim() ?? string.Empty;
            var firstName = request.FirstName?.Trim() ?? string.Empty;
            var lastName = request.LastName?.Trim() ?? string.Empty;
            var phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
            var address = string.IsNullOrWhiteSpace(request.Address) ? null : request.Address.Trim();

            // Verifica la presenza dei campi minimi richiesti dal provisioning.
            if (string.IsNullOrWhiteSpace(email) ||
                string.IsNullOrWhiteSpace(password) ||
                string.IsNullOrWhiteSpace(firstName) ||
                string.IsNullOrWhiteSpace(lastName))
            {
                return OperationResult<CreatedAdminDelegateDto>.BadRequest(
                    "invalid_payload",
                    "E-mail, password, nome e cognome sono obbligatori.");
            }

            // Applica una validazione minima sulla robustezza della password.
            if (password.Length < 8)
            {
                return OperationResult<CreatedAdminDelegateDto>.BadRequest(
                    "invalid_password",
                    "La password deve contenere almeno 8 caratteri.");
            }

            // Verifica che non esista già un account registrato con la stessa e-mail.
            var existingUser = await _userRepository
                .GetByEmailAsync(email, cancellationToken)
                .ConfigureAwait(false);

            if (existingUser is not null)
            {
                return OperationResult<CreatedAdminDelegateDto>.Conflict(
                    "email_already_exists",
                    "Esiste già un account registrato con questa e-mail.");
            }

            var nowUtc = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            // Costruisce l'entità User del nuovo delegato.
            var user = new User
            {
                Id = userId,
                Email = email,
                PasswordHash = PasswordSecurity.HashPassword(password),
                Role = UserRole.Delegate,
                IsActive = false,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            // Costruisce il profilo del nuovo delegato.
            var profile = new DelegateProfile
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                FirstName = firstName,
                LastName = lastName,
                Phone = phone,
                Address = address,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            // Persiste in modo coordinato utente e profilo delegate.
            await _provisioningRepository
                .CreateDelegateWithProfileAsync(user, profile, cancellationToken)
                .ConfigureAwait(false);

            // Avvia il workflow di invio dell'e-mail di attivazione account.
            var activationResult = await _accountActivationService
                .SendActivationEmailAsync(user, cancellationToken)
                .ConfigureAwait(false);

            // Se l'invio dell'e-mail fallisce, converte l'errore in un esito applicativo coerente.
            if (activationResult.IsFailure)
            {
                return OperationResult<CreatedAdminDelegateDto>.Failure(
                    activationResult.StatusCode,
                    activationResult.ErrorCode ?? "activation_email_delivery_failed",
                    activationResult.ErrorMessage ?? "Impossibile inviare l'e-mail di attivazione account.");
            }

            // Mappa il profilo creato nel DTO da restituire al chiamante.
            var profileDto = new DelegateProfileDto(
                profile.Id,
                profile.UserId,
                profile.FirstName,
                profile.LastName,
                profile.Phone,
                profile.Address);

            // Costruisce il DTO finale del nuovo delegato provisioned.
            var dto = new CreatedAdminDelegateDto(
                user.Id,
                user.Email,
                user.IsActive,
                user.Role.ToString(),
                true,
                profileDto);

            return OperationResult<CreatedAdminDelegateDto>.Success(dto);
        }

        /*
         * Crea un nuovo utente Clinician con relativo profilo professionale,
         * persistendo i dati iniziali con account già attivo.
         */
        public async Task<OperationResult<CreatedAdminClinicianDto>> CreateClinicianAsync(
            CreateAdminClinicianRequest? request,
            CancellationToken cancellationToken = default)
        {
            // Il payload è obbligatorio per poter creare un nuovo clinico.
            if (request is null)
            {
                return OperationResult<CreatedAdminClinicianDto>.BadRequest(
                    "invalid_payload",
                    "Il corpo della richiesta non può essere nullo.");
            }

            // Normalizza i principali campi testuali in ingresso.
            var email = PasswordSecurity.NormalizeEmail(request.Email);
            var password = request.Password?.Trim() ?? string.Empty;
            var firstName = request.FirstName?.Trim() ?? string.Empty;
            var lastName = request.LastName?.Trim() ?? string.Empty;
            var phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
            var specialty = request.Specialty?.Trim() ?? string.Empty;
            var licenseNumber = request.LicenseNumber?.Trim() ?? string.Empty;
            var officeLocation = request.OfficeLocation?.Trim() ?? string.Empty;

            // Verifica la presenza di tutti i campi obbligatori del provisioning clinico.
            if (string.IsNullOrWhiteSpace(email) ||
                string.IsNullOrWhiteSpace(password) ||
                string.IsNullOrWhiteSpace(firstName) ||
                string.IsNullOrWhiteSpace(lastName) ||
                string.IsNullOrWhiteSpace(specialty) ||
                string.IsNullOrWhiteSpace(licenseNumber) ||
                string.IsNullOrWhiteSpace(officeLocation))
            {
                return OperationResult<CreatedAdminClinicianDto>.BadRequest(
                    "invalid_payload",
                    "E-mail, password, nome, cognome, specializzazione, numero di iscrizione e sede principale sono obbligatori.");
            }

            // Applica una validazione minima sulla robustezza della password.
            if (password.Length < 8)
            {
                return OperationResult<CreatedAdminClinicianDto>.BadRequest(
                    "invalid_password",
                    "La password deve contenere almeno 8 caratteri.");
            }

            // Verifica che non esista già un account registrato con la stessa e-mail.
            var existingUser = await _userRepository
                .GetByEmailAsync(email, cancellationToken)
                .ConfigureAwait(false);

            if (existingUser is not null)
            {
                return OperationResult<CreatedAdminClinicianDto>.Conflict(
                    "email_already_exists",
                    "Esiste già un account registrato con questa e-mail.");
            }

            // Verifica l'unicità del numero di iscrizione professionale del clinico.
            var existingClinician = await _clinicianProfileRepository
                .GetByLicenseNumberAsync(licenseNumber, cancellationToken)
                .ConfigureAwait(false);

            if (existingClinician is not null)
            {
                return OperationResult<CreatedAdminClinicianDto>.Conflict(
                    "license_number_already_exists",
                    "Esiste già un clinico registrato con questo numero di iscrizione.");
            }

            var nowUtc = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            // Costruisce l'entità User del nuovo clinico.
            // In questo caso l'account viene creato direttamente attivo.
            var user = new User
            {
                Id = userId,
                Email = email,
                PasswordHash = PasswordSecurity.HashPassword(password),
                Role = UserRole.Clinician,
                IsActive = true,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            // Costruisce il profilo professionale del nuovo clinico.
            var profile = new ClinicianProfile
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                FirstName = firstName,
                LastName = lastName,
                Phone = phone,
                Specialty = specialty,
                LicenseNumber = licenseNumber,
                OfficeLocation = officeLocation,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            // Persiste in modo coordinato utente e profilo clinico.
            await _provisioningRepository
                .CreateClinicianWithProfileAsync(user, profile, cancellationToken)
                .ConfigureAwait(false);

            // Mappa il profilo creato nel DTO da restituire al chiamante.
            var profileDto = new ClinicianProfileDto(
                profile.Id,
                profile.UserId,
                profile.FirstName,
                profile.LastName,
                profile.Phone,
                profile.Specialty,
                profile.LicenseNumber,
                profile.OfficeLocation ?? string.Empty);

            // Costruisce il DTO finale del nuovo clinico provisioned.
            var dto = new CreatedAdminClinicianDto(
                user.Id,
                user.Email,
                user.IsActive,
                user.Role.ToString(),
                profileDto);

            return OperationResult<CreatedAdminClinicianDto>.Success(dto);
        }
    }
}
