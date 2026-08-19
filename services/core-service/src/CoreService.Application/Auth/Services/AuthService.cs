/*
 * File: services/core-service/src/CoreService.Application/Auth/Services/AuthService.cs
 *
 * Scopo
 * -----
 * Implementare i principali casi d'uso del dominio Auth relativi a registrazione,
 * login, logout, gestione revoca token e recupero credenziali.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Auth
 * e coordina i workflow applicativi che coinvolgono utenti,
 * profili, token di reset password, attivazione account
 * e revoca dei token di accesso.
 *
 * Responsabilità principali
 * -------------------------
 * - Registrare nuovi utenti Patient e Delegate.
 * - Effettuare il login verificando credenziali e stato di attivazione account.
 * - Gestire il logout persistendo la revoca del token JWT.
 * - Verificare se un token di accesso è stato revocato.
 * - Avviare il workflow di reset password.
 * - Completare il reset password validando il token ricevuto.
 *
 * Interazioni principali
 * ----------------------
 * - IUserRepository
 * - IPasswordResetTokenRepository
 * - IAdminUserProvisioningRepository
 * - IRevokedAccessTokenRepository
 * - IPasswordResetEmailSender
 * - PasswordResetFlowOptions
 * - AccountActivationService
 * - PasswordSecurity
 * - UtcDateTimeInput
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza o invio e-mail,
 * che rimangono delegati a repository e abstraction dedicati.
 */

using System;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Auth.Abstractions;
using CoreService.Application.Auth.Options;
using CoreService.Application.Auth.Security;
using CoreService.Application.Common;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;

namespace CoreService.Application.Auth.Services
{
    public sealed class AuthService
    {
        // Repository e servizi collaboratori necessari ai workflow Auth.
        private readonly IUserRepository _userRepository;
        private readonly IPasswordResetTokenRepository _passwordResetTokenRepository;
        private readonly IAdminUserProvisioningRepository _adminUserProvisioningRepository;
        private readonly IRevokedAccessTokenRepository _revokedAccessTokenRepository;
        private readonly IPasswordResetEmailSender _passwordResetEmailSender;
        private readonly PasswordResetFlowOptions _passwordResetFlowOptions;
        private readonly AccountActivationService _accountActivationService;

        /*
         * Inizializza il servizio Auth con tutte le dipendenze necessarie
         * alla gestione dei workflow di autenticazione e credenziali.
         */
        public AuthService(
            IUserRepository userRepository,
            IPasswordResetTokenRepository passwordResetTokenRepository,
            IAdminUserProvisioningRepository adminUserProvisioningRepository,
            IRevokedAccessTokenRepository revokedAccessTokenRepository,
            IPasswordResetEmailSender passwordResetEmailSender,
            PasswordResetFlowOptions passwordResetFlowOptions,
            AccountActivationService accountActivationService)
        {
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _passwordResetTokenRepository = passwordResetTokenRepository
                ?? throw new ArgumentNullException(nameof(passwordResetTokenRepository));
            _adminUserProvisioningRepository = adminUserProvisioningRepository
                ?? throw new ArgumentNullException(nameof(adminUserProvisioningRepository));
            _revokedAccessTokenRepository = revokedAccessTokenRepository
                ?? throw new ArgumentNullException(nameof(revokedAccessTokenRepository));
            _passwordResetEmailSender = passwordResetEmailSender
                ?? throw new ArgumentNullException(nameof(passwordResetEmailSender));
            _passwordResetFlowOptions = passwordResetFlowOptions
                ?? throw new ArgumentNullException(nameof(passwordResetFlowOptions));
            _accountActivationService = accountActivationService
                ?? throw new ArgumentNullException(nameof(accountActivationService));
        }

