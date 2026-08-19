/*
 * File: services/core-service/src/CoreService.Api/Program.cs
 *
 * Scopo
 * -----
 * Configurare e avviare il Core Service ASP.NET Core, registrando tutti i servizi
 * applicativi, infrastrutturali e di sicurezza necessari al funzionamento del backend principale.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file rappresenta il punto di bootstrap dell'intero Core Service.
 * Qui vengono configurati:
 * - il livello API;
 * - la persistenza;
 * - i servizi applicativi dei vari domini;
 * - l'autenticazione JWT;
 * - i componenti email e pagamento;
 * - la pipeline HTTP finale.
 *
 * Responsabilità principali
 * -------------------------
 * - Costruire il WebApplicationBuilder.
 * - Registrare filtri, controller, Swagger e persistenza.
 * - Leggere e materializzare le opzioni di configurazione runtime.
 * - Registrare i servizi di dominio e i servizi infrastrutturali.
 * - Configurare autenticazione e autorizzazione.
 * - Costruire e avviare la pipeline HTTP dell'applicazione.
 *
 * Interazioni principali
 * ----------------------
 * - CoreService.Api
 * - CoreService.Application
 * - CoreService.Infrastructure
 * - Configurazione runtime / variabili d'ambiente
 * - JWT, SMTP, persistenza MySQL
 *
 * Note
 * ----
 * Il file non implementa logica di business di dominio.
 * Il suo compito è comporre il sistema, collegando tra loro i componenti
 * necessari all'esecuzione del backend principale.
 */

using System;
using System.Globalization;
using System.Security.Claims;
using System.Text;
using CoreService.Api.Filters;
using CoreService.Api.Auth;
using CoreService.Application.Auth.Abstractions;
using CoreService.Application.Auth.Options;
using CoreService.Application.Auth.Services;
using CoreService.Application.Clinical.Services;
using CoreService.Application.Events.Abstractions;
using CoreService.Application.Events.Services;
using CoreService.Application.Payments.Providers;
using CoreService.Application.Payments.Services;
using CoreService.Application.Registry.Services;
using CoreService.Application.Scheduling.Services;
using CoreService.Infrastructure.Email;
using CoreService.Infrastructure.Payments.Providers;
using CoreService.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

// Crea il builder principale dell'applicazione ASP.NET Core,
// base su cui verranno registrati servizi, configurazioni e middleware.
var builder = WebApplication.CreateBuilder(args);

// Registra il filtro di audit come servizio scoped.
// Il filtro verrà poi applicato globalmente ai controller per tracciare
// le operazioni rilevanti a livello applicativo.
builder.Services.AddScoped<AuditActionFilter>();

// Registra i controller MVC/API e applica globalmente il filtro di audit.
// In questo modo tutte le azioni controller passano attraverso il presidio di audit.
builder.Services.AddControllers(options =>
{
    options.Filters.AddService(typeof(AuditActionFilter));
});

// Registra i servizi necessari all'esplorazione degli endpoint API,
// utili soprattutto per Swagger/OpenAPI.
builder.Services.AddEndpointsApiExplorer();

// Abilita la generazione della documentazione Swagger/OpenAPI.
builder.Services.AddSwaggerGen();

// Registra il layer di persistenza, inclusi DbContext, repository
// e servizi infrastrutturali collegati al database.
builder.Services.AddPersistence();

// Materializza le opzioni JWT a partire dalla configurazione applicativa
// e le registra come singleton riusabile in tutto il servizio.
var jwtOptions = JwtOptions.FromConfiguration(builder.Configuration);
builder.Services.AddSingleton(jwtOptions);

// Registra il factory responsabile della creazione dei token JWT.
builder.Services.AddSingleton<JwtTokenFactory>();

// Materializza e registra la configurazione SMTP usata dai servizi email.
builder.Services.AddSingleton(SmtpEmailSettings.FromEnvironment());

// Recupera la base URL del frontend e il path della pagina di reset password
// da variabili d'ambiente, applicando valori di fallback utili in sviluppo locale.
var frontendBaseUrl = Environment.GetEnvironmentVariable("FRONTEND_BASE_URL") ?? "http://localhost:8080";
var resetPagePath = Environment.GetEnvironmentVariable("PASSWORD_RESET_PAGE_PATH") ?? "/pages/auth/reset-password.html";
var passwordResetTokenLifetimeMinutesRaw = Environment.GetEnvironmentVariable("PASSWORD_RESET_TOKEN_LIFETIME_MINUTES") ?? "60";

