/*
 * File: services/core-service/src/CoreService.Application/Events/Services/AdminAuditService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi amministrativi
 * relativi alla consultazione dei log di audit del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Events
 * e coordina il workflow che consente all'amministratore
 * di ricercare e recuperare i record di audit
 * applicando filtri opzionali su attore, azione, entità,
 * intervallo temporale e limite massimo di risultati.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare e normalizzare i parametri temporali di ricerca.
 * - Validare il limite massimo dei risultati richiesti.
 * - Delegare la ricerca dei log di audit al repository dedicato.
 * - Mappare le entità di audit nei corrispondenti DTO applicativi.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IAuditLogRepository
 * - DTO del layer Application
 * - Utility condivise per la normalizzazione dei DateTime UTC
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
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Events.Repositories;

namespace CoreService.Application.Events.Services
{
    public sealed class AdminAuditService
    {
        // Repository applicativo necessario alla ricerca e al recupero
        // dei record di audit persistiti nel sistema.
        private readonly IAuditLogRepository _auditLogRepository;

        /*
         * Inizializza il servizio con la dipendenza necessaria
         * ai workflow amministrativi di consultazione dell'audit.
         */
        public AdminAuditService(IAuditLogRepository auditLogRepository)
        {
            _auditLogRepository = auditLogRepository
                ?? throw new ArgumentNullException(nameof(auditLogRepository));
        }

        /*
         * Recupera i log di audit applicando i filtri specificati
         * su attore, azione, entità, intervallo temporale e limite massimo.
         */
        public async Task<OperationResult<IReadOnlyList<AuditLogDto>>> GetAuditLogsAsync(
            Guid? actorUserId,
            string? action,
            string? entityType,
            string? entityId,
            DateTime? fromUtc,
            DateTime? toUtc,
            int? limit,
            CancellationToken cancellationToken)
        {
            // Normalizza il parametro temporale iniziale
            // imponendo una semantica UTC esplicita quando valorizzato.
            if (!UtcDateTimeInput.TryNormalizeOptional(fromUtc, "fromUtc", out var effectiveFromUtc, out var fromError))
            {
                return OperationResult<IReadOnlyList<AuditLogDto>>.BadRequest(
                    "invalid_datetime",
                    fromError!);
            }

            // Normalizza il parametro temporale finale
            // imponendo una semantica UTC esplicita quando valorizzato.
            if (!UtcDateTimeInput.TryNormalizeOptional(toUtc, "toUtc", out var effectiveToUtc, out var toError))
            {
                return OperationResult<IReadOnlyList<AuditLogDto>>.BadRequest(
                    "invalid_datetime",
                    toError!);
            }

            // Verifica la coerenza dell'intervallo temporale richiesto.
            if (effectiveFromUtc.HasValue && effectiveToUtc.HasValue && effectiveFromUtc.Value > effectiveToUtc.Value)
            {
                return OperationResult<IReadOnlyList<AuditLogDto>>.BadRequest(
                    "invalid_date_range",
                    "Il parametro 'fromUtc' deve essere precedente o uguale a 'toUtc'.");
            }

            // Applica un valore di default al limite massimo dei risultati
            // e ne valida la correttezza semantica.
            var effectiveLimit = limit.GetValueOrDefault(200);
            if (effectiveLimit <= 0)
            {
                return OperationResult<IReadOnlyList<AuditLogDto>>.BadRequest(
                    "invalid_limit",
                    "Il parametro 'limit' deve essere maggiore di zero.");
            }

            // Delega al repository la ricerca dei log di audit
            // secondo i filtri applicativi validati.
            var items = await _auditLogRepository
                .SearchAsync(
                    actorUserId,
                    action,
                    entityType,
                    entityId,
                    effectiveFromUtc,
                    effectiveToUtc,
                    effectiveLimit,
                    cancellationToken)
                .ConfigureAwait(false);

            // Mappa le entità restituite dal repository
            // nei DTO destinati ai layer superiori.
            var dtos = items
                .Select(x => new AuditLogDto(
                    x.Id,
                    x.ActorUserId,
                    x.Action,
                    x.EntityType,
                    x.EntityId,
                    x.OccurredAtUtc,
                    x.RequestId,
                    x.MetadataJson))
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<AuditLogDto>>.Success(dtos);
        }
    }
}
