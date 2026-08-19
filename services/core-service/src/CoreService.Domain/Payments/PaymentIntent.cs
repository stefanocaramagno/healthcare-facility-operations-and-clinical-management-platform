/*
 * File: services/core-service/src/CoreService.Domain/Payments/PaymentIntent.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta un Payment Intent,
 * ossia il tentativo logico di pagamento associato a un appuntamento.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Payments,
 * e modella il record principale utilizzato per tracciare
 * il processo di pagamento di una prenotazione,
 * indipendentemente dal provider concreto impiegato.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente il Payment Intent.
 * - Collegare il Payment Intent all'appuntamento da pagare.
 * - Conservare importo e valuta del pagamento.
 * - Rappresentare lo stato corrente del pagamento.
 * - Conservare le informazioni di integrazione con il provider esterno.
 * - Garantire idempotenza logica nelle operazioni di creazione lato provider.
 * - Tracciare i metadati temporali di creazione e aggiornamento.
 *
 * Note
 * ----
 * Questa entità rappresenta il contenitore centrale del workflow di pagamento.
 * Le singole transazioni tecniche o gli eventi provenienti dal provider
 * vengono invece registrati separatamente tramite le entità di transazione.
 */

namespace CoreService.Domain.Payments;

public sealed class PaymentIntent
{
    // Identificativo univoco del Payment Intent nel sistema.
    public Guid Id { get; set; }

    // Identificativo dell'appuntamento a cui il pagamento si riferisce.
    public Guid AppointmentId { get; set; }

    // Importo del pagamento espresso in centesimi.
    public int AmountCents { get; set; }

    // Valuta associata all'importo del pagamento.
    public string Currency { get; set; } = "EUR";

    // Stato corrente del Payment Intent nel suo ciclo di vita.
    public PaymentStatus Status { get; set; }

    // Nome del provider di pagamento associato al Payment Intent.
    public string Provider { get; set; } = "SIMULATED";

    // Identificativo del Payment Intent lato provider esterno.
    public string ProviderIntentId { get; set; } = string.Empty;

    // Chiave di idempotenza utilizzata per evitare creazioni duplicate lato provider.
    public string IdempotencyKey { get; set; } = string.Empty;

    // Timestamp UTC di creazione del Payment Intent.
    public DateTime CreatedAtUtc { get; set; }

    // Timestamp UTC dell'ultima modifica apportata al Payment Intent.
    public DateTime UpdatedAtUtc { get; set; }
}

