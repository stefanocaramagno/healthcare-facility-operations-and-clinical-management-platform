/*
 * File: services/core-service/src/CoreService.Domain/Registry/RevokedAccessToken.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta un access token revocato,
 * utilizzato per impedire il riutilizzo di token JWT che non devono più essere considerati validi.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Registry,
 * e modella il record persistito che consente di tracciare la revoca
 * di un access token già emesso a favore di un utente autenticato.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente il record di revoca del token.
 * - Collegare il token revocato all'utente a cui apparteneva.
 * - Conservare l'hash del token revocato, evitando di memorizzare il valore in chiaro.
 * - Rappresentare la scadenza naturale del token originario.
 * - Tracciare il momento esatto della revoca.
 * - Conservare opzionalmente la motivazione della revoca.
 * - Tracciare il timestamp di creazione del record.
 *
 * Note
 * ----
 * Il token è salvato in forma hashata per motivi di sicurezza.
 * Questa entità è tipicamente utilizzata per supportare scenari come il logout
 * o altre invalidazioni esplicite di token ancora temporalmente validi.
 */

namespace CoreService.Domain.Registry;

public sealed class RevokedAccessToken
{
    // Identificativo univoco del record di revoca.
    public Guid Id { get; set; }

    // Identificativo dell'utente a cui apparteneva l'access token revocato.
    public Guid UserId { get; set; }

    // Hash dell'access token revocato, memorizzato al posto del valore raw per maggiore sicurezza.
    public string TokenHash { get; set; } = string.Empty;

    // Timestamp UTC di scadenza naturale del token originario.
    public DateTime ExpiresAtUtc { get; set; }

    // Timestamp UTC in cui la revoca del token è stata registrata.
    public DateTime RevokedAtUtc { get; set; }

    // Motivazione opzionale della revoca, utile per audit e tracciabilità operativa.
    public string? Reason { get; set; }

    // Timestamp UTC di creazione del record di revoca.
    public DateTime CreatedAtUtc { get; set; }
}