        /*
         * Registra un nuovo utente Patient con relativo profilo anagrafico,
         * persiste i dati iniziali e invia l'e-mail di attivazione account.
         */
        public async Task<OperationResult<PendingActivationUser>> RegisterPatientAsync(
            string email,
            string password,
            string firstName,
            string lastName,
            DateTime dateOfBirthUtc,
            string? phone,
            string? address,
            CancellationToken cancellationToken = default)
        {
            // Normalizza i principali campi di input per evitare incoerenze
            // dovute a spazi superflui o differenze di maiuscole/minuscole.
            email = PasswordSecurity.NormalizeEmail(email);
            password = password?.Trim() ?? string.Empty;
            firstName = firstName?.Trim() ?? string.Empty;
            lastName = lastName?.Trim() ?? string.Empty;
            phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
            address = string.IsNullOrWhiteSpace(address) ? null : address.Trim();

            // Verifica la presenza dei campi obbligatori minimi richiesti dalla registrazione.
            if (string.IsNullOrWhiteSpace(email) ||
                string.IsNullOrWhiteSpace(password) ||
                string.IsNullOrWhiteSpace(firstName) ||
                string.IsNullOrWhiteSpace(lastName))
            {
                return OperationResult<PendingActivationUser>.BadRequest(
                    "invalid_request",
                    "E-mail, password, nome e cognome sono obbligatori.");
            }

            // Applica una validazione minima sulla robustezza della password.
            if (password.Length < 8)
            {
                return OperationResult<PendingActivationUser>.BadRequest(
                    "invalid_password",
                    "La password deve contenere almeno 8 caratteri.");
            }

            // Verifica che non esista già un utente registrato con la stessa e-mail.
            var existingUser = await _userRepository
                .GetByEmailAsync(email, cancellationToken)
                .ConfigureAwait(false);

            if (existingUser is not null)
            {
                return OperationResult<PendingActivationUser>.Conflict(
                    "email_already_exists",
                    "Esiste già un account registrato con questa e-mail.");
            }

            var nowUtc = DateTime.UtcNow;
            var userId = Guid.NewGuid();

            // Normalizza e valida la data di nascita imponendo una semantica temporale non ambigua.
            if (!UtcDateTimeInput.TryNormalizeRequired(dateOfBirthUtc, "dateOfBirthUtc", out var normalizedDateOfBirthUtc, out var dateOfBirthError))
            {
                return OperationResult<PendingActivationUser>.BadRequest(
                    "invalid_datetime",
                    dateOfBirthError!);
            }

            // Costruisce l'entità User iniziale del nuovo paziente.
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
                DateOfBirthUtc = normalizedDateOfBirthUtc,
                Phone = phone,
                Address = address,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            // Persiste in modo atomico utente e profilo tramite repository di provisioning.
            await _adminUserProvisioningRepository
                .CreatePatientWithProfileAsync(user, profile, cancellationToken)
                .ConfigureAwait(false);

            // Avvia il workflow di invio dell'e-mail di attivazione account.
            var activationResult = await _accountActivationService
                .SendActivationEmailAsync(user, cancellationToken)
                .ConfigureAwait(false);

            // Propaga l'eventuale errore applicativo relativo al recapito dell'e-mail di attivazione.
            if (activationResult.IsFailure)
            {
                return OperationResult<PendingActivationUser>.Failure(
                    activationResult.StatusCode,
                    activationResult.ErrorCode ?? "activation_email_delivery_failed",
                    activationResult.ErrorMessage ?? "Impossibile inviare l'e-mail di attivazione account.");
            }

            // Costruisce il DTO di risposta sintetico per l'utente registrato ma non ancora attivato.
            var pendingActivationUser = new PendingActivationUser
            {
                UserId = user.Id,
                Email = user.Email,
                Role = user.Role.ToString(),
                IsActive = user.IsActive
            };

            return OperationResult<PendingActivationUser>.Success(pendingActivationUser);
        }

