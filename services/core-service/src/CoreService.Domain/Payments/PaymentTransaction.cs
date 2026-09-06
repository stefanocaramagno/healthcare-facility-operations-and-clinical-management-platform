/*
 * File: services/core-service/src/CoreService.Domain/Payments/PaymentTransaction.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta una singola transazione
 * associata a un Payment Intent.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Payments,
 * e modella il record tecnico-operativo che traccia
 * un evento di pagamento o un aggiornamento proveniente dal provider,
 * dal workflow di checkout o da processi amministrativi di riconciliazione.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente la transazione di pagamento.
 * - Collegare la transazione al Payment Intent di riferimento.
 * - Conservare l'identificativo della transazione lato provider.
 * - Rappresentare lo stato del pagamento rilevato al momento della transazione.
 * - Conservare l'importo trattato dalla transazione.
 * - Tracciare il momento in cui la transazione è stata processata.
 * - Conservare opzionalmente il payload grezzo restituito dal provider o dal workflow applicativo.
 *
 * Note
 * ----
 * Questa entità rappresenta la cronologia tecnica del pagamento.
 * Più transazioni possono essere associate allo stesso Payment Intent
 * per descrivere l'evoluzione completa del relativo workflow.
 */

namespace CoreService.Domain.Payments;

public sealed class PaymentTransaction
{
    // Identificativo univoco della transazione di pagamento.
    public Guid Id { get; set; }

    // Identificativo del Payment Intent a cui la transazione appartiene.
    public Guid IntentId { get; set; }

    // Identificativo della transazione lato provider o del sistema integrato.
    public string ProviderTransactionId { get; set; } = string.Empty;

    // Stato del pagamento registrato da questa specifica transazione.
    public PaymentStatus Status { get; set; }

    // Importo della transazione espresso in centesimi.
    public int AmountCents { get; set; }

    // Timestamp UTC del momento in cui la transazione è stata elaborata o registrata.
    public DateTime ProcessedAtUtc { get; set; }

    // Payload JSON opzionale contenente la risposta grezza del provider
    // o i metadati tecnici del workflow che ha generato la transazione.
    public string? RawResponseJson { get; set; }
}

