/*
 * File: services/core-service/src/CoreService.Application/Contracts/EventsDtos.cs
 *
 * Scopo
 * -----
 * Definire i DTO e i contratti dati utilizzati dal dominio applicativo Events
 * per la gestione delle notifiche e dei log di audit del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file raccoglie le strutture dati scambiate tra controller,
 * service layer e client per le operazioni del dominio Events.
 * I contratti descrivono sia payload di input sia payload di output
 * relativi a notifiche applicative e tracciamento audit.
 *
 * Responsabilità principali
 * -------------------------
 * - Definire il DTO di lettura delle notifiche.
 * - Definire il payload di input per la creazione di notifiche.
 * - Definire il DTO di lettura dei log di audit.
 *
 * Interazioni principali
 * ----------------------
 * - Controller del dominio Events
 * - Service layer del dominio Events
 * - Client frontend e altri consumer applicativi
 *
 * Note
 * ----
 * Questi tipi non contengono logica di business:
 * rappresentano esclusivamente contratti dati del layer Application.
 */

using System;

namespace CoreService.Application.Contracts
{
    /*
     * DTO che rappresenta una notifica applicativa destinata a un utente,
     * comprensiva di contenuto, canale, stato e principali metadati temporali.
     */
    public sealed record NotificationDto(
        Guid Id,
        Guid RecipientUserId,
        string Channel,
        string Subject,
        string Body,
        string Status,
        DateTime ScheduledAtUtc,
        DateTime? SentAtUtc,
        DateTime CreatedAtUtc
    );

    /*
     * DTO di input usato per creare una nuova notifica applicativa,
     * indicando destinatario, contenuto, pianificazione e canale opzionale.
     */
    public sealed record CreateNotificationRequest(
        Guid RecipientUserId,
        string Subject,
        string Body,
        DateTime? ScheduledAtUtc,
        string? Channel
    );

    /*
     * DTO che rappresenta una voce del log di audit del sistema,
     * utile per il tracciamento delle operazioni eseguite dagli utenti.
     */
    public sealed record AuditLogDto(
        Guid Id,
        Guid ActorUserId,
        string Action,
        string EntityType,
        string EntityId,
        DateTime OccurredAtUtc,
        string? RequestId,
        string? MetadataJson
    );
}
