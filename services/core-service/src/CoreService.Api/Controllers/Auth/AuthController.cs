/*
 * File: services/core-service/src/CoreService.Api/Controllers/Auth/AuthController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint HTTP relativi ad autenticazione, registrazione,
 * attivazione account, reset password, logout e introspection dei token JWT.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per tutte le operazioni
 * di identità e accesso del Core Service. Coordina il binding delle richieste,
 * la validazione dei dati, l'invocazione dei servizi applicativi di autenticazione
 * e la costruzione delle risposte HTTP coerenti con il dominio Auth.
 *
 * Responsabilità principali
 * -------------------------
 * - Gestire registrazione di Patient e Delegate.
 * - Eseguire login e generazione dei token JWT.
 * - Gestire attivazione account e reinvio email di attivazione.
 * - Gestire logout e revoca logica dei token.
 * - Esporre introspection interna dei token per i servizi trusted.
 * - Gestire richiesta reset password e reset effettivo della password.
 *
 * Interazioni principali
 * ----------------------
 * - AuthService
 * - AccountActivationService
 * - JwtTokenFactory
 * - JwtOptions
 * - DTO di request/response del layer Application
 *
 * Note
 * ----
 * Il controller contiene anche helper locali di binding manuale e di sicurezza token,
 * utili per mantenere centralizzati comportamenti ricorrenti usati da più endpoint.
 */

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Api.Auth;
using CoreService.Application.Auth.Services;
using CoreService.Application.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;

namespace CoreService.Api.Controllers.Auth
{
    [ApiController]
    [Route("auth")]
    public sealed class AuthController : ControllerBase
    {
        // Header usato per autenticare le richieste interne service-to-service
        // verso endpoint sensibili come la token introspection.
        private const string InternalServiceSecretHeader = "X-Internal-Service-Secret";

        private readonly AuthService _authService;
        private readonly AccountActivationService _accountActivationService;
        private readonly JwtTokenFactory _jwtTokenFactory;
        private readonly JwtOptions _jwtOptions;

        // Opzioni JSON usate dal binding manuale del body,
        // con confronto case-insensitive dei nomi proprietà.
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        /*
         * Inizializza il controller con tutti i servizi necessari alla gestione
         * dei workflow di autenticazione, attivazione account e token JWT.
         */
        public AuthController(
            AuthService authService,
            AccountActivationService accountActivationService,
            JwtTokenFactory jwtTokenFactory,
            JwtOptions jwtOptions)
        {
            _authService = authService
                ?? throw new ArgumentNullException(nameof(authService));
            _accountActivationService = accountActivationService
                ?? throw new ArgumentNullException(nameof(accountActivationService));
            _jwtTokenFactory = jwtTokenFactory
                ?? throw new ArgumentNullException(nameof(jwtTokenFactory));
            _jwtOptions = jwtOptions
                ?? throw new ArgumentNullException(nameof(jwtOptions));
        }

        #region Helper di binding manuale

