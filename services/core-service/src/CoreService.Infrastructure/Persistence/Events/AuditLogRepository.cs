/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Events/AuditLogRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità AuditLogEntry del bounded context Events.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IAuditLogRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Events.
 *
 * Responsabilità principali
 * -------------------------
 * - Persistire un nuovo record di audit.
 * - Ricercare record di audit applicando filtri opzionali.
 * - Applicare ordinamento e limite massimo ai risultati di ricerca.
 *
 * Interazioni principali
 * ----------------------
 * - EventsDbContext
 * - IAuditLogRepository
 * - Entità AuditLogEntry del dominio Events
 *
 * Note
 * ----
 * Le operazioni di lettura utilizzano AsNoTracking() per evitare
 * il tracking non necessario da parte di Entity Framework Core
 * nei casi di semplice consultazione.
 * Le operazioni di scrittura persistono immediatamente le modifiche sul database.
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
    public sealed class AuditLogRepository : IAuditLogRepository
    {
        // DbContext del bounded context Events usato
        // per eseguire query e operazioni di persistenza sui log di audit.
        private readonly EventsDbContext _eventsDbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Events.
         */
        public AuditLogRepository(EventsDbContext eventsDbContext)
        {
            _eventsDbContext = eventsDbContext
                ?? throw new ArgumentNullException(nameof(eventsDbContext));
        }

        /*
         * Persiste un nuovo record di audit nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            AuditLogEntry entry,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (entry is null)
            {
                throw new ArgumentNullException(nameof(entry));
            }

            // Inserisce la nuova entità nel DbContext.
            _eventsDbContext.AuditLogs.Add(entry);

            // Salva immediatamente le modifiche sul database.
            await _eventsDbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Ricerca i record di audit applicando i filtri opzionali richiesti
         * e limita il risultato a un numero massimo di elementi.
         */
        public async Task<IReadOnlyList<AuditLogEntry>> SearchAsync(
            Guid? actorUserId,
            string? action,
            string? entityType,
            string? entityId,
            DateTime? fromUtc,
            DateTime? toUtc,
            int limit,
            CancellationToken cancellationToken = default)
        {
            // Costruisce la query base in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            var query = _eventsDbContext
                .AuditLogs
                .AsNoTracking()
                .AsQueryable();

            // Se è stato specificato un attore valido,
            // restringe il risultato ai log generati da quell'utente.
            if (actorUserId.HasValue && actorUserId.Value != Guid.Empty)
            {
                query = query.Where(x => x.ActorUserId == actorUserId.Value);
            }

            // Se è stata specificata un'azione, normalizza il valore
            // e applica il filtro esatto sul campo Action.
            if (!string.IsNullOrWhiteSpace(action))
            {
                var normalizedAction = action.Trim();
                query = query.Where(x => x.Action == normalizedAction);
            }

            // Se è stato specificato il tipo entità, normalizza il valore
            // e applica il filtro esatto sul campo EntityType.
            if (!string.IsNullOrWhiteSpace(entityType))
            {
                var normalizedEntityType = entityType.Trim();
                query = query.Where(x => x.EntityType == normalizedEntityType);
            }

            // Se è stato specificato l'identificativo dell'entità, normalizza il valore
            // e applica il filtro esatto sul campo EntityId.
            if (!string.IsNullOrWhiteSpace(entityId))
            {
                var normalizedEntityId = entityId.Trim();
                query = query.Where(x => x.EntityId == normalizedEntityId);
            }

            // Se presente, applica il filtro sulla data minima di accadimento.
            if (fromUtc.HasValue)
            {
                query = query.Where(x => x.OccurredAtUtc >= fromUtc.Value);
            }

            // Se presente, applica il filtro sulla data massima di accadimento.
            if (toUtc.HasValue)
            {
                query = query.Where(x => x.OccurredAtUtc <= toUtc.Value);
            }

            // Applica un limite difensivo ai risultati:
            // usa 200 come default e non consente di superare 500 elementi.
            var safeLimit = limit <= 0 ? 200 : Math.Min(limit, 500);

            // Ordina i risultati dal più recente al meno recente
            // e applica il limite massimo richiesto.
            var items = await query
                .OrderByDescending(x => x.OccurredAtUtc)
                .ThenByDescending(x => x.Id)
                .Take(safeLimit)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return items;
        }
    }
}
