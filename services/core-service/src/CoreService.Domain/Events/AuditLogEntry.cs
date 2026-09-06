/*
 * File: services/core-service/src/CoreService.Domain/Events/AuditLogEntry.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta un record di audit
 * relativo a un'operazione eseguita nel sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Events,
 * e modella il dato persistito utilizzato per tracciare
 * chi ha eseguito una determinata azione,
 * su quale entità applicativa,
 * in quale momento
 * e con quali eventuali metadati aggiuntivi.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente il record di audit.
 * - Collegare il record all'utente attore dell'operazione.
 * - Rappresentare l'azione eseguita.
 * - Rappresentare il tipo e l'identificativo dell'entità coinvolta.
 * - Tracciare il momento esatto dell'evento.
 * - Conservare eventuali riferimenti alla richiesta applicativa.
 * - Conservare eventuali metadati serializzati in formato JSON.
 *
 * Note
 * ----
 * Questa entità costituisce il riferimento principale
 * per i workflow di audit, tracciabilità operativa e analisi amministrativa.
 * I campi Action, EntityType ed EntityId consentono di ricostruire
 * il contesto logico dell'operazione registrata.
 */

namespace CoreService.Domain.Events;

public sealed class AuditLogEntry
{
    // Identificativo univoco del record di audit.
    public Guid Id { get; set; }

    // Identificativo dell'utente che ha eseguito l'azione tracciata.
    public Guid ActorUserId { get; set; }

    // Nome o codice dell'azione eseguita.
    public string Action { get; set; } = string.Empty;

    // Tipo logico dell'entità coinvolta nell'operazione.
    public string EntityType { get; set; } = string.Empty;

    // Identificativo dell'entità coinvolta nell'operazione,
    // memorizzato come stringa per supportare diverse tipologie di chiave.
    public string EntityId { get; set; } = string.Empty;

    // Timestamp UTC del momento in cui l'evento di audit si è verificato.
    public DateTime OccurredAtUtc { get; set; }

    // Identificativo opzionale della richiesta applicativa associata all'evento.
    public string? RequestId { get; set; }

    // Metadati opzionali serializzati in formato JSON,
    // utili per arricchire il contesto dell'evento di audit.
    public string? MetadataJson { get; set; }
}

