/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/DatabaseInitializerHostedService.cs
 *
 * Scopo
 * -----
 * Definire un hosted service infrastrutturale responsabile
 * dell'inizializzazione dei database applicativi all'avvio del processo.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure
 * e coordina il bootstrap del sottosistema di persistenza,
 * assicurando che gli schemi dei diversi DbContext siano presenti
 * prima che l'applicazione inizi a servire richieste operative.
 *
 * Responsabilità principali
 * -------------------------
 * - Creare uno scope di servizi dedicato alla fase di inizializzazione.
 * - Garantire l'esistenza dello schema per ciascun DbContext del sistema.
 * - Avviare il processo di seeding iniziale dei dati applicativi.
 * - Registrare informazioni diagnostiche durante il bootstrap dei database.
 *
 * Note
 * ----
 * Il servizio viene eseguito all'avvio dell'applicazione.
 * La logica di creazione schema è delegata a Entity Framework Core tramite EnsureCreatedAsync,
 * mentre il popolamento iniziale dei dati è demandato a DatabaseSeeder.
 */

using CoreService.Infrastructure.Persistence.Clinical;
using CoreService.Infrastructure.Persistence.Events;
using CoreService.Infrastructure.Persistence.Payments;
using CoreService.Infrastructure.Persistence.Registry;
using CoreService.Infrastructure.Persistence.Scheduling;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CoreService.Infrastructure.Persistence;

public sealed class DatabaseInitializerHostedService : IHostedService
{
    // Provider radice utilizzato per creare uno scope DI
    // separato durante la fase di bootstrap dei database.
    private readonly IServiceProvider _serviceProvider;

    // Logger applicativo usato per tracciare le operazioni
    // di inizializzazione degli schemi dei database.
    private readonly ILogger<DatabaseInitializerHostedService> _logger;

    /*
     * Inizializza il servizio hosted con le dipendenze necessarie
     * per creare gli scope e registrare informazioni diagnostiche.
     */
    public DatabaseInitializerHostedService(
        IServiceProvider serviceProvider,
        ILogger<DatabaseInitializerHostedService> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    /*
     * Esegue la fase di bootstrap del sottosistema persistence
     * all'avvio dell'host applicativo.
     *
     * In particolare:
     * - crea uno scope DI isolato;
     * - assicura l'esistenza dello schema per ogni DbContext;
     * - invoca il seeding iniziale dei dati.
     */
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        // Crea uno scope dedicato per risolvere DbContext e servizi scoped
        // necessari all'inizializzazione del layer persistence.
        using var scope = _serviceProvider.CreateScope();

        // Garantisce la creazione dello schema per ciascun bounded context.
        await EnsureCreatedAsync<RegistryDbContext>(scope, cancellationToken);
        await EnsureCreatedAsync<SchedulingDbContext>(scope, cancellationToken);
        await EnsureCreatedAsync<ClinicalDbContext>(scope, cancellationToken);
        await EnsureCreatedAsync<PaymentsDbContext>(scope, cancellationToken);
        await EnsureCreatedAsync<EventsDbContext>(scope, cancellationToken);

        // Recupera il seeder applicativo e avvia il popolamento iniziale dei dati.
        var seeder = scope.ServiceProvider.GetRequiredService<DatabaseSeeder>();
        await seeder.SeedAsync(cancellationToken);
    }

    /*
     * Garantisce la creazione dello schema per il DbContext specificato,
     * registrando un messaggio informativo prima dell'operazione.
     */
    private async Task EnsureCreatedAsync<TContext>(IServiceScope scope, CancellationToken ct)
        where TContext : DbContext
    {
        // Risolve il DbContext richiesto dallo scope corrente.
        var ctx = scope.ServiceProvider.GetRequiredService<TContext>();

        // Registra nel logger quale contesto sta per essere inizializzato.
        _logger.LogInformation("Ensuring schema for {DbContext}...", typeof(TContext).Name);

        // Chiede a EF Core di assicurare l'esistenza dello schema del database.
        await ctx.Database.EnsureCreatedAsync(ct);
    }

    /*
     * Non richiede logiche particolari in fase di arresto dell'host,
     * poiché il servizio svolge esclusivamente attività di bootstrap iniziale.
     */
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
