/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Clinical/ClinicalDbContext.cs
 *
 * Scopo
 * -----
 * Definire il DbContext Entity Framework Core del bounded context Clinical,
 * responsabile della mappatura tra le entità di dominio cliniche
 * e le corrispondenti tabelle del database.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e costituisce il punto centrale
 * di accesso alla persistenza per il contesto Clinical.
 * Si occupa di:
 * - esporre i DbSet delle entità cliniche principali;
 * - configurare nomi tabella, chiavi, vincoli, indici e conversioni;
 * - definire le relazioni tra encounter, anamnesi, parametri vitali,
 *   ordini, esecuzioni, referti e questionari di pre-triage.
 *
 * Responsabilità principali
 * -------------------------
 * - Mappare le entità del dominio Clinical sul modello relazionale.
 * - Configurare vincoli di integrità e cardinalità tra le entità.
 * - Definire conversioni delle enum verso rappresentazioni persistibili.
 * - Configurare i campi testuali estesi tramite LONGTEXT dove necessario.
 * - Stabilire regole di cancellazione coerenti con il dominio.
 *
 * Note
 * ----
 * Il DbContext non contiene logica di business:
 * tutta la logica applicativa rimane nei servizi del layer Application.
 * Questa classe si limita alla configurazione della persistenza del modello.
 */

using CoreService.Domain.Clinical;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Clinical;

public sealed class ClinicalDbContext : DbContext
{
    /*
     * Inizializza il DbContext del bounded context Clinical
     * con le opzioni di configurazione fornite dal container DI.
     */
    public ClinicalDbContext(DbContextOptions<ClinicalDbContext> options) : base(options) { }

    // Set delle prestazioni presenti nel catalogo clinico.
    public DbSet<ServiceCatalogItem> ServiceCatalog => Set<ServiceCatalogItem>();

    // Set degli encounter clinici.
    public DbSet<ClinicalEncounter> Encounters => Set<ClinicalEncounter>();

    // Set dei record anamnestici associati agli encounter.
    public DbSet<AnamnesisRecord> Anamneses => Set<AnamnesisRecord>();

    // Set dei parametri vitali registrati durante gli encounter.
    public DbSet<VitalSign> VitalSigns => Set<VitalSign>();

    // Set degli ordini clinici emessi nel contesto degli encounter.
    public DbSet<ClinicalOrder> Orders => Set<ClinicalOrder>();

    // Set delle esecuzioni procedurali associate agli ordini clinici.
    public DbSet<ProcedureExecution> Executions => Set<ProcedureExecution>();

    // Set dei referti clinici associati agli encounter.
    public DbSet<ClinicalReport> Reports => Set<ClinicalReport>();

    // Set dei questionari di pre-triage compilati dai pazienti.
    public DbSet<PreTriageQuestionnaire> PreTriageQuestionnaires => Set<PreTriageQuestionnaire>();

    /*
     * Configura il modello relazionale del bounded context Clinical.
     *
     * In questo metodo vengono definiti:
     * - nomi delle tabelle;
     * - chiavi primarie;
     * - indici e vincoli univoci;
     * - conversioni per enum;
     * - relazioni e comportamenti di delete;
     * - tipi colonnari per contenuti testuali estesi.
     */
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ServiceCatalogItem>(b =>
        {
            // Configurazione della tabella del catalogo prestazioni.
            b.ToTable("service_catalog");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Il codice della prestazione è obbligatorio e univoco.
            b.Property(x => x.Code).HasMaxLength(64).IsRequired();
            b.HasIndex(x => x.Code).IsUnique();

            b.Property(x => x.Name).HasMaxLength(120).IsRequired();
            b.Property(x => x.Description).HasMaxLength(255);

            b.Property(x => x.BasePriceCents).IsRequired();
            b.Property(x => x.Currency).HasMaxLength(8).IsRequired();

            b.Property(x => x.IsActive).IsRequired();
            b.Property(x => x.CreatedAtUtc).IsRequired();
            b.Property(x => x.UpdatedAtUtc).IsRequired();
        });

        modelBuilder.Entity<ClinicalEncounter>(b =>
        {
            // Configurazione della tabella degli encounter clinici.
            b.ToTable("clinical_encounters");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Ogni encounter è associato a uno specifico appuntamento.
            b.Property(x => x.AppointmentId).IsRequired();

            b.Property(x => x.PatientUserId).IsRequired();
            b.Property(x => x.ClinicianUserId).IsRequired();

            b.Property(x => x.StartedAtUtc).IsRequired();
            b.Property(x => x.EndedAtUtc);
            b.Property(x => x.Notes).HasMaxLength(255);

            b.Property(x => x.CreatedAtUtc).IsRequired();

            // Un solo encounter per appuntamento nel modello corrente.
            b.HasIndex(x => x.AppointmentId).IsUnique();

            // Indici utili per filtrare gli encounter per paziente o clinico.
            b.HasIndex(x => x.PatientUserId);
            b.HasIndex(x => x.ClinicianUserId);
        });

