/*
 * File: services/core-service/src/CoreService.Application/Events/Services/AdminNotificationsService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi amministrativi
 * relativi alla consultazione e alla creazione delle notifiche di sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Events
 * e coordina i workflow che consentono all'amministratore di:
 * - consultare le notifiche del sistema con filtri opzionali;
 * - recuperare una singola notifica per identificativo;
 * - creare una nuova notifica su canale IN_APP oppure EMAIL.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare notifiche filtrate per destinatario e stato.
 * - Recuperare una notifica specifica tramite identificativo.
 * - Validare il payload di creazione di una notifica.
 * - Normalizzare data di schedulazione e canale di invio.
 * - Verificare l'esistenza e la disponibilità dell'e-mail del destinatario
 *   quando il canale richiesto è EMAIL.
 * - Gestire l'invio immediato per notifiche già schedulate nel presente o nel passato.
 * - Persistire comunque la notifica, anche in caso di fallimento dell'invio e-mail.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - INotificationsRepository
 * - IUserRepository
 * - INotificationEmailSender
 * - Entità del dominio Events
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati al repository notifiche
 * e al componente dedicato all'invio e-mail.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Events.Repositories;
using CoreService.Application.Events.Abstractions;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Events;

namespace CoreService.Application.Events.Services
{
    public sealed class AdminNotificationsService
    {
        // Repository applicativo utilizzato per recuperare e persistere le notifiche.
        private readonly INotificationsRepository _notificationsRepository;

        // Repository applicativo utilizzato per recuperare le informazioni utente
        // necessarie soprattutto nei workflow di notifica e-mail.
        private readonly IUserRepository _userRepository;

        // Componente astratto responsabile dell'invio delle notifiche tramite e-mail.
        private readonly INotificationEmailSender _notificationEmailSender;

        /*
         * Inizializza il servizio con le dipendenze necessarie
         * ai workflow amministrativi di consultazione e creazione notifiche.
         */
        public AdminNotificationsService(
            INotificationsRepository notificationsRepository,
            IUserRepository userRepository,
            INotificationEmailSender notificationEmailSender)
        {
            _notificationsRepository = notificationsRepository
                ?? throw new ArgumentNullException(nameof(notificationsRepository));
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _notificationEmailSender = notificationEmailSender
                ?? throw new ArgumentNullException(nameof(notificationEmailSender));
        }

        /*
         * Recupera l'elenco delle notifiche del sistema,
         * applicando opzionalmente un filtro per destinatario e stato.
         */
        public async Task<OperationResult<IReadOnlyList<NotificationDto>>> GetNotificationsAsync(
            Guid? recipientUserId,
            string? status,
            CancellationToken cancellationToken)
        {
            // Prova a convertire il filtro testuale dello stato
            // nella corrispondente enum di dominio.
            NotificationStatus? parsedStatus = null;

            if (!string.IsNullOrWhiteSpace(status) &&
                Enum.TryParse<NotificationStatus>(status, ignoreCase: true, out var tmp))
            {
                parsedStatus = tmp;
            }

            // Recupera le notifiche coerenti con i filtri richiesti.
            var notifications = await _notificationsRepository
                .GetNotificationsAsync(recipientUserId, parsedStatus, cancellationToken)
                .ConfigureAwait(false);

            // Converte le entità di dominio nei corrispondenti DTO applicativi.
            var dtos = notifications
                .Select(MapToDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<NotificationDto>>.Success(dtos);
        }

        /*
         * Recupera una singola notifica del sistema
         * a partire dal suo identificativo univoco.
         */
        public async Task<OperationResult<NotificationDto>> GetNotificationByIdAsync(
            Guid notificationId,
            CancellationToken cancellationToken)
        {
            var notification = await _notificationsRepository
                .GetByIdAsync(notificationId, cancellationToken)
                .ConfigureAwait(false);

            if (notification is null)
            {
                return OperationResult<NotificationDto>.NotFound(
                    "notification_not_found",
                    "La notifica specificata non esiste.");
            }

            return OperationResult<NotificationDto>.Success(MapToDto(notification));
        }

        /*
         * Crea una nuova notifica amministrativa,
         * eventualmente inviandola immediatamente se la schedulazione lo richiede.
         */
        public async Task<OperationResult<NotificationDto>> CreateNotificationAsync(
            CreateNotificationRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload è obbligatorio per poter creare una notifica.
            if (request is null)
            {
                return OperationResult<NotificationDto>.BadRequest(
                    "invalid_request",
                    "Il payload della richiesta è mancante.");
            }

            // Il destinatario deve essere esplicitamente identificato.
            if (request.RecipientUserId == Guid.Empty)
            {
                return OperationResult<NotificationDto>.BadRequest(
                    "invalid_request",
                    "È necessario specificare l'identificativo del destinatario.");
            }

            // L'oggetto della notifica è obbligatorio.
            if (string.IsNullOrWhiteSpace(request.Subject))
            {
                return OperationResult<NotificationDto>.BadRequest(
                    "invalid_request",
                    "Il campo 'Subject' è obbligatorio.");
            }

            // Il corpo della notifica è obbligatorio.
            if (string.IsNullOrWhiteSpace(request.Body))
            {
                return OperationResult<NotificationDto>.BadRequest(
                    "invalid_request",
                    "Il campo 'Body' è obbligatorio.");
            }

            var nowUtc = DateTime.UtcNow;

            // Normalizza la data di schedulazione imponendo una semantica UTC esplicita
            // quando il campo è valorizzato.
            if (!UtcDateTimeInput.TryNormalizeOptional(request.ScheduledAtUtc, "scheduledAtUtc", out var normalizedScheduledAtUtc, out var scheduledAtError))
            {
                return OperationResult<NotificationDto>.BadRequest(
                    "invalid_datetime",
                    scheduledAtError!);
            }

            // In assenza di una data esplicita, la notifica viene considerata immediata.
            var scheduledAtUtc = normalizedScheduledAtUtc ?? nowUtc;

            // Normalizza il canale di invio applicando IN_APP come default.
            var channel = string.IsNullOrWhiteSpace(request.Channel)
                ? "IN_APP"
                : request.Channel.Trim().ToUpperInvariant();

            // Valida il canale richiesto.
            if (channel != "IN_APP" && channel != "EMAIL")
            {
                return OperationResult<NotificationDto>.BadRequest(
                    "unsupported_channel",
                    "Il canale specificato non è supportato. I valori ammessi sono IN_APP ed EMAIL.");
            }

            string? recipientEmail = null;

            // Se il canale richiesto è EMAIL, verifica l'esistenza del destinatario
            // e la disponibilità di un indirizzo e-mail valido.
            if (channel == "EMAIL")
            {
                var recipientUser = await _userRepository
                    .GetByIdAsync(request.RecipientUserId, cancellationToken)
                    .ConfigureAwait(false);

                if (recipientUser is null)
                {
                    return OperationResult<NotificationDto>.BadRequest(
                        "recipient_not_found",
                        "Il destinatario specificato non esiste.");
                }

                if (string.IsNullOrWhiteSpace(recipientUser.Email))
                {
                    return OperationResult<NotificationDto>.BadRequest(
                        "recipient_missing_email",
                        "Il destinatario non dispone di un indirizzo e-mail.");
                }

                recipientEmail = recipientUser.Email.Trim();
            }

            // Crea l'entità di dominio iniziale in stato Pending.
            var notification = new Notification
            {
                Id = Guid.NewGuid(),
                RecipientUserId = request.RecipientUserId,
                Channel = channel,
                Subject = request.Subject.Trim(),
                Body = request.Body.Trim(),
                Status = NotificationStatus.Pending,
                ScheduledAtUtc = scheduledAtUtc,
                SentAtUtc = null,
                Error = null,
                CreatedAtUtc = nowUtc
            };

            // Se la schedulazione è già maturata, la notifica viene trattata immediatamente.
            if (notification.ScheduledAtUtc <= nowUtc)
            {
                if (channel == "IN_APP")
                {
                    // Per il canale IN_APP la notifica è considerata immediatamente disponibile.
                    notification.Status = NotificationStatus.Sent;
                    notification.SentAtUtc = nowUtc;
                }
                else
                {
                    // Per il canale EMAIL prova a inviare subito il messaggio
                    // e registra l'eventuale errore senza interrompere il workflow di creazione.
                    try
                    {
                        await _notificationEmailSender
                            .SendNotificationEmailAsync(
                                recipientEmail!,
                                notification.Subject,
                                notification.Body,
                                cancellationToken)
                            .ConfigureAwait(false);

                        notification.Status = NotificationStatus.Sent;
                        notification.SentAtUtc = DateTime.UtcNow;
                        notification.Error = null;
                    }
                    catch (Exception ex)
                    {
                        notification.Status = NotificationStatus.Failed;
                        notification.SentAtUtc = null;
                        notification.Error = TruncateError(ex.Message);
                    }
                }
            }

            // Persiste la notifica indipendentemente dal fatto che l'invio e-mail
            // sia avvenuto con successo oppure sia fallito.
            await _notificationsRepository
                .AddAsync(notification, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapToDto(notification);

            return OperationResult<NotificationDto>.Success(dto);
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

        /*
         * Normalizza un messaggio di errore rendendolo compatibile
         * con i limiti di lunghezza previsti dal modello di persistenza.
         */
        private static string? TruncateError(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }

            var normalized = value.Trim();
            return normalized.Length <= 255
                ? normalized
                : normalized[..255];
        }
    }
}
