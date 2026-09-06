/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Payments/PaymentsDbContext.cs
 *
 * Scopo
 * -----
 * Definire il DbContext Entity Framework Core del bounded context Payments,
 * responsabile della mappatura tra le entità di dominio dei pagamenti
 * e le corrispondenti tabelle del database.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e costituisce il punto centrale
 * di accesso alla persistenza per il contesto Payments.
 * Si occupa di:
 * - esporre i DbSet delle entità di pagamento;
 * - configurare nomi tabella, chiavi, vincoli, indici e conversioni;
 * - definire la relazione tra Payment Intent e Payment Transaction.
 *
 * Responsabilità principali
 * -------------------------
 * - Mappare le entità del dominio Payments sul modello relazionale.
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

using CoreService.Domain.Payments;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Payments;

public sealed class PaymentsDbContext : DbContext
{
    /*
     * Inizializza il DbContext del bounded context Payments
     * con le opzioni di configurazione fornite dal container DI.
     */
    public PaymentsDbContext(DbContextOptions<PaymentsDbContext> options) : base(options) { }

    // Set dei Payment Intent persistiti nel sistema.
    public DbSet<PaymentIntent> Intents => Set<PaymentIntent>();

    // Set delle transazioni di pagamento associate ai Payment Intent.
    public DbSet<PaymentTransaction> Transactions => Set<PaymentTransaction>();

    /*
     * Configura il modello relazionale del bounded context Payments.
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
        modelBuilder.Entity<PaymentIntent>(b =>
        {
            // Configurazione della tabella dei Payment Intent.
            b.ToTable("payment_intents");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Ogni Payment Intent è associato a un appuntamento specifico.
            b.Property(x => x.AppointmentId).IsRequired();

            b.Property(x => x.AmountCents).IsRequired();
            b.Property(x => x.Currency).HasMaxLength(8).IsRequired();

            // Lo stato del pagamento viene persistito come stringa
            // per maggiore leggibilità e stabilità semantica.
            b.Property(x => x.Status)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            // Informazioni di integrazione con il provider di pagamento.
            b.Property(x => x.Provider).HasMaxLength(64).IsRequired();
            b.Property(x => x.ProviderIntentId).HasMaxLength(128).IsRequired();

            // La chiave di idempotenza deve essere univoca
            // per evitare creazioni duplicate lato provider.
            b.Property(x => x.IdempotencyKey).HasMaxLength(128).IsRequired();
            b.HasIndex(x => x.IdempotencyKey).IsUnique();

            b.Property(x => x.CreatedAtUtc).IsRequired();
            b.Property(x => x.UpdatedAtUtc).IsRequired();

            // Indici utili per ricerche frequenti per appuntamento
            // e per identificazione univoca lato provider.
            b.HasIndex(x => x.AppointmentId);
            b.HasIndex(x => new { x.Provider, x.ProviderIntentId }).IsUnique();
        });

        modelBuilder.Entity<PaymentTransaction>(b =>
        {
            // Configurazione della tabella delle transazioni di pagamento.
            b.ToTable("payment_transactions");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).ValueGeneratedNever();

            // Ogni transazione appartiene a un Payment Intent.
            b.Property(x => x.IntentId).IsRequired();

            b.Property(x => x.ProviderTransactionId).HasMaxLength(128).IsRequired();

            // Lo stato della transazione viene persistito come stringa
            // per mantenere chiarezza nel database.
            b.Property(x => x.Status)
                .HasConversion<string>()
                .HasMaxLength(32)
                .IsRequired();

            b.Property(x => x.AmountCents).IsRequired();
            b.Property(x => x.ProcessedAtUtc).IsRequired();

            // Il payload grezzo restituito dal provider o dal workflow applicativo
            // può essere esteso e viene quindi mappato su LONGTEXT.
            b.Property(x => x.RawResponseJson).HasColumnType("LONGTEXT");

            // Indice utile per recuperare tutte le transazioni
            // associate a uno specifico Payment Intent.
            b.HasIndex(x => x.IntentId);

            // Le transazioni dipendono dal Payment Intent padre:
            // se l'intent viene eliminato, vengono eliminate anche le transazioni collegate.
            b.HasOne<PaymentIntent>()
                .WithMany()
                .HasForeignKey(x => x.IntentId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
