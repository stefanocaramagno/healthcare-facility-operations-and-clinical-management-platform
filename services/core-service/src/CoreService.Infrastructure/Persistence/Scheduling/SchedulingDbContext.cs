/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Scheduling/SchedulingDbContext.cs
 *
 * Scopo
 * -----
 * Definire il DbContext Entity Framework Core del bounded context Scheduling,
 * responsabile della mappatura tra le entità di dominio della pianificazione
 * e le corrispondenti tabelle del database.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e costituisce il punto centrale
 * di accesso alla persistenza per il contesto Scheduling.
 * Si occupa di:
 * - esporre i DbSet delle entità di agenda e prenotazione;
 * - configurare nomi tabella, chiavi, vincoli, indici e conversioni;
 * - definire le relazioni tra calendari, slot, appuntamenti e storico stati;
 * - garantire una gestione coerente dei DateTime in UTC.
 *
 * Responsabilità principali
 * -------------------------
 * - Mappare le entità del dominio Scheduling sul modello relazionale.
 * - Configurare vincoli di integrità e cardinalità tra le entità.
 * - Definire conversioni delle enum verso rappresentazioni persistibili.
 * - Definire una conversione uniforme per i DateTime UTC.
 * - Stabilire regole di cancellazione coerenti con il dominio.
 *
 * Note
 * ----
 * Il DbContext non contiene logica di business:
 * tutta la logica applicativa rimane nei servizi del layer Application.
 * Questa classe si limita alla configurazione della persistenza del modello.
 */

using System;
using CoreService.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace CoreService.Infrastructure.Persistence.Scheduling;

public sealed class SchedulingDbContext : DbContext
{
    /*
     * Inizializza il DbContext del bounded context Scheduling
     * con le opzioni di configurazione fornite dal container DI.
     */
    public SchedulingDbContext(DbContextOptions<SchedulingDbContext> options) : base(options) { }

    // Set dei calendari clinici.
    public DbSet<ClinicianCalendar> Calendars => Set<ClinicianCalendar>();

    // Set degli slot di disponibilità.
    public DbSet<AvailabilitySlot> Slots => Set<AvailabilitySlot>();

    // Set degli appuntamenti.
    public DbSet<Appointment> Appointments => Set<Appointment>();

    // Set dello storico delle variazioni di stato degli appuntamenti.
    public DbSet<AppointmentStatusChange> AppointmentStatusChanges => Set<AppointmentStatusChange>();

    /*
     * Configura il modello relazionale del bounded context Scheduling.
     *
     * In questo metodo vengono definiti:
     * - nomi delle tabelle;
     * - chiavi primarie;
     * - indici e vincoli univoci;
     * - conversioni per enum e DateTime UTC;
     * - relazioni e comportamenti di delete.
     */
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Converter riutilizzabile per garantire che tutti i DateTime persistiti
        // siano normalizzati in UTC e che quelli letti dal database
        // vengano reinterpretati con DateTimeKind.Utc.
        var utcDateTimeConverter = CreateUtcDateTimeConverter();

        modelBuilder.Entity<ClinicianCalendar>(b =>
        {
            // Configurazione della tabella dei calendari clinici.
            b.ToTable("clinician_calendars");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Ogni clinico ha un solo calendario nel modello corrente.
            b.Property(x => x.ClinicianUserId).IsRequired();
            b.HasIndex(x => x.ClinicianUserId).IsUnique();

            b.Property(x => x.TimeZone).HasMaxLength(64).IsRequired();

            b.Property(x => x.CreatedAtUtc)
                .HasConversion(utcDateTimeConverter)
                .IsRequired();
        });

        modelBuilder.Entity<AvailabilitySlot>(b =>
        {
            // Configurazione della tabella degli slot di disponibilità.
            b.ToTable("availability_slots");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.CalendarId).IsRequired();

            b.Property(x => x.StartUtc)
                .HasConversion(utcDateTimeConverter)
                .IsRequired();

            b.Property(x => x.EndUtc)
                .HasConversion(utcDateTimeConverter)
                .IsRequired();

            // Lo stato dello slot viene persistito come stringa
            // per maggiore leggibilità e stabilità.
            b.Property(x => x.Status)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.CreatedAtUtc)
                .HasConversion(utcDateTimeConverter)
                .IsRequired();