// Tenta di interpretare la durata del token di reset password in minuti.
// Se il valore non è valido o non positivo, applica il fallback di 60 minuti.
if (!int.TryParse(passwordResetTokenLifetimeMinutesRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var passwordResetTokenLifetimeMinutes) ||
    passwordResetTokenLifetimeMinutes <= 0)
{
    passwordResetTokenLifetimeMinutes = 60;
}

// Registra le opzioni del flusso di reset password,
// includendo URL frontend, durata del token e pagina di destinazione.
builder.Services.AddSingleton(new PasswordResetFlowOptions(
    frontendBaseUrl: frontendBaseUrl,
    tokenLifetime: TimeSpan.FromMinutes(passwordResetTokenLifetimeMinutes),
    resetPasswordPagePath: resetPagePath));

// Registra il sender email per il reset password.
// Il servizio è scoped perché viene usato all'interno del ciclo di vita della richiesta o del workflow applicativo.
builder.Services.AddScoped<IPasswordResetEmailSender, SmtpPasswordResetEmailSender>();

// Registra il sender email per le notifiche applicative.
builder.Services.AddScoped<INotificationEmailSender, SmtpNotificationEmailSender>();

// Registra il servizio hosted che si occupa della spedizione asincrona
// delle notifiche email pianificate e dovute.
builder.Services.AddHostedService<EmailNotificationDispatchHostedService>();

// Recupera la base URL pubblica e il path di conferma attivazione account,
// applicando fallback coerenti con l'ambiente locale.
var publicBaseUrl = Environment.GetEnvironmentVariable("PUBLIC_BASE_URL") ?? "http://localhost:8080";
var activationConfirmPath = Environment.GetEnvironmentVariable("ACCOUNT_ACTIVATION_CONFIRM_PATH") ?? "/api/auth/activate/confirm";
var accountActivationTokenLifetimeMinutesRaw = Environment.GetEnvironmentVariable("ACCOUNT_ACTIVATION_TOKEN_LIFETIME_MINUTES") ?? "1440";

// Tenta di interpretare la durata del token di attivazione account in minuti.
// In caso di valore assente o non valido, usa 1440 minuti, cioè 24 ore.
if (!int.TryParse(accountActivationTokenLifetimeMinutesRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var accountActivationTokenLifetimeMinutes) ||
    accountActivationTokenLifetimeMinutes <= 0)
{
    accountActivationTokenLifetimeMinutes = 1440;
}

// Registra le opzioni che governano il workflow di attivazione account.
builder.Services.AddSingleton(new AccountActivationFlowOptions(
    publicBaseUrl: publicBaseUrl,
    tokenLifetime: TimeSpan.FromMinutes(accountActivationTokenLifetimeMinutes),
    confirmationPath: activationConfirmPath));

// Registra il sender email per l'attivazione account.
builder.Services.AddScoped<IAccountActivationEmailSender, SmtpAccountActivationEmailSender>();

// Registra il servizio applicativo che gestisce il workflow di attivazione account.
builder.Services.AddScoped<AccountActivationService>();

// Registrazione dei servizi applicativi dell'area autenticazione e identità.
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<MeService>();

// Registrazione dei servizi applicativi del dominio Clinical e Catalog.
builder.Services.AddScoped<AdminCatalogService>();
builder.Services.AddScoped<CatalogService>();
builder.Services.AddScoped<ClinicianClinicalService>();
builder.Services.AddScoped<ClinicalReportWorkflowService>();
builder.Services.AddScoped<PatientClinicalService>();

// Registrazione dei servizi relativi al pre-triage.
builder.Services.AddScoped<PatientPreTriageService>();
builder.Services.AddScoped<ClinicianPreTriageService>();

// Registrazione dei servizi del dominio Events, audit e notifiche.
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<AdminAuditService>();
builder.Services.AddScoped<AdminNotificationsService>();
builder.Services.AddScoped<PatientNotificationsService>();
builder.Services.AddScoped<DelegateNotificationsService>();
builder.Services.AddScoped<NotificationSchedulingService>();

// Registrazione dei servizi del dominio Payments e del provider simulato.
builder.Services.AddScoped<AdminPaymentsService>();
builder.Services.AddScoped<PatientPaymentsService>();
builder.Services.AddScoped<PaymentCheckoutWorkflowService>();
builder.Services.AddScoped<PaymentWebhookService>();
builder.Services.AddScoped<IPaymentProvider, SimulatedPaymentProvider>();

