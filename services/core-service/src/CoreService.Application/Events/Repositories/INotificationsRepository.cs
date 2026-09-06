/*
 * File: services/core-service/src/CoreService.Application/Events/Repositories/INotificationsRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * delle notifiche del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Events
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono recuperare, creare e aggiornare notifiche
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare le notifiche visibili per uno specifico destinatario.
 * - Recuperare una singola notifica appartenente a un destinatario specifico.
 * - Recuperare notifiche tramite filtri amministrativi.
 * - Recuperare notifiche e-mail pendenti e già scadute per l'invio.
 * - Persistire nuove notifiche.
 * - Aggiornare notifiche esistenti.
 * - Marcare notifiche come lette.
 *
 * Interazioni principali
 * ----------------------
 * - PatientNotificationsService
 * - DelegateNotificationsService
 * - AdminNotificationsService
 * - NotificationSchedulingService
 * - Eventuali worker o job di invio e-mail
 * - Implementazioni infrastrutturali dei repository
 * - Entità Notification del dominio
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * sul database o sul meccanismo di persistenza:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Domain.Events;

namespace CoreService.Application.Events.Repositories
{
    public interface INotificationsRepository
    {
        /*
         * Recupera le notifiche visibili per un destinatario specifico
         * al momento temporale indicato, con possibilità di limitare
         * il risultato alle sole notifiche non lette.
         */
        Task<IReadOnlyList<Notification>> GetVisibleNotificationsForRecipientAsync(
            Guid recipientUserId,
            bool onlyUnread,
            DateTime nowUtc,
            CancellationToken cancellationToken = default);

        /*
         * Recupera una specifica notifica appartenente al destinatario indicato.
         */
        Task<Notification?> GetNotificationForRecipientAsync(
            Guid recipientUserId,
            Guid notificationId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera le notifiche del sistema applicando filtri opzionali
         * per destinatario e stato.
         */
        Task<IReadOnlyList<Notification>> GetNotificationsAsync(
            Guid? recipientUserId,
            NotificationStatus? status,
            CancellationToken cancellationToken = default);

        /*
         * Recupera una notifica tramite il suo identificativo univoco.
         */
        Task<Notification?> GetByIdAsync(
            Guid notificationId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera le notifiche e-mail pendenti la cui schedulazione è scaduta,
         * limitando il numero massimo di elementi restituiti.
         */
        Task<IReadOnlyList<Notification>> GetDuePendingEmailNotificationsAsync(
            DateTime nowUtc,
            int take,
            CancellationToken cancellationToken = default);

        /*
         * Persiste una nuova notifica nel sistema.
         */
        Task AddAsync(
            Notification notification,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di una notifica esistente.
         */
        Task UpdateAsync(
            Notification notification,
            CancellationToken cancellationToken = default);

        /*
         * Marca una notifica come letta.
         */
        Task MarkAsReadAsync(
            Notification notification,
            CancellationToken cancellationToken = default);
    }
}
