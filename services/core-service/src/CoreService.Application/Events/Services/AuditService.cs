/*
 * File: services/core-service/src/CoreService.Application/Events/Services/AuditService.cs
 *
 * Scopo
 * -----
 * Implementare il servizio applicativo deputato alla scrittura best-effort
 * dei log di audit del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Events
 * e coordina la registrazione delle principali operazioni applicative
 * che devono essere tracciate a fini di audit.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare in modo leggero la richiesta di audit.
 * - Costruire l'entità di dominio AuditLogEntry.
 * - Persistire il log di audit tramite repository dedicato.
 * - Garantire un comportamento best-effort:
 *   un eventuale fallimento della scrittura non deve interrompere il flusso principale.
 * - Registrare un warning applicativo in caso di errore di persistenza.
 *
 * Interazioni principali
 * ----------------------
 * - IAuditLogRepository
 * - ILogger<AuditService>
 * - Entità del dominio Events
 *
 * Note
 * ----
 * Il servizio adotta una strategia best-effort:
 * la mancata scrittura del log di audit viene tracciata nel logger,
 * ma non genera eccezioni verso i chiamanti.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Events.Repositories;
using CoreService.Domain.Events;
using Microsoft.Extensions.Logging;

namespace CoreService.Application.Events.Services
{
    public sealed class AuditService
    {
        // Repository utilizzato per la persistenza dei record di audit.
        private readonly IAuditLogRepository _auditLogRepository;

        // Logger applicativo usato per tracciare eventuali errori
        // senza interrompere il flusso principale del sistema.
        private readonly ILogger<AuditService> _logger;

        /*
         * Inizializza il servizio di audit con le dipendenze necessarie
         * alla persistenza dei log e alla tracciatura diagnostica.
         */
        public AuditService(
            IAuditLogRepository auditLogRepository,
            ILogger<AuditService> logger)
        {
            _auditLogRepository = auditLogRepository
                ?? throw new ArgumentNullException(nameof(auditLogRepository));
            _logger = logger
                ?? throw new ArgumentNullException(nameof(logger));
        }

        /*
         * Tenta di scrivere un log di audit in modalità best-effort.
         *
         * Il metodo non propaga errori di persistenza verso l'esterno:
         * in caso di eccezione, registra soltanto un warning nel logger.
         */
        public async Task WriteBestEffortAsync(
            WriteAuditLogRequest request,
            CancellationToken cancellationToken = default)
        {
            if (request is null)
            {
                throw new ArgumentNullException(nameof(request));
            }

            // Se l'attore non è valorizzato, il log non viene scritto
            // perché l'evento non sarebbe correttamente attribuibile.
            if (request.ActorUserId == Guid.Empty)
            {
                return;
            }

            // I campi minimi necessari per un log di audit valido
            // sono action, entityType ed entityId.
            if (string.IsNullOrWhiteSpace(request.Action) ||
                string.IsNullOrWhiteSpace(request.EntityType) ||
                string.IsNullOrWhiteSpace(request.EntityId))
            {
                return;
            }

            // Costruisce l'entità di audit normalizzando i campi testuali
            // e popolando i metadati temporali e identificativi.
            var entry = new AuditLogEntry
            {
                Id = Guid.NewGuid(),
                ActorUserId = request.ActorUserId,
                Action = request.Action.Trim(),
                EntityType = request.EntityType.Trim(),
                EntityId = request.EntityId.Trim(),
                OccurredAtUtc = DateTime.UtcNow,
                RequestId = string.IsNullOrWhiteSpace(request.RequestId) ? null : request.RequestId.Trim(),
                MetadataJson = string.IsNullOrWhiteSpace(request.MetadataJson) ? null : request.MetadataJson
            };

            try
            {
                await _auditLogRepository
                    .AddAsync(entry, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                // La scrittura dell'audit non deve compromettere il flusso principale:
                // l'errore viene soltanto registrato come warning.
                _logger.LogWarning(
                    ex,
                    "Scrittura audit fallita per action {Action}, entityType {EntityType}, entityId {EntityId}.",
                    request.Action,
                    request.EntityType,
                    request.EntityId);
            }
        }
    }

    /*
     * Rappresenta i dati minimi necessari per richiedere
     * la scrittura di un record di audit applicativo.
     */
    public sealed record WriteAuditLogRequest(
        Guid ActorUserId,
        string Action,
        string EntityType,
        string EntityId,
        string? RequestId,
        string? MetadataJson);
}
