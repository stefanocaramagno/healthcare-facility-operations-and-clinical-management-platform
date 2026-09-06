/*
 * File: services/core-service/src/CoreService.Application/Events/Services/PatientNotificationsService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi del dominio Events
 * relativi alla consultazione e alla gestione delle notifiche
 * da parte del paziente autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Events
 * e coordina i workflow che consentono al paziente di:
 * - recuperare le proprie notifiche visibili;
 * - recuperare una singola notifica per identificativo;
 * - marcare una notifica come letta.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare le notifiche visibili per il destinatario corrente.
 * - Restituire una specifica notifica del paziente.
 * - Verificare che la notifica appartenga al paziente corrente.
 * - Verificare che una notifica sia effettivamente visibile prima della lettura.
 * - Aggiornare lo stato della notifica a "Read".
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - INotificationsRepository
 * - Entità del dominio Events
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati al repository dedicato.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Common;
using CoreService.Application.Events.Repositories;
using CoreService.Domain.Events;

namespace CoreService.Application.Events.Services
{
    public sealed class PatientNotificationsService
    {
        // Repository applicativo utilizzato per recuperare e aggiornare
        // le notifiche destinate all'utente corrente.
        private readonly INotificationsRepository _notificationsRepository;

        /*
         * Inizializza il servizio con la dipendenza necessaria
         * ai workflow di consultazione e gestione notifiche lato paziente.
         */
        public PatientNotificationsService(INotificationsRepository notificationsRepository)
        {
            _notificationsRepository = notificationsRepository
                ?? throw new ArgumentNullException(nameof(notificationsRepository));
        }

        /*
         * Recupera l'elenco delle notifiche visibili del paziente corrente,
         * con possibilità di filtrare opzionalmente solo quelle non lette.
         */
        public async Task<OperationResult<IReadOnlyList<NotificationDto>>> GetMyNotificationsAsync(
            Guid patientUserId,
            bool onlyUnread,
            CancellationToken cancellationToken)
        {
            // Usa il timestamp corrente UTC per determinare
            // quali notifiche risultano effettivamente visibili.
            var nowUtc = DateTime.UtcNow;

            var notifications = await _notificationsRepository
                .GetVisibleNotificationsForRecipientAsync(
                    patientUserId,
                    onlyUnread,
                    nowUtc,
                    cancellationToken)
                .ConfigureAwait(false);

            // Converte le entità di dominio nei corrispondenti DTO applicativi.
            var dtos = notifications
                .Select(MapToDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<NotificationDto>>.Success(dtos);
        }

        /*
         * Recupera una singola notifica del paziente corrente
         * verificando che esista e che appartenga effettivamente al destinatario autenticato.
         */
        public async Task<OperationResult<NotificationDto>> GetMyNotificationByIdAsync(
            Guid patientUserId,
            Guid notificationId,
            CancellationToken cancellationToken)
        {
            var notification = await _notificationsRepository
                .GetNotificationForRecipientAsync(
                    patientUserId,
                    notificationId,
                    cancellationToken)
                .ConfigureAwait(false);

            if (notification is null)
            {
                return OperationResult<NotificationDto>.NotFound(
                    "notification_not_found",
                    "La notifica specificata non esiste oppure non appartiene all'utente corrente.");
            }

            return OperationResult<NotificationDto>.Success(MapToDto(notification));
        }

        /*
         * Marca come letta una notifica del paziente corrente,
         * purché la notifica esista, appartenga all'utente
         * e sia già disponibile per la lettura.
         */
        public async Task<OperationResult<bool>> MarkAsReadAsync(
            Guid patientUserId,
            Guid notificationId,
            CancellationToken cancellationToken)
        {
            var notification = await _notificationsRepository
                .GetNotificationForRecipientAsync(
                    patientUserId,
                    notificationId,
                    cancellationToken)
                .ConfigureAwait(false);

            if (notification is null)
            {
                return OperationResult<bool>.NotFound(
                    "notification_not_found",
                    "La notifica specificata non esiste oppure non appartiene all'utente corrente.");
            }

            var nowUtc = DateTime.UtcNow;

            // Impedisce la marcatura come letta di notifiche
            // che non sono ancora visibili al destinatario.
            if (notification.ScheduledAtUtc > nowUtc)
            {
                return OperationResult<bool>.BadRequest(
                    "notification_not_visible_yet",
                    "La notifica non è ancora disponibile per la lettura.");
            }

            // Se la notifica è già marcata come letta,
            // restituisce comunque successo in modo idempotente.
            if (notification.Status == NotificationStatus.Read)
            {
                return OperationResult<bool>.Success(true);
            }

            await _notificationsRepository
                .MarkAsReadAsync(notification, cancellationToken)
                .ConfigureAwait(false);

            return OperationResult<bool>.Success(true);
        }

        /*
         * Converte un'entità Notification del dominio
         * nel corrispondente DTO applicativo.
         */
        private static NotificationDto MapToDto(Notification entity)
        {
            return new NotificationDto(
                entity.Id,
                entity.RecipientUserId,
                entity.Channel,
                entity.Subject,
                entity.Body,
                entity.Status.ToString(),
                entity.ScheduledAtUtc,
                entity.SentAtUtc,
                entity.CreatedAtUtc);
        }
    }
}
