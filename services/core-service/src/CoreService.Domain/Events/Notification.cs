/*
 * File: services/core-service/src/CoreService.Domain/Events/Notification.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta una notifica
 * destinata a un utente del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Events,
 * e modella il record centrale utilizzato per rappresentare
 * comunicazioni applicative pianificate o già inviate,
 * sia su canale in-app sia su eventuali canali esterni supportati.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente la notifica.
 * - Collegare la notifica al destinatario a cui è rivolta.
 * - Rappresentare il canale attraverso cui la notifica deve essere erogata.
 * - Conservare oggetto e contenuto del messaggio.
 * - Rappresentare lo stato corrente della notifica nel relativo workflow.
 * - Tracciare la schedulazione e l'eventuale invio effettivo.
 * - Conservare eventuali informazioni di errore associate al tentativo di consegna.
 * - Tracciare il timestamp di creazione del record.
 *
 * Note
 * ----
 * Questa entità costituisce il riferimento principale
 * per i workflow di consultazione notifiche, scheduling e consegna.
 * Lo stato della notifica e la data di schedulazione
 * determinano la visibilità e la trattabilità del messaggio
 * nei vari servizi applicativi del sistema.
 */

namespace CoreService.Domain.Events;

public sealed class Notification
{
    // Identificativo univoco della notifica.
    public Guid Id { get; set; }

    // Identificativo dell'utente destinatario della notifica.
    public Guid RecipientUserId { get; set; }

    // Canale di consegna della notifica, ad esempio IN_APP oppure EMAIL.
    public string Channel { get; set; } = "IN_APP";

    // Oggetto sintetico della notifica.
    public string Subject { get; set; } = string.Empty;

    // Corpo testuale completo della notifica.
    public string Body { get; set; } = string.Empty;

    // Stato corrente della notifica nel workflow di pianificazione e consegna.
    public NotificationStatus Status { get; set; }

    // Timestamp UTC previsto per la disponibilità o l'invio della notifica.
    public DateTime ScheduledAtUtc { get; set; }

    // Timestamp UTC dell'effettivo invio o rilascio della notifica.
    // Rimane nullo finché la notifica non è stata inviata o resa disponibile.
    public DateTime? SentAtUtc { get; set; }

    // Eventuale messaggio di errore associato a un fallimento di consegna o lavorazione.
    public string? Error { get; set; }

    // Timestamp UTC di creazione del record di notifica.
    public DateTime CreatedAtUtc { get; set; }
}