        /*
         * Tenta di effettuare il binding del corpo della richiesta su un modello T,
         * supportando sia input JSON sia payload form-urlencoded.
         */
        private async Task<T?> BindRequestAsync<T>(CancellationToken cancellationToken)
            where T : class, new()
        {
            // Legge il body della richiesta lasciando aperto lo stream
            // per evitare interferenze con il lifecycle HTTP.
            using var reader = new StreamReader(
                Request.Body,
                Encoding.UTF8,
                detectEncodingFromByteOrderMarks: false,
                bufferSize: 1024,
                leaveOpen: true);

            var body = await reader.ReadToEndAsync().ConfigureAwait(false);

            // Un body assente o vuoto non può essere trasformato in un modello valido.
            if (string.IsNullOrWhiteSpace(body))
            {
                return null;
            }

            body = body.Trim();

            try
            {
                // Primo tentativo: deserializzazione JSON diretta del payload.
                var asJson = JsonSerializer.Deserialize<T>(body, JsonOptions);
                if (asJson is not null)
                {
                    return asJson;
                }
            }
            catch (JsonException)
            {
                // Se il body non è JSON valido, il metodo prova un binding alternativo
                // come form-urlencoded senza propagare l'eccezione.
            }

            // Mappa case-insensitive usata per il fallback form-urlencoded.
            var formValues = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            // Divide il payload nei segmenti chiave=valore.
            var segments = body.Split('&', StringSplitOptions.RemoveEmptyEntries);
            foreach (var segment in segments)
            {
                var parts = segment.Split('=', 2);
                var key = Uri.UnescapeDataString(parts[0]);
                var value = parts.Length > 1
                    ? Uri.UnescapeDataString(parts[1])
                    : string.Empty;

                formValues[key] = value;
            }

            // Costruisce un'istanza vuota del modello target.
            var model = new T();
            var modelType = typeof(T);

            // Esegue un popolamento minimale tramite reflection
            // delle proprietà pubbliche scrivibili del modello.
            foreach (var prop in modelType.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (!prop.CanWrite)
                    continue;

                if (!formValues.TryGetValue(prop.Name, out var value))
                    continue;

                // Supporta direttamente il binding delle stringhe.
                if (prop.PropertyType == typeof(string))
                {
                    prop.SetValue(model, value);
                    continue;
                }

                // Supporta il binding di DateTime e nullable DateTime
                // usando parsing invariant e roundtrip-friendly.
                if (prop.PropertyType == typeof(DateTime) || prop.PropertyType == typeof(DateTime?))
                {
                    if (DateTime.TryParse(
                        value,
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.RoundtripKind,
                        out var parsedDate))
                    {
                        prop.SetValue(model, parsedDate);
                    }

                    continue;
                }
            }

            return model;
        }

        /*
         * Riesegue la validazione MVC del modello fornito e restituisce
         * subito una risposta di errore se il modello risulta non valido.
         */
        private IActionResult? ValidateAndReturnIfInvalid(object model)
        {
            // Pulisce eventuali state residue prima della validazione esplicita.
            ModelState.Clear();

            if (!TryValidateModel(model))
            {
                return ValidationProblem(ModelState);
            }

            return null;
        }

        #endregion

        #region Helper sicurezza token

        /*
         * Estrae il bearer token dall'header Authorization corrente,
         * restituendo null se l'header è assente o malformato.
         */
        private string? TryExtractBearerToken()
        {
            var authorizationHeader = Request.Headers.Authorization.ToString();
            if (string.IsNullOrWhiteSpace(authorizationHeader))
            {
                return null;
            }

            const string bearerPrefix = "Bearer ";
            if (!authorizationHeader.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var rawToken = authorizationHeader[bearerPrefix.Length..].Trim();
            return string.IsNullOrWhiteSpace(rawToken) ? null : rawToken;
        }

        /*
         * Tenta di ricavare il Guid dell'utente a partire dai claim
         * principali presenti nel ClaimsPrincipal autenticato.
         */
        private static bool TryParseUserId(ClaimsPrincipal principal, out Guid userId)
        {
            userId = Guid.Empty;

            var raw = principal.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
                ?? principal.FindFirstValue("sub");

            return Guid.TryParse(raw, out userId);
        }

        /*
         * Tenta di ricavare la data di scadenza UTC del token
         * leggendo il claim exp espresso in epoch seconds.
         */
        private static bool TryParseExpiresAtUtc(ClaimsPrincipal principal, out DateTime expiresAtUtc)
        {
            expiresAtUtc = default;

            var rawExp = principal.FindFirstValue(JwtRegisteredClaimNames.Exp)
                ?? principal.FindFirstValue("exp");

            if (!long.TryParse(rawExp, out var expUnixSeconds))
            {
                return false;
            }

            expiresAtUtc = DateTimeOffset.FromUnixTimeSeconds(expUnixSeconds).UtcDateTime;
            return true;
        }

        /*
         * Verifica che la richiesta corrente contenga il secret interno corretto,
         * richiesto per gli endpoint accessibili solo ai servizi trusted.
         */
        private bool HasValidInternalServiceSecret()
        {
            var configuredSecret = Environment.GetEnvironmentVariable("INTERNAL_SERVICE_SECRET")?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(configuredSecret))
            {
                return false;
            }

            var providedSecret = Request.Headers[InternalServiceSecretHeader].ToString().Trim();
            return !string.IsNullOrWhiteSpace(providedSecret)
                && string.Equals(providedSecret, configuredSecret, StringComparison.Ordinal);
        }

