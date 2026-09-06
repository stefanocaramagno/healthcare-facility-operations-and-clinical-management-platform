/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Events/EventsDbContext.cs
 *
 * Scopo
 * -----
 * Definire il DbContext Entity Framework Core del bounded context Events,
 * responsabile della mappatura tra le entità di dominio degli eventi applicativi
 * e le corrispondenti tabelle del database.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e costituisce il punto centrale
 * di accesso alla persistenza per il contesto Events.
 * Si occupa di:
 * - esporre i DbSet delle notifiche e dei log di audit;
 * - configurare nomi tabella, chiavi, vincoli, indici e conversioni;
 * - definire le caratteristiche di persistenza di Notification e AuditLogEntry.
 *
 * Responsabilità principali
 * -------------------------
 * - Mappare le entità del dominio Events sul modello relazionale.
 * - Configurare vincoli di integrità e indici utili alle query applicative.
 * - Definire conversioni delle enum verso rappresentazioni persistibili.
 * - Configurare il tipo colonnare dei contenuti testuali estesi.
 *
 * Note
 * ----
 * Il DbContext non contiene logica di business:
 * tutta la logica applicativa rimane nei servizi del layer Application.
 * Questa classe si limita alla configurazione della persistenza del modello.
 */

using CoreService.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Events;

public sealed class EventsDbContext : DbContext
{
    /*
     * Inizializza il DbContext del bounded context Events
     * con le opzioni di configurazione fornite dal container DI.
     */
    public EventsDbContext(DbContextOptions<EventsDbContext> options) : base(options) { }

    // Set delle notifiche applicative persistite nel sistema.
    public DbSet<Notification> Notifications => Set<Notification>();

    // Set dei log di audit persistiti nel sistema.
    public DbSet<AuditLogEntry> AuditLogs => Set<AuditLogEntry>();

    /*
     * Configura il modello relazionale del bounded context Events.
     *
     * In questo metodo vengono definiti:
     * - nomi delle tabelle;
     * - chiavi primarie;
     * - indici e vincoli;
     * - conversioni per enum;
     * - tipi colonnari per contenuti testuali estesi.
     */
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Notification>(b =>
        {
            // Configurazione della tabella delle notifiche.
            b.ToTable("notifications");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Ogni notifica è associata a un destinatario applicativo.
            b.Property(x => x.RecipientUserId).IsRequired();

            // Configurazione dei campi principali della notifica.
            b.Property(x => x.Channel).HasMaxLength(32).IsRequired();
            b.Property(x => x.Subject).HasMaxLength(120).IsRequired();
            b.Property(x => x.Body).HasColumnType("LONGTEXT").IsRequired();

            // Lo stato della notifica viene persistito come stringa
            // per maggiore leggibilità e stabilità semantica.
            b.Property(x => x.Status)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.ScheduledAtUtc).IsRequired();
            b.Property(x => x.SentAtUtc);
            b.Property(x => x.Error).HasMaxLength(255);

            b.Property(x => x.CreatedAtUtc).IsRequired();

            // Indici utili per le query più frequenti:
            // recupero per destinatario e filtraggio per stato.
            b.HasIndex(x => x.RecipientUserId);
            b.HasIndex(x => x.Status);
        });

        modelBuilder.Entity<AuditLogEntry>(b =>
        {
            // Configurazione della tabella dei log di audit.
            b.ToTable("audit_log");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Configurazione dei campi principali dell'evento di audit.
            b.Property(x => x.ActorUserId).IsRequired();
            b.Property(x => x.Action).HasMaxLength(120).IsRequired();
            b.Property(x => x.EntityType).HasMaxLength(120).IsRequired();
            b.Property(x => x.EntityId).HasMaxLength(64).IsRequired();

            b.Property(x => x.OccurredAtUtc).IsRequired();
            b.Property(x => x.RequestId).HasMaxLength(64);

            // I metadati di audit possono avere struttura estesa,
            // quindi vengono persistiti come LONGTEXT.
            b.Property(x => x.MetadataJson).HasColumnType("LONGTEXT");

            // Indici utili per ricerche e analisi amministrative:
            // per attore, azione e tempo di accadimento.
            b.HasIndex(x => x.ActorUserId);
            b.HasIndex(x => x.Action);
            b.HasIndex(x => x.OccurredAtUtc);
        });
    }
}
