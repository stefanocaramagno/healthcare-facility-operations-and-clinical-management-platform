/*
 * File: services/core-service/src/CoreService.Application/Events/Services/DelegateNotificationsService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi del dominio Events
 * relativi alla consultazione e alla gestione delle notifiche
 * da parte del delegato per conto di un paziente assistito.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Events
 * e coordina i workflow che consentono al delegato di:
 * - recuperare le notifiche visibili dell’assistito selezionato;
 * - recuperare una singola notifica dell’assistito;
 * - marcare come letta una notifica dell’assistito.
 *
 * Tutte le operazioni sono subordinate alla verifica preventiva
 * dell’esistenza di una delega attiva e sufficiente.
 *
 * Responsabilità principali
 * -------------------------
 * - Verificare che il delegato disponga di una delega valida verso il paziente selezionato.
 * - Recuperare le notifiche visibili per il paziente delegato.
 * - Restituire una singola notifica del paziente delegato.
 * - Verificare che una notifica sia effettivamente disponibile prima della lettura.
 * - Aggiornare lo stato della notifica a "Read".
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - INotificationsRepository
 * - DelegationAccessService
 * - Entità del dominio Events
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati al repository notifiche
 * e al servizio di validazione delle deleghe.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Events.Repositories;
using CoreService.Application.Registry.Services;
using CoreService.Domain.Events;
using CoreService.Domain.Registry;

namespace CoreService.Application.Events.Services
{
    public sealed class DelegateNotificationsService
    {
        // Repository applicativo utilizzato per recuperare e aggiornare
        // le notifiche destinate agli assistiti.
        private readonly INotificationsRepository _notificationsRepository;

        // Servizio utilizzato per verificare che il delegato
        // sia effettivamente autorizzato a operare per il paziente selezionato.
        private readonly DelegationAccessService _delegationAccessService;

        /*
         * Inizializza il servizio con le dipendenze necessarie
         * ai workflow di consultazione e gestione notifiche lato delegato.
         */
        public DelegateNotificationsService(
            INotificationsRepository notificationsRepository,
            DelegationAccessService delegationAccessService)
        {
            _notificationsRepository = notificationsRepository
                ?? throw new ArgumentNullException(nameof(notificationsRepository));
            _delegationAccessService = delegationAccessService
                ?? throw new ArgumentNullException(nameof(delegationAccessService));
        }

        /*
         * Recupera l'elenco delle notifiche visibili del paziente delegato,
         * previa verifica di una delega attiva con permessi sufficienti.
         */
        public async Task<OperationResult<IReadOnlyList<NotificationDto>>> GetNotificationsForDelegatedPatientAsync(
            Guid delegateUserId,
            Guid patientUserId,
            bool onlyUnread,
            CancellationToken cancellationToken)
        {
            // Verifica preliminarmente che il delegato sia autorizzato
            // ad accedere alle informazioni dell’assistito selezionato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(
                    patientUserId,
                    delegateUserId,
                    DelegationScope.ReadOnly,
                    cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return OperationResult<IReadOnlyList<NotificationDto>>.Failure(
                    delegationResult.StatusCode,
                    delegationResult.ErrorCode ?? "delegation_not_allowed",
                    delegationResult.ErrorMessage ?? "Il delegato non è autorizzato ad accedere alle notifiche dell’assistito selezionato.");
            }

            // Usa il timestamp corrente UTC per determinare
            // quali notifiche risultano effettivamente visibili al destinatario.
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
         * Recupera una singola notifica del paziente delegato,
         * previa verifica di una delega attiva con permessi sufficienti.
         */
        public async Task<OperationResult<NotificationDto>> GetNotificationByIdForDelegatedPatientAsync(
            Guid delegateUserId,
            Guid patientUserId,
            Guid notificationId,
            CancellationToken cancellationToken)
        {
            // Verifica preliminarmente che il delegato sia autorizzato
            // ad accedere alle informazioni dell’assistito selezionato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(
                    patientUserId,
                    delegateUserId,
                    DelegationScope.ReadOnly,
                    cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return OperationResult<NotificationDto>.Failure(
                    delegationResult.StatusCode,
                    delegationResult.ErrorCode ?? "delegation_not_allowed",
                    delegationResult.ErrorMessage ?? "Il delegato non è autorizzato ad accedere alle notifiche dell’assistito selezionato.");
            }

            // Recupera la notifica verificando contestualmente
            // che appartenga al paziente assistito indicato.
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
                    "La notifica specificata non esiste oppure non appartiene all’assistito selezionato.");
            }

            return OperationResult<NotificationDto>.Success(MapToDto(notification));
        }

        /*
         * Marca come letta una notifica del paziente delegato,
         * previa verifica di una delega attiva con permessi sufficienti.
         */
        public async Task<OperationResult<bool>> MarkAsReadForDelegatedPatientAsync(
            Guid delegateUserId,
            Guid patientUserId,
            Guid notificationId,
            CancellationToken cancellationToken)
        {
            // Verifica preliminarmente che il delegato sia autorizzato
            // ad accedere alle informazioni dell’assistito selezionato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(
                    patientUserId,
                    delegateUserId,
                    DelegationScope.ReadOnly,
                    cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return OperationResult<bool>.Failure(
                    delegationResult.StatusCode,
                    delegationResult.ErrorCode ?? "delegation_not_allowed",
                    delegationResult.ErrorMessage ?? "Il delegato non è autorizzato ad accedere alle notifiche dell’assistito selezionato.");
            }

            // Recupera la notifica verificando contestualmente
            // che appartenga al paziente assistito indicato.
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
                    "La notifica specificata non esiste oppure non appartiene all’assistito selezionato.");
            }

            var nowUtc = DateTime.UtcNow;

            // Impedisce la marcatura come letta di notifiche
            // che non sono ancora disponibili al destinatario.
            if (notification.ScheduledAtUtc > nowUtc)
            {
                return OperationResult<bool>.BadRequest(
                    "notification_not_visible_yet",
                    "La notifica non è ancora disponibile per la lettura.");
            }

            // Se la notifica è già stata letta,
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
                entity.CreatedAtUtc
            );
        }
    }
}
