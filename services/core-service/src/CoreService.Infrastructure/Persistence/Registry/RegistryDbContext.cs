/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/RegistryDbContext.cs
 *
 * Scopo
 * -----
 * Definire il DbContext Entity Framework Core del bounded context Registry,
 * responsabile della mappatura tra le entità di dominio anagrafiche/autenticative
 * e le corrispondenti tabelle del database.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e costituisce il punto centrale
 * di accesso alla persistenza per il contesto Registry.
 * Si occupa di:
 * - esporre i DbSet delle entità del dominio Registry;
 * - configurare nomi tabella, chiavi, vincoli, indici e conversioni;
 * - definire le relazioni tra utenti, profili, deleghe, consensi e token.
 *
 * Responsabilità principali
 * -------------------------
 * - Mappare le entità del dominio Registry sul modello relazionale.
 * - Configurare vincoli di integrità e cardinalità tra le entità.
 * - Definire conversioni delle enum verso rappresentazioni persistibili.
 * - Stabilire regole di cancellazione coerenti con il dominio.
 *
 * Note
 * ----
 * Il DbContext non contiene logica di business:
 * tutta la logica applicativa rimane nei servizi del layer Application.
 * Questa classe si limita alla configurazione della persistenza del modello.
 */

using CoreService.Domain.Registry;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Registry;

public sealed class RegistryDbContext : DbContext
{
    /*
     * Inizializza il DbContext del bounded context Registry
     * con le opzioni di configurazione fornite dal container DI.
     */
    public RegistryDbContext(DbContextOptions<RegistryDbContext> options) : base(options) { }

    // Set delle entità utente di base del sistema.
    public DbSet<User> Users => Set<User>();

    // Set dei profili paziente.
    public DbSet<PatientProfile> PatientProfiles => Set<PatientProfile>();

    // Set dei profili delegato.
    public DbSet<DelegateProfile> DelegateProfiles => Set<DelegateProfile>();

    // Set dei profili clinico.
    public DbSet<ClinicianProfile> ClinicianProfiles => Set<ClinicianProfile>();

    // Set delle deleghe tra pazienti e delegati.
    public DbSet<Delegation> Delegations => Set<Delegation>();

    // Set dei consensi associati ai pazienti.
    public DbSet<Consent> Consents => Set<Consent>();

    // Set dei token per il reset password.
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();

    // Set dei token per l'attivazione dell'account.
    public DbSet<AccountActivationToken> AccountActivationTokens => Set<AccountActivationToken>();

    // Set dei token di accesso revocati.
    public DbSet<RevokedAccessToken> RevokedAccessTokens => Set<RevokedAccessToken>();

