/*
 * File: services/core-service/src/CoreService.Application/Auth/Services/AccountActivationService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi all'invio,
 * al reinvio e alla validazione dei token di attivazione account.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Auth
 * e coordina il workflow di attivazione account, occupandosi
 * della generazione dei token, della loro persistenza,
 * della costruzione dei link di conferma e dell'attivazione effettiva
 * dell'utente a seguito della conferma.
 *
 * Responsabilità principali
 * -------------------------
 * - Generare e persistere token di attivazione account.
 * - Inviare e-mail di attivazione account agli utenti non attivi.
 * - Reinviare e-mail di attivazione su richiesta.
 * - Validare un token di attivazione ricevuto dal client.
 * - Attivare l'utente associato al token valido.
 * - Marcare come utilizzato il token di attivazione consumato.
 *
 * Interazioni principali
 * ----------------------
 * - IUserRepository
 * - IAccountActivationTokenRepository
 * - IAccountActivationEmailSender
 * - AccountActivationFlowOptions
 * - PasswordSecurity
 * - Entità del dominio Registry
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza o recapito e-mail,
 * che rimangono delegati a repository e abstraction dedicate.
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
    public sealed class AccountActivationService
    {
        // Repository e collaboratori necessari al workflow di attivazione account.
        private readonly IUserRepository _userRepository;
        private readonly IAccountActivationTokenRepository _accountActivationTokenRepository;
        private readonly IAccountActivationEmailSender _accountActivationEmailSender;
        private readonly AccountActivationFlowOptions _accountActivationFlowOptions;

        /*
         * Inizializza il servizio di attivazione account con tutte le dipendenze
         * necessarie alla gestione del relativo workflow applicativo.
         */
        public AccountActivationService(
            IUserRepository userRepository,
            IAccountActivationTokenRepository accountActivationTokenRepository,
            IAccountActivationEmailSender accountActivationEmailSender,
            AccountActivationFlowOptions accountActivationFlowOptions)
        {
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _accountActivationTokenRepository = accountActivationTokenRepository
                ?? throw new ArgumentNullException(nameof(accountActivationTokenRepository));
            _accountActivationEmailSender = accountActivationEmailSender
                ?? throw new ArgumentNullException(nameof(accountActivationEmailSender));
            _accountActivationFlowOptions = accountActivationFlowOptions
                ?? throw new ArgumentNullException(nameof(accountActivationFlowOptions));
        }

        /*
         * Genera un nuovo token di attivazione per l'utente specificato,
         * lo persiste e invia l'e-mail di attivazione contenente il link di conferma.
         */
        public async Task<OperationResult<bool>> SendActivationEmailAsync(
            User user,
            CancellationToken cancellationToken = default)
        {
            // L'utente deve essere presente per poter avviare il workflow di attivazione.
            if (user is null)
            {
                return OperationResult<bool>.BadRequest(
                    "invalid_user",
                    "L'utente specificato non è valido.");
            }

            // L'indirizzo e-mail è indispensabile per l'invio del link di attivazione.
            if (string.IsNullOrWhiteSpace(user.Email))
            {
                return OperationResult<bool>.BadRequest(
                    "invalid_email",
                    "L'utente non dispone di un indirizzo e-mail valido.");
            }

            // Se l'utente è già attivo non è necessario generare né inviare un nuovo token.
            if (user.IsActive)
            {
                return OperationResult<bool>.Success(true);
            }

            // Genera un token casuale in chiaro e ne calcola l'hash persistibile.
            var rawToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            var tokenHash = PasswordSecurity.ComputeTokenHash(rawToken);

            var nowUtc = DateTime.UtcNow;
            var expiresAtUtc = nowUtc.Add(_accountActivationFlowOptions.TokenLifetime);

            // Costruisce l'entità di attivazione da persistere nel repository dedicato.
            var activationToken = new AccountActivationToken
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                TokenHash = tokenHash,
                ExpiresAtUtc = expiresAtUtc,
                UsedAtUtc = null,
                CreatedAtUtc = nowUtc
            };

            // Persiste il token di attivazione prima di tentare il recapito e-mail.
            await _accountActivationTokenRepository
                .AddAsync(activationToken, cancellationToken)
                .ConfigureAwait(false);

            // Costruisce il link di conferma account da inviare all'utente.
            var activationLink = _accountActivationFlowOptions.BuildConfirmationLink(rawToken);

            try
            {
                // Invoca il sender astratto per il recapito dell'e-mail di attivazione.
                await _accountActivationEmailSender
                    .SendAccountActivationEmailAsync(user.Email, activationLink, expiresAtUtc, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Propaga correttamente le cancellazioni cooperative.
                throw;
            }
            catch
            {
                // Converte eventuali errori tecnici di invio in un esito applicativo consistente.
                return OperationResult<bool>.Failure(
                    statusCode: 500,
                    errorCode: "activation_email_delivery_failed",
                    errorMessage: "Impossibile inviare l'e-mail di attivazione account. Riprovare più tardi.");
            }

            return OperationResult<bool>.Success(true);
        }

        /*
         * Reinvia l'e-mail di attivazione all'utente identificato dall'e-mail fornita,
         * purché esista e non risulti già attivo.
         */
        public async Task<OperationResult<bool>> ResendActivationEmailAsync(
            string email,
            CancellationToken cancellationToken = default)
        {
            // Normalizza l'e-mail in input per garantire confronti coerenti.
            email = PasswordSecurity.NormalizeEmail(email);

            // L'e-mail è richiesta per identificare l'utente destinatario del reinvio.
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

            // Per evitare enumeration e gestire in modo idempotente il caso utente attivo,
            // il metodo restituisce comunque successo.
            if (user is null || user.IsActive)
            {
                return OperationResult<bool>.Success(true);
            }

            // Riutilizza il workflow standard di invio e-mail di attivazione.
            return await SendActivationEmailAsync(user, cancellationToken).ConfigureAwait(false);
        }

        /*
         * Valida un token di attivazione ricevuto dal client,
         * attiva l'utente associato e marca il token come utilizzato.
         */
        public async Task<OperationResult<bool>> ActivateAccountAsync(
            string token,
            CancellationToken cancellationToken = default)
        {
            // Normalizza il token ricevuto.
            token = token?.Trim() ?? string.Empty;

            // Il token di attivazione è obbligatorio per completare il workflow.
            if (string.IsNullOrWhiteSpace(token))
            {
                return OperationResult<bool>.BadRequest(
                    "invalid_request",
                    "Il token di attivazione è obbligatorio.");
            }

            // Calcola l'hash del token ricevuto per cercarne la versione persistita.
            var tokenHash = PasswordSecurity.ComputeTokenHash(token);

            // Recupera il token solo se ancora valido, non scaduto e non già usato.
            var activationToken = await _accountActivationTokenRepository
                .GetValidByTokenHashAsync(tokenHash, cancellationToken)
                .ConfigureAwait(false);

            if (activationToken is null)
            {
                return OperationResult<bool>.Failure(
                    statusCode: 400,
                    errorCode: "invalid_or_expired_activation_token",
                    errorMessage: "Il token di attivazione non è valido o è scaduto.");
            }

            // Recupera l'utente associato al token di attivazione.
            var user = await _userRepository
                .GetByIdAsync(activationToken.UserId, cancellationToken)
                .ConfigureAwait(false);

            if (user is null)
            {
                return OperationResult<bool>.Failure(
                    statusCode: 400,
                    errorCode: "user_not_available",
                    errorMessage: "L'utente associato al token non è disponibile.");
            }

            var nowUtc = DateTime.UtcNow;

            // Attiva l'utente solo se non è già stato attivato precedentemente.
            if (!user.IsActive)
            {
                user.IsActive = true;
                user.UpdatedAtUtc = nowUtc;

                // Persiste l'aggiornamento dello stato di attivazione dell'utente.
                await _userRepository
                    .UpdateAsync(user, cancellationToken)
                    .ConfigureAwait(false);
            }

            // Marca il token come usato per impedirne riutilizzi successivi.
            activationToken.UsedAtUtc = nowUtc;

            // Persiste lo stato consumato del token di attivazione.
            await _accountActivationTokenRepository
                .UpdateAsync(activationToken, cancellationToken)
                .ConfigureAwait(false);

            return OperationResult<bool>.Success(true);
        }
    }
}
