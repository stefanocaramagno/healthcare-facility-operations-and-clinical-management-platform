/*
 * File: services/core-service/src/CoreService.Domain/Registry/Consent.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta un consenso espresso dal paziente
 * rispetto a uno specifico trattamento o finalità prevista dal sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Registry,
 * e modella il record di consenso associato a un paziente
 * per una determinata tipologia di autorizzazione.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente il consenso registrato.
 * - Collegare il consenso al paziente che lo ha espresso.
 * - Indicare la tipologia di consenso a cui il record si riferisce.
 * - Rappresentare se il consenso risulta concesso oppure negato/revocato.
 * - Conservare i riferimenti temporali di concessione e revoca.
 * - Memorizzare eventuali note aggiuntive contestuali.
 * - Tracciare il timestamp di creazione del record.
 *
 * Note
 * ----
 * Questa entità è utilizzata dai servizi applicativi
 * per verificare la disponibilità dei consensi obbligatori
 * prima dell'esecuzione di specifici workflow,
 * come prenotazioni, check-in o avvio dell'encounter clinico.
 */

namespace CoreService.Domain.Registry;

public sealed class Consent
{
    // Identificativo univoco del record di consenso.
    public Guid Id { get; set; }

    // Identificativo dell'utente paziente a cui il consenso appartiene.
    public Guid PatientUserId { get; set; }

    // Tipologia del consenso espresso dal paziente.
    public ConsentType Type { get; set; }

    // Indica se il consenso risulta attualmente concesso.
    public bool Granted { get; set; }

    // Timestamp UTC in cui il consenso è stato espresso o confermato.
    public DateTime GrantedAtUtc { get; set; }

    // Timestamp UTC dell'eventuale revoca del consenso.
    // Rimane nullo se il consenso è ancora valido e non revocato.
    public DateTime? RevokedAtUtc { get; set; }

    // Note opzionali associate al consenso.
    public string? Notes { get; set; }

    // Timestamp UTC di creazione del record di consenso.
    public DateTime CreatedAtUtc { get; set; }
}