            // Impedisce la creazione di due slot con lo stesso inizio
            // all'interno dello stesso calendario.
            b.HasIndex(x => new { x.CalendarId, x.StartUtc }).IsUnique();

            // Gli slot dipendono dal calendario di appartenenza:
            // se il calendario viene eliminato, anche i relativi slot vengono eliminati.
            b.HasOne<ClinicianCalendar>()
                .WithMany()
                .HasForeignKey(x => x.CalendarId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Appointment>(b =>
        {
            // Configurazione della tabella degli appuntamenti.
            b.ToTable("appointments");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.SlotId).IsRequired();
            b.Property(x => x.PatientUserId).IsRequired();
            b.Property(x => x.ClinicianUserId).IsRequired();

            b.Property(x => x.ServiceId).IsRequired();
            b.Property(x => x.ServiceCode).HasMaxLength(64).IsRequired();

            b.Property(x => x.QuotedPriceCents).IsRequired();
            b.Property(x => x.Currency).HasMaxLength(8).IsRequired();

            // Lo stato dell'appuntamento viene persistito come stringa
            // per maggiore chiarezza nel database.
            b.Property(x => x.Status)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.Notes).HasMaxLength(255);

            b.Property(x => x.CreatedAtUtc)
                .HasConversion(utcDateTimeConverter)
                .IsRequired();

            b.Property(x => x.UpdatedAtUtc)
                .HasConversion(utcDateTimeConverter)
                .IsRequired();

            // Indici utili per le query frequenti su paziente, clinico e slot.
            b.HasIndex(x => x.PatientUserId);
            b.HasIndex(x => x.ClinicianUserId);
            b.HasIndex(x => x.SlotId);

            // L'appuntamento dipende logicamente dallo slot,
            // ma la delete è Restrict per evitare cancellazioni accidentali
            // di slot già referenziati da prenotazioni esistenti.
            b.HasOne<AvailabilitySlot>()
                .WithMany()
                .HasForeignKey(x => x.SlotId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<AppointmentStatusChange>(b =>
        {
            // Configurazione della tabella di storico cambi stato appuntamento.
            b.ToTable("appointment_status_changes");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.AppointmentId).IsRequired();

            // Gli stati vengono persistiti come stringa
            // per mantenere leggibilità e stabilità semantica.
            b.Property(x => x.FromStatus)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.ToStatus)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.ChangedByUserId).IsRequired();

            b.Property(x => x.ChangedAtUtc)
                .HasConversion(utcDateTimeConverter)
                .IsRequired();

            b.Property(x => x.Reason).HasMaxLength(255);

            // Indice utile per recuperare rapidamente
            // tutto lo storico associato a un appuntamento.
            b.HasIndex(x => x.AppointmentId);

            // Lo storico variazioni dipende dall'appuntamento:
            // se l'appuntamento viene eliminato, anche il relativo storico viene eliminato.
            b.HasOne<Appointment>()
                .WithMany()
                .HasForeignKey(x => x.AppointmentId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    /*
     * Crea il converter EF Core utilizzato per normalizzare i DateTime in UTC
     * durante la scrittura sul database e per ripristinarne il DateTimeKind
     * durante la lettura.
     */
    private static ValueConverter<DateTime, DateTime> CreateUtcDateTimeConverter()
    {
        return new ValueConverter<DateTime, DateTime>(
            toDb => NormalizeToUtc(toDb),
            fromDb => DateTime.SpecifyKind(fromDb, DateTimeKind.Utc)
        );
    }

    /*
     * Normalizza un valore DateTime in UTC prima della persistenza.
     *
     * Regole adottate:
     * - se il valore è già UTC, viene mantenuto invariato;
     * - se il valore è Local, viene convertito in UTC;
     * - se il valore è Unspecified, viene assunto come UTC.
     */
    private static DateTime NormalizeToUtc(DateTime value)
    {
        return value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };
    }
}
