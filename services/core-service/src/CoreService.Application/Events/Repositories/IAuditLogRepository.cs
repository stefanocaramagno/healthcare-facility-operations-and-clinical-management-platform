/*
 * File: services/core-service/src/CoreService.Application/Events/Repositories/IAuditLogRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * dei log di audit del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Events
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono registrare e ricercare eventi di audit
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Persistire un nuovo record di audit.
 * - Ricercare record di audit applicando filtri opzionali.
 *
 * Interazioni principali
 * ----------------------
 * - AuditService
 * - AdminAuditService
 * - Implementazioni infrastrutturali dei repository
 * - Entità AuditLogEntry del dominio
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
    public interface IAuditLogRepository
    {
        /*
         * Persiste un nuovo record di audit nel sistema.
         */
        Task AddAsync(
            AuditLogEntry entry,
            CancellationToken cancellationToken = default);

        /*
         * Ricerca i record di audit applicando filtri opzionali
         * su attore, azione, entità, intervallo temporale e limite massimo di risultati.
         */
        Task<IReadOnlyList<AuditLogEntry>> SearchAsync(
            Guid? actorUserId,
            string? action,
            string? entityType,
            string? entityId,
            DateTime? fromUtc,
            DateTime? toUtc,
            int limit,
            CancellationToken cancellationToken = default);
    }
}
