/*
 * File: services/core-service/src/CoreService.Domain/Registry/AccountActivationToken.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta un token
 * utilizzato per l'attivazione di un account utente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Registry,
 * e modella il record persistito che consente di gestire
 * il workflow di attivazione account tramite link o token monouso.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente il token di attivazione.
 * - Collegare il token all'utente a cui appartiene.
 * - Conservare l'hash del token emesso, evitando di memorizzare il valore in chiaro.
 * - Rappresentare la scadenza temporale del token.
 * - Tracciare se e quando il token è stato utilizzato.
 * - Tracciare il timestamp di creazione del record.
 *
 * Note
 * ----
 * Il token è salvato in forma hashata per motivi di sicurezza.
 * La validità effettiva del token dipende tipicamente dalla combinazione tra:
 * - esistenza del record;
 * - mancata scadenza;
 * - mancato utilizzo precedente.
 */

namespace CoreService.Domain.Registry;

public sealed class AccountActivationToken
{
    // Identificativo univoco del record di token di attivazione.
    public Guid Id { get; set; }

    // Identificativo dell'utente a cui il token di attivazione appartiene.
    public Guid UserId { get; set; }

    // Hash del token emesso, memorizzato al posto del valore raw per maggiore sicurezza.
    public string TokenHash { get; set; } = string.Empty;

    // Timestamp UTC di scadenza del token.
    public DateTime ExpiresAtUtc { get; set; }

    // Timestamp UTC del momento in cui il token è stato consumato.
    // Rimane nullo se il token non è ancora stato utilizzato.
    public DateTime? UsedAtUtc { get; set; }

    // Timestamp UTC di creazione del record di token.
    public DateTime CreatedAtUtc { get; set; }
}