        /*
         * Registra un nuovo utente Delegate con relativo profilo,
         * persiste i dati iniziali e invia l'e-mail di attivazione account.
         */
        public async Task<OperationResult<PendingActivationUser>> RegisterDelegateAsync(
            string firstName,
            string lastName,
            string? phone,
            string? address,
            string email,
            string password,
            CancellationToken cancellationToken = default)
        {
            // Normalizza i campi di input del delegato.
            firstName = firstName?.Trim() ?? string.Empty;
            lastName = lastName?.Trim() ?? string.Empty;
            phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
            address = string.IsNullOrWhiteSpace(address) ? null : address.Trim();
            email = PasswordSecurity.NormalizeEmail(email);
            password = password?.Trim() ?? string.Empty;

            // Verifica la presenza dei campi minimi richiesti.
            if (string.IsNullOrWhiteSpace(firstName) ||
                string.IsNullOrWhiteSpace(lastName) ||
                string.IsNullOrWhiteSpace(email) ||
                string.IsNullOrWhiteSpace(password))
            {
                return OperationResult<PendingActivationUser>.BadRequest(
                    "invalid_request",
                    "Nome, cognome, e-mail e password sono obbligatori.");
            }

            // Applica una validazione minima sulla password.
            if (password.Length < 8)
            {
                return OperationResult<PendingActivationUser>.BadRequest(
                    "invalid_password",
                    "La password deve contenere almeno 8 caratteri.");
            }

            // Verifica che l'e-mail non sia già stata registrata.
            var existingUser = await _userRepository
                .GetByEmailAsync(email, cancellationToken)
                .ConfigureAwait(false);

            if (existingUser is not null)
            {
                return OperationResult<PendingActivationUser>.Conflict(
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

            // Costruisce il profilo anagrafico del nuovo delegato.
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

            // Persiste in modo atomico utente e profilo del delegato.
            await _adminUserProvisioningRepository
                .CreateDelegateWithProfileAsync(user, profile, cancellationToken)
                .ConfigureAwait(false);

            // Avvia il workflow di invio dell'e-mail di attivazione account.
            var activationResult = await _accountActivationService
                .SendActivationEmailAsync(user, cancellationToken)
                .ConfigureAwait(false);

            // Propaga l'eventuale errore relativo alla consegna dell'e-mail di attivazione.
            if (activationResult.IsFailure)
            {
                return OperationResult<PendingActivationUser>.Failure(
                    activationResult.StatusCode,
                    activationResult.ErrorCode ?? "activation_email_delivery_failed",
                    activationResult.ErrorMessage ?? "Impossibile inviare l'e-mail di attivazione account.");
            }

            // Costruisce il DTO di risposta per l'utente registrato in attesa di attivazione.
            var pendingActivationUser = new PendingActivationUser
            {
                UserId = user.Id,
                Email = user.Email,
                Role = user.Role.ToString(),
                IsActive = user.IsActive
            };

            return OperationResult<PendingActivationUser>.Success(pendingActivationUser);
        }

        /*
         * Esegue il login verificando credenziali, esistenza utente
         * e stato di attivazione dell'account.
         */
        public async Task<OperationResult<AuthenticatedUser>> LoginAsync(
            string email,
            string password,
            CancellationToken cancellationToken = default)
        {
            // Normalizza e-mail e password prima della verifica.
            email = PasswordSecurity.NormalizeEmail(email);
            password = password?.Trim() ?? string.Empty;

            // Richiede esplicitamente entrambi i campi.
            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            {
                return OperationResult<AuthenticatedUser>.BadRequest(
                    "invalid_request",
                    "E-mail e password sono obbligatorie.");
            }

            // Recupera l'utente a partire dall'e-mail fornita.
            var user = await _userRepository
                .GetByEmailAsync(email, cancellationToken)
                .ConfigureAwait(false);

            // Verifica esistenza utente e correttezza della password.
            if (user is null || !PasswordSecurity.VerifyPassword(password, user.PasswordHash))
            {
                return OperationResult<AuthenticatedUser>.Failure(
                    statusCode: 401,
                    errorCode: "invalid_credentials",
                    errorMessage: "E-mail o password non validi.");
            }

            // Impedisce l'accesso ad account non ancora attivati.
            if (!user.IsActive)
            {
                return OperationResult<AuthenticatedUser>.Forbidden(
                    "account_not_activated",
                    "L'account non è ancora attivo. Verifica l'e-mail ricevuta per completare l'attivazione.");
            }

            // Costruisce il risultato autenticato che verrà poi tradotto dal controller in JWT.
            var authenticatedUser = new AuthenticatedUser
            {
                UserId = user.Id,
                Email = user.Email,
                Role = user.Role.ToString()
            };

            return OperationResult<AuthenticatedUser>.Success(authenticatedUser);
        }

        /*
         * Gestisce il logout persistendo il token di accesso corrente
         * all'interno dell'archivio dei token revocati.
         */
        public async Task LogoutAsync(
            Guid userId,
            string rawAccessToken,
            DateTime expiresAtUtc,
            CancellationToken cancellationToken = default)
        {
            // Se mancano i dati minimi necessari, il metodo termina senza effetti.
            if (userId == Guid.Empty || string.IsNullOrWhiteSpace(rawAccessToken))
            {
                return;
            }

            var nowUtc = DateTime.UtcNow;

            // Costruisce l'entità di revoca contenente l'hash del token
            // e i metadati utili al controllo successivo.
            var revokedToken = new RevokedAccessToken
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                TokenHash = PasswordSecurity.ComputeTokenHash(rawAccessToken.Trim()),
                ExpiresAtUtc = expiresAtUtc,
                RevokedAtUtc = nowUtc,
                Reason = "logout",
                CreatedAtUtc = nowUtc
            };

            // Persiste il token revocato per impedirne l'uso futuro.
            await _revokedAccessTokenRepository
                .AddAsync(revokedToken, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Verifica se un token di accesso risulta attualmente revocato
         * sulla base del suo hash persistito.
         */
        public Task<bool> IsAccessTokenRevokedAsync(
            string rawAccessToken,
            CancellationToken cancellationToken = default)
        {
            // Un token assente viene considerato non revocato
            // perché il controllo di presenza avviene a monte.
            if (string.IsNullOrWhiteSpace(rawAccessToken))
            {
                return Task.FromResult(false);
            }

            // Calcola l'hash del token e delega al repository
            // il controllo di esistenza della revoca ancora attiva.
            var tokenHash = PasswordSecurity.ComputeTokenHash(rawAccessToken.Trim());
            return _revokedAccessTokenRepository.ExistsActiveByTokenHashAsync(tokenHash, cancellationToken);
        }

        /*
         * Avvia il workflow di reset password generando un token,
         * persistendolo e inviando all'utente il link di reset via e-mail.
         */
        public async Task<OperationResult<bool>> RequestPasswordResetAsync(
            string email,
            CancellationToken cancellationToken = default)
        {
            // Normalizza l'e-mail ricevuta in input.
            email = PasswordSecurity.NormalizeEmail(email);

            // L'e-mail è un dato obbligatorio per avviare il recupero credenziali.
            if (string.IsNullOrWhiteSpace(email))
            {
                return OperationResult<bool>.BadRequest(
                    "invalid_request",
                    "L'e-mail è obbligatoria.");
            }

            // Recupera l'utente associato all'e-mail indicata.
            var user = await _userRepository
                .GetByEmailAsync(email, cancellationToken)
                .ConfigureAwait(false);

            // Per evitare enumeration dell'esistenza utenti,
            // in caso di assenza viene comunque restituito successo.
            if (user is null)
            {
                return OperationResult<bool>.Success(true);
            }

            // Genera un token casuale in chiaro e ne calcola l'hash persistibile.
            var rawToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            var tokenHash = PasswordSecurity.ComputeTokenHash(rawToken);

            var nowUtc = DateTime.UtcNow;
            var expiresAtUtc = nowUtc.Add(_passwordResetFlowOptions.TokenLifetime);

            // Costruisce l'entità del token di reset password.
            var resetToken = new PasswordResetToken
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                TokenHash = tokenHash,
                CreatedAtUtc = nowUtc,
                ExpiresAtUtc = expiresAtUtc,
                UsedAtUtc = null
            };

            // Persiste il token di reset.
            await _passwordResetTokenRepository
                .AddAsync(resetToken, cancellationToken)
                .ConfigureAwait(false);

            // Costruisce il link frontend di reset password da inviare all'utente.
            var resetLink = _passwordResetFlowOptions.BuildResetLink(rawToken);

            try
            {
                // Invoca il sender astratto per il recapito dell'e-mail di reset.
                await _passwordResetEmailSender
                    .SendPasswordResetEmailAsync(user.Email, resetLink, expiresAtUtc, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Propaga correttamente le cancellazioni cooperative.
                throw;
            }
            catch
            {
                // Converte gli errori tecnici di invio in un esito applicativo consistente.
                return OperationResult<bool>.Failure(
                    statusCode: 500,
                    errorCode: "password_reset_delivery_failed",
                    errorMessage: "Impossibile inviare l'e-mail di recupero credenziali. Riprovare più tardi.");
            }

            return OperationResult<bool>.Success(true);
        }

        /*
         * Completa il reset password validando il token ricevuto,
         * aggiornando l'hash password dell'utente e marcando il token come usato.
         */
        public async Task<OperationResult<bool>> ResetPasswordAsync(
            string token,
            string newPassword,
            CancellationToken cancellationToken = default)
        {
            // Normalizza i dati in ingresso.
            token = token?.Trim() ?? string.Empty;
            newPassword = newPassword?.Trim() ?? string.Empty;

            // Token e nuova password sono entrambi obbligatori.
            if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(newPassword))
            {
                return OperationResult<bool>.BadRequest(
                    "invalid_request",
                    "Token e nuova password sono obbligatori.");
            }

            // Applica una validazione minima sulla robustezza della nuova password.
            if (newPassword.Length < 8)
            {
                return OperationResult<bool>.BadRequest(
                    "invalid_password",
                    "La password deve contenere almeno 8 caratteri.");
            }

            // Calcola l'hash del token ricevuto per confrontarlo con il valore persistito.
            var tokenHash = PasswordSecurity.ComputeTokenHash(token);

            // Recupera il token solo se ancora valido, non scaduto e non già usato.
            var resetToken = await _passwordResetTokenRepository
                .GetValidByTokenHashAsync(tokenHash, cancellationToken)
                .ConfigureAwait(false);

            if (resetToken is null)
            {
                return OperationResult<bool>.Failure(
                    statusCode: 400,
                    errorCode: "invalid_or_expired_token",
                    errorMessage: "Il token di reset non è valido o è scaduto.");
            }

            // Recupera l'utente associato al token di reset.
            var user = await _userRepository
                .GetByIdAsync(resetToken.UserId, cancellationToken)
                .ConfigureAwait(false);

            if (user is null)
            {
                return OperationResult<bool>.Failure(
                    statusCode: 400,
                    errorCode: "user_not_available",
                    errorMessage: "L'utente associato al token non è disponibile.");
            }

            // Aggiorna l'hash password e il timestamp di modifica dell'utente.
            user.PasswordHash = PasswordSecurity.HashPassword(newPassword);
            user.UpdatedAtUtc = DateTime.UtcNow;

            // Marca il token come usato per impedirne riutilizzi successivi.
            resetToken.UsedAtUtc = DateTime.UtcNow;

            // Persiste prima l'aggiornamento utente...
            await _userRepository
                .UpdateAsync(user, cancellationToken)
                .ConfigureAwait(false);

            // ...e poi lo stato del token di reset.
            await _passwordResetTokenRepository
                .UpdateAsync(resetToken, cancellationToken)
                .ConfigureAwait(false);

            return OperationResult<bool>.Success(true);
        }

        /*
         * Rappresenta l'utente autenticato restituito dal workflow di login
         * prima della generazione del token JWT.
         */
        public sealed class AuthenticatedUser
        {
            // Identificativo univoco dell'utente autenticato.
            public Guid UserId { get; init; }

            // E-mail dell'utente autenticato.
            public string Email { get; init; } = string.Empty;

            // Ruolo applicativo dell'utente autenticato.
            public string Role { get; init; } = string.Empty;
        }

        /*
         * Rappresenta l'utente registrato ma ancora in attesa
         * della completa attivazione dell'account.
         */
        public sealed class PendingActivationUser
        {
            // Identificativo univoco del nuovo utente registrato.
            public Guid UserId { get; init; }

            // E-mail del nuovo utente registrato.
            public string Email { get; init; } = string.Empty;

            // Ruolo applicativo del nuovo utente registrato.
            public string Role { get; init; } = string.Empty;

            // Stato attuale di attivazione dell'account.
            public bool IsActive { get; init; }
        }
    }
}