        /*
         * Valida crittograficamente e semanticamente il token JWT grezzo
         * usando le stesse opzioni di issuer e signing key del servizio.
         */
        private bool TryValidateRawToken(string rawToken, out ClaimsPrincipal principal)
        {
            principal = null!;

            var tokenHandler = new JwtSecurityTokenHandler();
            var tokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = _jwtOptions.Issuer,
                ValidateAudience = false,
                RequireAudience = false,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtOptions.Secret)),
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(1),
                NameClaimType = ClaimTypes.NameIdentifier,
                RoleClaimType = ClaimTypes.Role
            };

            try
            {
                principal = tokenHandler.ValidateToken(rawToken, tokenValidationParameters, out _);
                return true;
            }
            catch
            {
                return false;
            }
        }

        /*
         * Costruisce una semplice pagina HTML di esito per il flusso
         * di conferma attivazione account aperto da browser.
         */
        private static string BuildActivationHtml(bool isSuccess, string message)
        {
            var title = isSuccess ? "Account attivato" : "Attivazione non riuscita";
            var badge = isSuccess ? "Completato" : "Errore";
            var badgeBg = isSuccess ? "#dbeafe" : "#fee2e2";
            var badgeColor = isSuccess ? "#1d4ed8" : "#b91c1c";
            var encodedMessage = WebUtility.HtmlEncode(message ?? string.Empty);

            return $@"
<!doctype html>
<html lang=""it"">
  <head>
    <meta charset=""utf-8"" />
    <meta name=""viewport"" content=""width=device-width, initial-scale=1.0"" />
    <title>{WebUtility.HtmlEncode(title)}</title>
  </head>
  <body style=""margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;"">
    <div style=""max-width:640px;margin:48px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;"">
      <div style=""display:inline-block;background:{badgeBg};color:{badgeColor};padding:6px 12px;border-radius:999px;font-size:12px;font-weight:700;margin-bottom:16px;"">
        {WebUtility.HtmlEncode(badge)}
      </div>
      <h1 style=""margin:0 0 12px 0;font-size:28px;"">{WebUtility.HtmlEncode(title)}</h1>
      <p style=""margin:0;line-height:1.7;font-size:16px;"">{encodedMessage}</p>
    </div>
  </body>
</html>";
        }

        #endregion

        /*
         * Registra un nuovo utente Patient, attiva il relativo workflow
         * di attivazione account e restituisce uno stato pending activation.
         */
        [HttpPost("register/patient")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(RegistrationPendingActivationResponse), StatusCodes.Status202Accepted)]
        [ProducesResponseType(StatusCodes.Status409Conflict)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> RegisterPatient(CancellationToken cancellationToken)
        {
            // Effettua il binding manuale del body su RegisterPatientRequest.
            var request = await BindRequestAsync<RegisterPatientRequest>(cancellationToken)
                .ConfigureAwait(false);

            // Un body assente o non interpretabile produce un errore di validazione.
            if (request is null)
            {
                ModelState.AddModelError(string.Empty, "Il corpo della richiesta è vuoto o non valido.");
                return ValidationProblem(ModelState);
            }

            // Applica la validazione MVC del modello ricevuto.
            var validationResult = ValidateAndReturnIfInvalid(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            // Delega al servizio applicativo la registrazione del paziente
            // e la preparazione dei dati coerenti con il workflow di attivazione.
            var result = await _authService
                .RegisterPatientAsync(
                    request.Email,
                    request.Password,
                    request.FirstName,
                    request.LastName,
                    request.DateOfBirthUtc!.Value,
                    request.Phone,
                    request.Address,
                    cancellationToken)
                .ConfigureAwait(false);

            // In caso di failure, propaga status code e codice errore applicativo.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            // Protezione difensiva per il caso anomalo di successo senza payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante la registrazione."
                });
            }

            var user = result.Value;

            // Costruisce la risposta che comunica al client
            // che l'account è stato creato ma richiede attivazione.
            var response = new RegistrationPendingActivationResponse
            {
                UserId = user.UserId,
                Email = user.Email,
                Role = user.Role,
                ActivationRequired = true,
                IsActive = user.IsActive,
                Message = "Registrazione completata. Controlla la tua e-mail per attivare l'account prima del primo accesso."
            };

            return Accepted(response);
        }

        /*
         * Registra un nuovo utente Delegate e restituisce una risposta
         * di registrazione completata ma ancora in attesa di attivazione.
         */
        [HttpPost("register/delegate")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(RegistrationPendingActivationResponse), StatusCodes.Status202Accepted)]
        [ProducesResponseType(StatusCodes.Status409Conflict)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> RegisterDelegate(CancellationToken cancellationToken)
        {
            // Effettua il binding manuale del body su RegisterDelegateRequest.
            var request = await BindRequestAsync<RegisterDelegateRequest>(cancellationToken)
                .ConfigureAwait(false);

            if (request is null)
            {
                ModelState.AddModelError(string.Empty, "Il corpo della richiesta è vuoto o non valido.");
                return ValidationProblem(ModelState);
            }

            // Valida i dati ricevuti prima di passare al service layer.
            var validationResult = ValidateAndReturnIfInvalid(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            // Delega al servizio applicativo la registrazione del delegato.
            var result = await _authService
                .RegisterDelegateAsync(
                    request.FirstName,
                    request.LastName,
                    request.Phone,
                    request.Address,
                    request.Email,
                    request.Password,
                    cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante la registrazione."
                });
            }

            var user = result.Value;

            // Restituisce al client uno stato pending activation,
            // coerente con il workflow di prima attivazione.
            var response = new RegistrationPendingActivationResponse
            {
                UserId = user.UserId,
                Email = user.Email,
                Role = user.Role,
                ActivationRequired = true,
                IsActive = user.IsActive,
                Message = "Registrazione completata. Controlla la tua e-mail per attivare l'account prima del primo accesso."
            };

            return Accepted(response);
        }

        /*
         * Esegue il login dell'utente e, in caso di successo,
         * genera e restituisce un token JWT di accesso.
         */
        [HttpPost("login")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> Login(CancellationToken cancellationToken)
        {
            // Effettua il binding del body su LoginRequest.
            var request = await BindRequestAsync<LoginRequest>(cancellationToken)
                .ConfigureAwait(false);

            if (request is null)
            {
                ModelState.AddModelError(string.Empty, "Il corpo della richiesta è vuoto o non valido.");
                return ValidationProblem(ModelState);
            }

            // Valida il modello prima di procedere con l'autenticazione.
            var validationResult = ValidateAndReturnIfInvalid(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            // Tenta il login tramite il servizio applicativo Auth.
            var result = await _authService
                .LoginAsync(request.Email, request.Password, cancellationToken)
                .ConfigureAwait(false);

            // Distingue i casi di credenziali errate, account non accessibile
            // e altri eventuali esiti di errore.
            if (result.IsFailure)
            {
                if (result.StatusCode == StatusCodes.Status401Unauthorized)
                {
                    return Unauthorized(new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
                }

                if (result.StatusCode == StatusCodes.Status403Forbidden)
                {
                    return StatusCode(StatusCodes.Status403Forbidden, new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
                }

                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            // Protezione difensiva per il caso anomalo di successo senza utente.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il login."
                });
            }

            var user = result.Value;

            // Genera il token JWT e la relativa scadenza.
            var (accessToken, expiresAtUtc) = _jwtTokenFactory.CreateToken(user.UserId, user.Email, user.Role);

            // Costruisce la risposta di autenticazione completa.
            var response = new AuthResponse
            {
                UserId = user.UserId,
                Email = user.Email,
                Role = user.Role,
                AccessToken = accessToken,
                ExpiresAtUtc = expiresAtUtc
            };

            return Ok(response);
        }

        /*
         * Attiva un account a partire dal token di attivazione ricevuto nel body.
         */
        [HttpPost("activate")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> ActivateAccount(CancellationToken cancellationToken)
        {
            // Effettua il binding del body su ActivateAccountRequest.
            var request = await BindRequestAsync<ActivateAccountRequest>(cancellationToken)
                .ConfigureAwait(false);

            if (request is null)
            {
                ModelState.AddModelError(string.Empty, "Il corpo della richiesta è vuoto o non valido.");
                return ValidationProblem(ModelState);
            }

            // Valida il modello prima dell'attivazione.
            var validationResult = ValidateAndReturnIfInvalid(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            // Delega al workflow applicativo l'attivazione dell'account.
            var result = await _accountActivationService
                .ActivateAccountAsync(request.Token, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            return NoContent();
        }

        /*
         * Conferma l'attivazione account tramite query string e restituisce
         * una pagina HTML di esito, pensata per apertura diretta da browser.
         */
        [HttpGet("activate/confirm")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(ContentResult), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ContentResult), StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> ConfirmAccountActivation(
            [FromQuery] string token,
            CancellationToken cancellationToken)
        {
            // Tenta l'attivazione usando il token ricevuto via query.
            var result = await _accountActivationService
                .ActivateAccountAsync(token, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore, restituisce una pagina HTML con badge di errore
            // e imposta esplicitamente lo status HTTP corrispondente.
            if (result.IsFailure)
            {
                Response.StatusCode = result.StatusCode;
                return Content(
                    BuildActivationHtml(false, result.ErrorMessage ?? "Attivazione account non riuscita."),
                    "text/html; charset=utf-8");
            }

            // In caso di successo, restituisce una pagina HTML di conferma positiva.
            return Content(
                BuildActivationHtml(true, "Il tuo account è stato attivato correttamente. Ora puoi accedere al portale."),
                "text/html; charset=utf-8");
        }

        /*
         * Reinvia l'email di attivazione account per un indirizzo e-mail
         * che richiede ancora la prima attivazione.
         */
        [HttpPost("activation/resend")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status202Accepted)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> ResendActivationEmail(CancellationToken cancellationToken)
        {
            // Effettua il binding del body su ResendActivationEmailRequest.
            var request = await BindRequestAsync<ResendActivationEmailRequest>(cancellationToken)
                .ConfigureAwait(false);

            if (request is null)
            {
                ModelState.AddModelError(string.Empty, "Il corpo della richiesta è vuoto o non valido.");
                return ValidationProblem(ModelState);
            }

            // Valida il modello prima di procedere.
            var validationResult = ValidateAndReturnIfInvalid(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            // Delega al workflow di attivazione il reinvio della mail.
            var result = await _accountActivationService
                .ResendActivationEmailAsync(request.Email, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            return Accepted();
        }

        /*
         * Esegue il logout dell'utente autenticato e registra la revoca logica
         * del token corrente per impedirne ulteriori utilizzi.
         */
        [HttpPost("logout")]
        [Authorize]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        public async Task<IActionResult> Logout(CancellationToken cancellationToken)
        {
            // Estrae il token bearer corrente dalla richiesta autenticata.
            var rawAccessToken = TryExtractBearerToken();
            if (string.IsNullOrWhiteSpace(rawAccessToken))
            {
                return Unauthorized(new
                {
                    code = "missing_token",
                    message = "Token JWT mancante."
                });
            }

            // Per registrare la revoca servono sia l'identità utente sia la scadenza del token.
            if (!TryParseUserId(User, out var userId) || !TryParseExpiresAtUtc(User, out var expiresAtUtc))
            {
                return Unauthorized(new
                {
                    code = "invalid_token_claims",
                    message = "Il token JWT non contiene le informazioni necessarie per il logout."
                });
            }

            // Delega al servizio Auth la registrazione della revoca del token.
            await _authService
                .LogoutAsync(userId, rawAccessToken, expiresAtUtc, cancellationToken)
                .ConfigureAwait(false);

            return NoContent();
        }

        /*
         * Espone un endpoint di introspection interno che consente ai servizi trusted
         * di verificare validità, stato di revoca e metadati essenziali di un token.
         */
        [HttpPost("token/introspect")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<IActionResult> IntrospectToken(CancellationToken cancellationToken)
        {
            // L'endpoint è accessibile solo ai servizi interni che conoscono il secret dedicato.
            if (!HasValidInternalServiceSecret())
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    code = "forbidden",
                    message = "Accesso consentito solo ai servizi interni autorizzati."
                });
            }

            // Recupera il bearer token e ne verifica struttura, firma e lifetime.
            var rawAccessToken = TryExtractBearerToken();
            if (string.IsNullOrWhiteSpace(rawAccessToken) || !TryValidateRawToken(rawAccessToken, out var principal))
            {
                return Unauthorized(new
                {
                    active = false,
                    revoked = false,
                    code = "invalid_token",
                    message = "Token JWT non valido o scaduto."
                });
            }

            // Chiede al servizio Auth se il token è stato revocato logicamente.
            var isRevoked = await _authService
                .IsAccessTokenRevokedAsync(rawAccessToken, cancellationToken)
                .ConfigureAwait(false);

            // Estrae, se presenti, identificativo utente e scadenza dal principal validato.
            _ = TryParseUserId(principal, out var userId);
            _ = TryParseExpiresAtUtc(principal, out var expiresAtUtc);

            Guid? nullableUserId = userId == Guid.Empty ? null : userId;
            DateTime? nullableExpiresAtUtc = expiresAtUtc == default ? null : expiresAtUtc;

            // Restituisce lo stato attivo/revocato del token insieme ai metadati utili
            // ai servizi che eseguono introspection distribuita.
            return Ok(new
            {
                active = !isRevoked,
                revoked = isRevoked,
                userId = nullableUserId,
                expiresAtUtc = nullableExpiresAtUtc
            });
        }

        /*
         * Avvia il workflow di reset password generando e inviando
         * il token di reset all'indirizzo e-mail indicato.
         */
        [HttpPost("password/forgot")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status202Accepted)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status500InternalServerError)]
        public async Task<IActionResult> RequestPasswordReset(CancellationToken cancellationToken)
        {
            // Effettua il binding del body su ForgotPasswordRequest.
            var request = await BindRequestAsync<ForgotPasswordRequest>(cancellationToken)
                .ConfigureAwait(false);

            if (request is null)
            {
                ModelState.AddModelError(string.Empty, "Il corpo della richiesta è vuoto o non valido.");
                return ValidationProblem(ModelState);
            }

            // Valida il modello prima dell'avvio del workflow.
            var validationResult = ValidateAndReturnIfInvalid(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            // Delega al servizio Auth la generazione del token e l'invio della mail di reset.
            var result = await _authService
                .RequestPasswordResetAsync(request.Email, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            return Accepted();
        }

        /*
         * Completa il workflow di reset password usando il token ricevuto
         * e la nuova password fornita dall'utente.
         */
        [HttpPost("password/reset")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> ResetPassword(CancellationToken cancellationToken)
        {
            // Effettua il binding del body su ResetPasswordRequest.
            var request = await BindRequestAsync<ResetPasswordRequest>(cancellationToken)
                .ConfigureAwait(false);

            if (request is null)
            {
                ModelState.AddModelError(string.Empty, "Il corpo della richiesta è vuoto o non valido.");
                return ValidationProblem(ModelState);
            }

            // Valida il modello prima di procedere con la modifica della password.
            var validationResult = ValidateAndReturnIfInvalid(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            // Delega al servizio applicativo il reset effettivo della password.
            var result = await _authService
                .ResetPasswordAsync(request.Token, request.NewPassword, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            return NoContent();
        }
    }
}
