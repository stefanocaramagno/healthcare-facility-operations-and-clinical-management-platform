/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/PersistenceServiceCollectionExtensions.cs
 *
 * Scopo
 * -----
 * Definire le estensioni per la registrazione centralizzata
 * di tutti i servizi di persistenza dell'applicazione
 * all'interno del container di dependency injection.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure
 * e rappresenta il punto di composizione dei componenti
 * collegati alla persistenza dati, includendo:
 * - configurazione dei DbContext Entity Framework Core;
 * - registrazione dei repository concreti;
 * - registrazione dei servizi infrastrutturali di inizializzazione database;
 * - esposizione di un metodo unico per collegare l'intero sottosistema persistence.
 *
 * Responsabilità principali
 * -------------------------
 * - Leggere la configurazione database tramite DatabaseSettings.
 * - Configurare i DbContext dei diversi bounded context.
 * - Registrare repository concreti per Registry, Scheduling, Clinical, Payments ed Events.
 * - Registrare i servizi di bootstrap e probing del database.
 *
 * Note
 * ----
 * La classe funge da composition point infrastrutturale:
 * non contiene logica di business, ma esclusivamente logica
 * di wiring e configurazione dei servizi necessari al data access layer.
 */

using CoreService.Application.Clinical.Repositories;
using CoreService.Application.Events.Repositories;
using CoreService.Application.Payments.Repositories;
using CoreService.Application.Registry.Repositories;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Infrastructure.Persistence.Clinical;
using CoreService.Infrastructure.Persistence.Events;
using CoreService.Infrastructure.Persistence.Payments;
using CoreService.Infrastructure.Persistence.Registry;
using CoreService.Infrastructure.Persistence.Scheduling;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Pomelo.EntityFrameworkCore.MySql.Infrastructure;

namespace CoreService.Infrastructure.Persistence
{
    public static class PersistenceServiceCollectionExtensions
    {
        /*
         * Registra nel container DI tutti i componenti necessari
         * al sottosistema di persistenza dell'applicazione.
         *
         * Il metodo configura:
         * - impostazioni database;
         * - DbContext EF Core;
         * - servizi di inizializzazione;
         * - repository concreti per tutti i domini applicativi.
         */
        public static IServiceCollection AddPersistence(this IServiceCollection services)
        {
            // Carica la configurazione dei database dalle variabili ambiente
            // e la rende disponibile come singleton per tutto il runtime applicativo.
            var settings = DatabaseSettings.FromEnvironment();

            services.AddSingleton(settings);

            // Costruisce la connection string del database Registry
            // e usa tale connessione per rilevare automaticamente la versione del server MySQL.
            // La stessa versione viene poi riutilizzata per tutti i DbContext.
            var registryConnectionString = settings.BuildConnectionString(settings.RegistryDatabase);
            var serverVersion = ServerVersion.AutoDetect(registryConnectionString);

            // Registra il DbContext del bounded context Registry.
            services.AddDbContext<RegistryDbContext>(options =>
                options.UseMySql(
                    settings.BuildConnectionString(settings.RegistryDatabase),
                    serverVersion));

            // Registra il DbContext del bounded context Scheduling.
            services.AddDbContext<SchedulingDbContext>(options =>
                options.UseMySql(
                    settings.BuildConnectionString(settings.SchedulingDatabase),
                    serverVersion));

            // Registra il DbContext del bounded context Clinical.
            services.AddDbContext<ClinicalDbContext>(options =>
                options.UseMySql(
                    settings.BuildConnectionString(settings.ClinicalDatabase),
                    serverVersion));

            // Registra il DbContext del bounded context Payments.
            services.AddDbContext<PaymentsDbContext>(options =>
                options.UseMySql(
                    settings.BuildConnectionString(settings.PaymentsDatabase),
                    serverVersion));

            // Registra il DbContext del bounded context Events.
            services.AddDbContext<EventsDbContext>(options =>
                options.UseMySql(
                    settings.BuildConnectionString(settings.EventsDatabase),
                    serverVersion));

            // Registra il servizio hosted responsabile dell'inizializzazione del database
            // all'avvio dell'applicazione e il seeder utilizzato per eventuali dati iniziali.
            services.AddHostedService<DatabaseInitializerHostedService>();
            services.AddScoped<DatabaseSeeder>();

            // Registra il componente di probing del database,
            // utile per verificare raggiungibilità e stato del sottosistema persistence.
            services.AddSingleton<DatabaseProbe>();

            // Repository del dominio Registry collegati a utenti, token e revoche.
            services.AddScoped<IUserRepository, UserRepository>();
            services.AddScoped<IPasswordResetTokenRepository, PasswordResetTokenRepository>();
            services.AddScoped<IAccountActivationTokenRepository, AccountActivationTokenRepository>();
            services.AddScoped<IRevokedAccessTokenRepository, RevokedAccessTokenRepository>();

            // Repository dedicato ai workflow amministrativi di provisioning utenti.
            services.AddScoped<IAdminUserProvisioningRepository, AdminUserProvisioningRepository>();

            // Repository dei profili applicativi dei diversi tipi di utente.
            services.AddScoped<IPatientProfileRepository, PatientProfileRepository>();
            services.AddScoped<IDelegateProfileRepository, DelegateProfileRepository>();
            services.AddScoped<IClinicianProfileRepository, ClinicianProfileRepository>();

            // Repository dedicato alla directory amministrativa aggregata.
            services.AddScoped<IAdminDirectoryRepository, AdminDirectoryRepository>();

            // Repository relativi a deleghe e consensi del dominio Registry.
            services.AddScoped<IDelegationRepository, DelegationRepository>();
            services.AddScoped<IConsentRepository, ConsentRepository>();

            // Repository del catalogo clinico.
            services.AddScoped<IServiceCatalogRepository, ServiceCatalogRepository>();

            // Repository del percorso clinico, encounter e componenti correlate.
            services.AddScoped<IClinicalPathwayRepository, ClinicalPathwayRepository>();

            // Repository per la gestione dei questionari di pre-triage.
            services.AddScoped<IPreTriageQuestionnaireRepository, PreTriageQuestionnaireRepository>();

            // Repository del dominio Scheduling.
            services.AddScoped<ISchedulingRepository, SchedulingRepository>();

            // Repository del dominio Payments.
            services.AddScoped<IPaymentsRepository, PaymentsRepository>();

            // Repository del dominio Events per notifiche e audit.
            services.AddScoped<INotificationsRepository, NotificationsRepository>();
            services.AddScoped<IAuditLogRepository, AuditLogRepository>();

            return services;
        }
    }
}