// Registrazione dei servizi del dominio Registry.
builder.Services.AddScoped<AdminRegistryService>();
builder.Services.AddScoped<AdminDelegateRegistryService>();
builder.Services.AddScoped<AdminDirectoryService>();
builder.Services.AddScoped<AdminUserProvisioningService>();
builder.Services.AddScoped<ClinicianProfileService>();
builder.Services.AddScoped<PatientProfileService>();
builder.Services.AddScoped<DelegateProfileService>();
builder.Services.AddScoped<DelegationAccessService>();

// Registrazione dei servizi del dominio Scheduling.
builder.Services.AddScoped<AdminSchedulingService>();
builder.Services.AddScoped<ClinicianSchedulingService>();
builder.Services.AddScoped<PatientSchedulingService>();

// Configura il sistema di autenticazione dell'applicazione usando JWT Bearer.
// Questo è il meccanismo principale con cui il Core Service protegge gli endpoint.
builder.Services
    .AddAuthentication(options =>
    {
        // Imposta JWT Bearer come schema predefinito sia per l'autenticazione
        // sia per le challenge sugli endpoint protetti.
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        // In ambiente locale o containerizzato non viene richiesto HTTPS metadata.
        options.RequireHttpsMetadata = false;

        // Conserva il token all'interno del contesto di autenticazione.
        options.SaveToken = true;

        // Definisce i parametri di validazione del token JWT.
        options.TokenValidationParameters = new TokenValidationParameters
        {
            // Verifica che l'issuer del token corrisponda a quello atteso dal servizio.
            ValidateIssuer = true,
            ValidIssuer = jwtOptions.Issuer,

            // L'audience non viene usata in questo progetto.
            ValidateAudience = false,
            RequireAudience = false,

            // Verifica la firma del token tramite chiave simmetrica.
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.Secret)),

            // Verifica la validità temporale del token, con una tolleranza minima.
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1),

            // Mappa i claim di nome e ruolo nei claim type standard .NET.
            NameClaimType = ClaimTypes.NameIdentifier,
            RoleClaimType = ClaimTypes.Role
        };

        // Eventi personalizzati del middleware JWT Bearer.
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                // Recupera l'header Authorization completo dalla richiesta HTTP.
                var authorizationHeader = context.HttpContext.Request.Headers.Authorization.ToString();
                if (string.IsNullOrWhiteSpace(authorizationHeader))
                {
                    context.Fail("Authorization header mancante.");
                    return;
                }

                // Verifica che l'header rispetti il formato Bearer.
                const string bearerPrefix = "Bearer ";
                if (!authorizationHeader.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    context.Fail("Authorization header non valido.");
                    return;
                }

                // Estrae il token grezzo da usare per il controllo di revoca.
                var rawAccessToken = authorizationHeader[bearerPrefix.Length..].Trim();
                if (string.IsNullOrWhiteSpace(rawAccessToken))
                {
                    context.Fail("Token JWT mancante.");
                    return;
                }

                // Recupera il servizio di autenticazione dal container DI.
                // Viene usato per verificare se il token è stato esplicitamente revocato.
                var authService = context.HttpContext.RequestServices.GetRequiredService<AuthService>();
                var isRevoked = await authService
                    .IsAccessTokenRevokedAsync(rawAccessToken, context.HttpContext.RequestAborted)
                    .ConfigureAwait(false);

                // Se il token risulta revocato, l'autenticazione viene fallita
                // anche se il token è formalmente valido dal punto di vista crittografico.
                if (isRevoked)
                {
                    context.Fail("Token JWT revocato.");
                }
            }
        };
    });

// Abilita il sistema di autorizzazione basato sui claim e sui ruoli.
builder.Services.AddAuthorization();

// Costruisce l'applicazione finale a partire dalla configurazione registrata.
var app = builder.Build();

// In ambiente di sviluppo abilita Swagger UI e documentazione OpenAPI,
// utili per ispezione e test manuale degli endpoint.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Abilita il redirect HTTPS.
// Anche se in alcuni contesti locali il traffico può restare HTTP dietro proxy/container,
// il middleware resta parte della pipeline standard ASP.NET Core.
app.UseHttpsRedirection();

// Abilita autenticazione e autorizzazione nella pipeline HTTP.
app.UseAuthentication();
app.UseAuthorization();

// Mappa tutti i controller registrati, esponendo gli endpoint API del Core Service.
app.MapControllers();

// Avvia l'applicazione e mette il Core Service in ascolto.
app.Run();
