/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Events/NotificationsRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità Notification del bounded context Events.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia INotificationsRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Events.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare le notifiche in-app visibili per un destinatario.
 * - Recuperare una specifica notifica in-app di un destinatario.
 * - Recuperare notifiche con filtri amministrativi opzionali.
 * - Recuperare una notifica tramite identificativo univoco.
 * - Recuperare le notifiche e-mail pending già scadute e quindi pronte per la consegna.
 * - Persistire, aggiornare e marcare come lette le notifiche.
 *
 * Interazioni principali
 * ----------------------
 * - EventsDbContext
 * - INotificationsRepository
 * - Entità Notification del dominio Events
 *
 * Note
 * ----
 * Le operazioni di lettura utilizzano AsNoTracking() per evitare
 * il tracking non necessario da parte di Entity Framework Core
 * nei casi di semplice consultazione.
 * Le operazioni di scrittura persistono immediatamente le modifiche sul database.
 * Il repository distingue esplicitamente le notifiche in-app da quelle e-mail
 * tramite costanti di canale dedicate.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Events.Repositories;
using CoreService.Domain.Events;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Events
{
    public sealed class NotificationsRepository : INotificationsRepository
    {
        // Valore canonico del canale relativo alle notifiche in-app.
        private const string InAppChannel = "IN_APP";

        // Valore canonico del canale relativo alle notifiche e-mail.
        private const string EmailChannel = "EMAIL";

        // DbContext del bounded context Events usato
        // per eseguire query e operazioni di persistenza sulle notifiche.
        private readonly EventsDbContext _eventsDbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Events.
         */
        public NotificationsRepository(EventsDbContext eventsDbContext)
        {
            _eventsDbContext = eventsDbContext
                ?? throw new ArgumentNullException(nameof(eventsDbContext));
        }

        /*
         * Recupera le notifiche in-app visibili per un determinato destinatario,
         * con possibilità di limitare il risultato alle sole notifiche non lette.
         */
        public async Task<IReadOnlyList<Notification>> GetVisibleNotificationsForRecipientAsync(
            Guid recipientUserId,
            bool onlyUnread,
            DateTime nowUtc,
            CancellationToken cancellationToken = default)
        {
            // Costruisce la query base limitandola:
            // - al destinatario richiesto;
            // - alle sole notifiche in-app;
            // - alle notifiche già schedulate e quindi visibili.
            var query = _eventsDbContext
                .Notifications
                .AsNoTracking()
                .Where(n =>
                    n.RecipientUserId == recipientUserId &&
                    n.Channel == InAppChannel &&
                    n.ScheduledAtUtc <= nowUtc);

            // Se richiesto, esclude dal risultato le notifiche già lette.
            if (onlyUnread)
            {
                query = query.Where(n => n.Status != NotificationStatus.Read);
            }

            // Ordina le notifiche dalla più recente alla meno recente
            // in base alla schedulazione e, a parità, alla creazione.
            var list = await query
                .OrderByDescending(n => n.ScheduledAtUtc)
                .ThenByDescending(n => n.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return list;
        }

        /*
         * Recupera una specifica notifica in-app appartenente a un determinato destinatario.
         */
        public async Task<Notification?> GetNotificationForRecipientAsync(
            Guid recipientUserId,
            Guid notificationId,
            CancellationToken cancellationToken = default)
        {
            // Restituisce la notifica solo se:
            // - l'identificativo corrisponde;
            // - il destinatario coincide;
            // - il canale è quello in-app.
            return await _eventsDbContext
                .Notifications
                .FirstOrDefaultAsync(
                    n =>
                        n.Id == notificationId &&
                        n.RecipientUserId == recipientUserId &&
                        n.Channel == InAppChannel,
                    cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera le notifiche applicando opzionalmente
         * il filtro per destinatario e il filtro per stato.
         */
        public async Task<IReadOnlyList<Notification>> GetNotificationsAsync(
            Guid? recipientUserId,
            NotificationStatus? status,
            CancellationToken cancellationToken = default)
        {
            // Costruisce la query base in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            var query = _eventsDbContext
                .Notifications
                .AsNoTracking()
                .AsQueryable();

            // Se è stato specificato un destinatario valido,
            // restringe il risultato alle notifiche di quell'utente.
            if (recipientUserId.HasValue && recipientUserId.Value != Guid.Empty)
            {
                query = query.Where(n => n.RecipientUserId == recipientUserId.Value);
            }

            // Se è stato specificato uno stato,
            // restringe il risultato alle notifiche con quello stato.
            if (status.HasValue)
            {
                query = query.Where(n => n.Status == status.Value);
            }

            // Ordina le notifiche dalla più recente alla meno recente
            // in base alla schedulazione e, a parità, alla creazione.
            var list = await query
                .OrderByDescending(n => n.ScheduledAtUtc)
                .ThenByDescending(n => n.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return list;
        }

        /*
         * Recupera una notifica tramite il suo identificativo univoco.
         */
        public async Task<Notification?> GetByIdAsync(
            Guid notificationId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _eventsDbContext
                .Notifications
                .AsNoTracking()
                .FirstOrDefaultAsync(n => n.Id == notificationId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera le notifiche e-mail pending già scadute,
         * quindi pronte per essere processate da un sender esterno.
         */
        public async Task<IReadOnlyList<Notification>> GetDuePendingEmailNotificationsAsync(
            DateTime nowUtc,
            int take,
            CancellationToken cancellationToken = default)
        {
            // Applica un fallback difensivo sul numero massimo di elementi richiesti.
            var safeTake = take <= 0 ? 25 : take;

            // Seleziona le notifiche:
            // - di canale EMAIL;
            // - ancora in stato Pending;
            // - già arrivate al momento di schedulazione.
            var list = await _eventsDbContext
                .Notifications
                .AsNoTracking()
                .Where(n =>
                    n.Channel == EmailChannel &&
                    n.Status == NotificationStatus.Pending &&
                    n.ScheduledAtUtc <= nowUtc)
                .OrderBy(n => n.ScheduledAtUtc)
                .ThenBy(n => n.CreatedAtUtc)
                .Take(safeTake)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return list;
        }

        /*
         * Persiste una nuova notifica nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            Notification notification,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (notification == null)
            {
                throw new ArgumentNullException(nameof(notification));
            }

            // Inserisce la nuova entità nel DbContext.
            _eventsDbContext.Notifications.Add(notification);

            // Salva immediatamente le modifiche sul database.
            await _eventsDbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna una notifica esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            Notification notification,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (notification == null)
            {
                throw new ArgumentNullException(nameof(notification));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _eventsDbContext.Notifications.Update(notification);

            // Salva immediatamente le modifiche sul database.
            await _eventsDbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Marca una notifica come letta
         * e conferma immediatamente la modifica sul database.
         */
        public async Task MarkAsReadAsync(
            Notification notification,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (notification == null)
            {
                throw new ArgumentNullException(nameof(notification));
            }

            // Aggiorna lo stato dell'entità nel dominio applicativo.
            notification.Status = NotificationStatus.Read;

            // Marca l'entità come aggiornata nel DbContext.
            _eventsDbContext.Notifications.Update(notification);

            // Salva immediatamente le modifiche sul database.
            await _eventsDbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }
    }
}