    /*
     * Configura il modello relazionale del bounded context Registry.
     *
     * In questo metodo vengono definiti:
     * - nomi delle tabelle;
     * - chiavi primarie;
     * - indici e vincoli univoci;
     * - conversioni per enum;
     * - relazioni e comportamenti di delete.
     */
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(b =>
        {
            // Configurazione della tabella utenti di base.
            b.ToTable("users");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // L'e-mail è obbligatoria e univoca nel sistema.
            b.Property(x => x.Email).HasMaxLength(320).IsRequired();
            b.HasIndex(x => x.Email).IsUnique();

            // L'hash della password è obbligatorio.
            b.Property(x => x.PasswordHash).HasMaxLength(512).IsRequired();

            // Il ruolo viene persistito come stringa per maggiore leggibilità e stabilità.
            b.Property(x => x.Role)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.IsActive).IsRequired();

            b.Property(x => x.CreatedAtUtc).IsRequired();
            b.Property(x => x.UpdatedAtUtc).IsRequired();
        });

        modelBuilder.Entity<PatientProfile>(b =>
        {
            // Configurazione del profilo paziente.
            b.ToTable("patient_profiles");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Ogni utente può avere al massimo un profilo paziente.
            b.Property(x => x.UserId).IsRequired();
            b.HasIndex(x => x.UserId).IsUnique();

            b.Property(x => x.FirstName).HasMaxLength(100).IsRequired();
            b.Property(x => x.LastName).HasMaxLength(100).IsRequired();
            b.Property(x => x.Phone).HasMaxLength(50);
            b.Property(x => x.Address).HasMaxLength(255);

            b.Property(x => x.DateOfBirthUtc).IsRequired();
            b.Property(x => x.CreatedAtUtc).IsRequired();
            b.Property(x => x.UpdatedAtUtc).IsRequired();

            // Se l'utente viene eliminato, viene eliminato anche il relativo profilo paziente.
            b.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DelegateProfile>(b =>
        {
            // Configurazione del profilo delegato.
            b.ToTable("delegate_profiles");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Ogni utente può avere al massimo un profilo delegato.
            b.Property(x => x.UserId).IsRequired();
            b.HasIndex(x => x.UserId).IsUnique();

            b.Property(x => x.FirstName).HasMaxLength(100).IsRequired();
            b.Property(x => x.LastName).HasMaxLength(100).IsRequired();
            b.Property(x => x.Phone).HasMaxLength(50);
            b.Property(x => x.Address).HasMaxLength(255);

            b.Property(x => x.CreatedAtUtc).IsRequired();
            b.Property(x => x.UpdatedAtUtc).IsRequired();

            // La cancellazione dell'utente comporta la cancellazione del profilo delegato.
            b.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ClinicianProfile>(b =>
        {
            // Configurazione del profilo clinico.
            b.ToTable("clinician_profiles");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Ogni utente può avere al massimo un profilo clinico.
            b.Property(x => x.UserId).IsRequired();
            b.HasIndex(x => x.UserId).IsUnique();

            b.Property(x => x.FirstName).HasMaxLength(100).IsRequired();
            b.Property(x => x.LastName).HasMaxLength(100).IsRequired();
            b.Property(x => x.Phone).HasMaxLength(50);

            b.Property(x => x.Specialty).HasMaxLength(120).IsRequired();
            b.Property(x => x.LicenseNumber).HasMaxLength(64).IsRequired();

            // Il numero di licenza deve essere univoco.
            b.HasIndex(x => x.LicenseNumber).IsUnique();

            b.Property(x => x.OfficeLocation).HasMaxLength(120);

            b.Property(x => x.CreatedAtUtc).IsRequired();
            b.Property(x => x.UpdatedAtUtc).IsRequired();

            // La cancellazione dell'utente comporta la cancellazione del profilo clinico.
            b.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Delegation>(b =>
        {
            // Configurazione della tabella delle deleghe.
            b.ToTable("delegations");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.PatientUserId).IsRequired();
            b.Property(x => x.DelegateUserId).IsRequired();

            // Scope e stato vengono persistiti come stringhe.
            b.Property(x => x.Scope)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.Status)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.StartsAtUtc).IsRequired();
            b.Property(x => x.EndsAtUtc).IsRequired();
            b.Property(x => x.CreatedAtUtc).IsRequired();

            // Una sola delega per coppia paziente/delegato.
            b.HasIndex(x => new { x.PatientUserId, x.DelegateUserId }).IsUnique();

            // La delete è Restrict perché la relazione di delega ha valore storico/logico
            // e non deve generare cancellazioni cascata tra utenti diversi.
            b.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.PatientUserId)
                .OnDelete(DeleteBehavior.Restrict);

            b.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.DelegateUserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Consent>(b =>
        {
            // Configurazione della tabella dei consensi.
            b.ToTable("consents");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.PatientUserId).IsRequired();

            // Il tipo di consenso viene persistito come stringa.
            b.Property(x => x.Type)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.Granted).IsRequired();
            b.Property(x => x.GrantedAtUtc).IsRequired();
            b.Property(x => x.RevokedAtUtc);

            b.Property(x => x.Notes).HasMaxLength(255);
            b.Property(x => x.CreatedAtUtc).IsRequired();

            // Indice utile per recuperare rapidamente il consenso per tipo e paziente.
            b.HasIndex(x => new { x.PatientUserId, x.Type });

            // I consensi dipendono dal paziente proprietario.
            b.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.PatientUserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PasswordResetToken>(b =>
        {
            // Configurazione dei token di reset password.
            b.ToTable("password_reset_tokens");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.UserId).IsRequired();
            b.Property(x => x.TokenHash).HasMaxLength(128).IsRequired();

            b.Property(x => x.ExpiresAtUtc).IsRequired();
            b.Property(x => x.UsedAtUtc);

            b.Property(x => x.CreatedAtUtc).IsRequired();

            // L'hash del token deve essere univoco.
            b.HasIndex(x => x.TokenHash).IsUnique();

            // I token dipendono dal relativo utente.
            b.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AccountActivationToken>(b =>
        {
            // Configurazione dei token di attivazione account.
            b.ToTable("account_activation_tokens");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.UserId).IsRequired();
            b.Property(x => x.TokenHash).HasMaxLength(128).IsRequired();

            b.Property(x => x.ExpiresAtUtc).IsRequired();
            b.Property(x => x.UsedAtUtc);
            b.Property(x => x.CreatedAtUtc).IsRequired();

            // L'hash del token deve essere univoco.
            b.HasIndex(x => x.TokenHash).IsUnique();

            // I token dipendono dal relativo utente.
            b.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RevokedAccessToken>(b =>
        {
            // Configurazione dei token di accesso revocati.
            b.ToTable("revoked_access_tokens");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            b.Property(x => x.UserId).IsRequired();
            b.Property(x => x.TokenHash).HasMaxLength(128).IsRequired();

            // L'hash del token revocato deve essere univoco per consentire controlli efficienti.
            b.HasIndex(x => x.TokenHash).IsUnique();

            b.Property(x => x.ExpiresAtUtc).IsRequired();
            b.Property(x => x.RevokedAtUtc).IsRequired();
            b.Property(x => x.Reason).HasMaxLength(120);
            b.Property(x => x.CreatedAtUtc).IsRequired();

            // I token revocati dipendono dal relativo utente.
            b.HasOne<User>()
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
