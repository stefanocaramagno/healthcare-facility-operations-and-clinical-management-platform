/*
 * File: services/core-service/src/CoreService.Domain/Registry/User.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta un utente del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Registry,
 * e modella l'identità applicativa minima di un soggetto registrato sulla piattaforma.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente l'utente.
 * - Conservare le credenziali applicative necessarie all'autenticazione.
 * - Rappresentare il ruolo assegnato all'utente nel sistema.
 * - Indicare se l'account è attivo o meno.
 * - Tracciare i principali metadati temporali di creazione e aggiornamento.
 *
 * Note
 * ----
 * Questa entità rappresenta il record anagrafico/autenticativo di base.
 * Gli eventuali dati di profilo specialistici, come quelli di paziente,
 * delegato o clinico, sono modellati in entità dedicate e collegate
 * tramite l'identificativo dell'utente.
 */

namespace CoreService.Domain.Registry;

public sealed class User
{
    // Identificativo univoco dell'utente nel sistema.
    public Guid Id { get; set; }

    // Indirizzo e-mail utilizzato come riferimento applicativo dell'account.
    public string Email { get; set; } = string.Empty;

    // Hash della password dell'utente, mai la password in chiaro.
    public string PasswordHash { get; set; } = string.Empty;

    // Ruolo applicativo assegnato all'utente, utilizzato per autorizzazione e routing dei casi d'uso.
    public UserRole Role { get; set; }

    // Indica se l'account è attivo e quindi abilitato all'utilizzo delle funzionalità previste.
    public bool IsActive { get; set; }

    // Timestamp UTC di creazione del record utente.
    public DateTime CreatedAtUtc { get; set; }

    // Timestamp UTC dell'ultima modifica apportata al record utente.
    public DateTime UpdatedAtUtc { get; set; }
}