        modelBuilder.Entity<AnamnesisRecord>(b =>
        {
            // Configurazione della tabella dei record anamnestici.
            b.ToTable("anamnesis_records");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.EncounterId).IsRequired();

            // Il contenuto anamnestico può essere esteso
            // e viene quindi memorizzato come LONGTEXT.
            b.Property(x => x.Content).HasColumnType("LONGTEXT").IsRequired();

            b.Property(x => x.CreatedAtUtc).IsRequired();
            b.Property(x => x.CreatedByUserId).IsRequired();

            b.HasIndex(x => x.EncounterId);

            // I record anamnestici dipendono dall'encounter di appartenenza.
            b.HasOne<ClinicalEncounter>()
                .WithMany()
                .HasForeignKey(x => x.EncounterId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<VitalSign>(b =>
        {
            // Configurazione della tabella dei parametri vitali.
            b.ToTable("vital_signs");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.EncounterId).IsRequired();

            // Il tipo di parametro vitale viene persistito come stringa
            // per maggiore leggibilità e stabilità semantica.
            b.Property(x => x.Type)
                .HasConversion<string>()
                .HasMaxLength(64)
                .IsRequired();

            b.Property(x => x.Value).HasPrecision(10, 2).IsRequired();
            b.Property(x => x.Unit).HasMaxLength(16).IsRequired();

            b.Property(x => x.MeasuredAtUtc).IsRequired();
            b.Property(x => x.MeasuredByUserId).IsRequired();

            b.HasIndex(x => x.EncounterId);

            // I parametri vitali dipendono dall'encounter di appartenenza.
            b.HasOne<ClinicalEncounter>()
                .WithMany()
                .HasForeignKey(x => x.EncounterId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ClinicalOrder>(b =>
        {
            // Configurazione della tabella degli ordini clinici.
            b.ToTable("clinical_orders");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.EncounterId).IsRequired();

            // Riferimento interno al dominio Clinical verso il catalogo prestazioni.
            b.Property(x => x.CatalogItemId).IsRequired();

            // Lo stato dell'ordine viene persistito come stringa
            // per maggiore chiarezza nel database.
            b.Property(x => x.Status)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.Notes).HasMaxLength(255);

            b.Property(x => x.CreatedAtUtc).IsRequired();
            b.Property(x => x.CreatedByUserId).IsRequired();

            b.HasIndex(x => x.EncounterId);

            // Gli ordini dipendono dall'encounter di appartenenza.
            b.HasOne<ClinicalEncounter>()
                .WithMany()
                .HasForeignKey(x => x.EncounterId)
                .OnDelete(DeleteBehavior.Cascade);

            // Il collegamento al catalogo viene mantenuto con delete restrict
            // per evitare la cancellazione di voci già referenziate da ordini storici.
            b.HasOne<ServiceCatalogItem>()
                .WithMany()
                .HasForeignKey(x => x.CatalogItemId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<ProcedureExecution>(b =>
        {
            // Configurazione della tabella delle esecuzioni procedurali.
            b.ToTable("procedure_executions");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.OrderId).IsRequired();
            b.Property(x => x.PerformedAtUtc).IsRequired();
            b.Property(x => x.PerformedByUserId).IsRequired();

            b.Property(x => x.Outcome).HasMaxLength(120).IsRequired();
            b.Property(x => x.Notes).HasMaxLength(255);

            b.HasIndex(x => x.OrderId);

            // Le esecuzioni dipendono dall'ordine clinico di appartenenza.
            b.HasOne<ClinicalOrder>()
                .WithMany()
                .HasForeignKey(x => x.OrderId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ClinicalReport>(b =>
        {
            // Configurazione della tabella dei referti clinici.
            b.ToTable("clinical_reports");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.EncounterId).IsRequired();

            // Lo stato del referto viene persistito come stringa
            // per mantenere leggibilità e stabilità semantica.
            b.Property(x => x.Status)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            // Il contenuto del referto può essere esteso
            // e viene quindi memorizzato come LONGTEXT.
            b.Property(x => x.Content).HasColumnType("LONGTEXT").IsRequired();

            b.Property(x => x.ContentHash).HasMaxLength(128);
            b.Property(x => x.SignatureType).HasMaxLength(64);

            // Il payload della firma può contenere contenuto strutturato esteso.
            b.Property(x => x.SignaturePayload).HasColumnType("LONGTEXT");

            b.Property(x => x.SignedAtUtc);
            b.Property(x => x.SignedByUserId);
            b.Property(x => x.PublishedAtUtc);
            b.Property(x => x.PublishedByUserId);

            b.Property(x => x.CreatedAtUtc).IsRequired();

            // Un solo referto per encounter nel modello corrente.
            b.HasIndex(x => x.EncounterId).IsUnique();

            // Il referto dipende dall'encounter di appartenenza.
            b.HasOne<ClinicalEncounter>()
                .WithMany()
                .HasForeignKey(x => x.EncounterId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PreTriageQuestionnaire>(b =>
        {
            // Configurazione della tabella dei questionari di pre-triage.
            b.ToTable("pretriage_questionnaires");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.AppointmentId).IsRequired();
            b.Property(x => x.PatientUserId).IsRequired();

            // Il contenuto del questionario può essere esteso
            // e viene quindi memorizzato come LONGTEXT.
            b.Property(x => x.Content)
                .HasColumnType("LONGTEXT")
                .IsRequired();

            b.Property(x => x.CreatedAtUtc).IsRequired();
            b.Property(x => x.UpdatedAtUtc).IsRequired();

            // Un solo questionario per coppia appuntamento/paziente.
            b.HasIndex(x => new { x.AppointmentId, x.PatientUserId })
                .IsUnique();

            // Indice utile per recuperare rapidamente tutti i questionari di un paziente.
            b.HasIndex(x => x.PatientUserId);
        });
    }
}
