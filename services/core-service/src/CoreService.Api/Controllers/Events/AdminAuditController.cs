/*
 * File: services/core-service/src/CoreService.Api/Controllers/Events/AdminAuditController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint amministrativi per la consultazione dei log di audit
 * generati dal sistema applicativo.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del ruolo Admin sul dominio Events limitatamente all'audit trail.
 * Consente di consultare i log di audit applicando filtri su attore,
 * azione, entità, intervallo temporale e limite massimo di risultati.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare i log di audit del sistema con filtri opzionali.
 * - Validare i parametri temporali opzionali espressi in UTC con offset esplicito.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - AdminAuditService
 * - UtcQueryTimeParser
 * - DTO del layer Application
 * - ASP.NET Core MVC
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Admin e non contiene logica di business:
 * delega tutte le regole applicative al servizio specializzato del layer Application.
 */

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Events.Services;
using CoreService.Api.Controllers.Shared;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Events
{
    [ApiController]
    [Route("events/admin/audit")]
    [Authorize(Roles = "Admin")]
    public sealed class AdminAuditController : ControllerBase
    {
        // Servizio applicativo incaricato della consultazione amministrativa
        // dei log di audit del sistema.
        private readonly AdminAuditService _adminAuditService;

        /*
         * Inizializza il controller amministrativo dell'audit
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public AdminAuditController(AdminAuditService adminAuditService)
        {
            _adminAuditService = adminAuditService
                ?? throw new ArgumentNullException(nameof(adminAuditService));
        }

        /*
         * Recupera i log di audit applicando opzionalmente filtri per attore,
         * azione, tipo entità, identificativo entità, intervallo temporale e limite.
         */
        [HttpGet]
        public async Task<ActionResult<IReadOnlyList<AuditLogDto>>> GetAuditLogs(
            [FromQuery] Guid? actorUserId,
            [FromQuery] string? action,
            [FromQuery] string? entityType,
            [FromQuery] string? entityId,
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            [FromQuery] int? limit,
            CancellationToken cancellationToken)
        {
            // Valida e converte il parametro temporale iniziale,
            // richiedendo offset esplicito oppure suffisso UTC.
            if (!UtcQueryTimeParser.TryParseOptionalUtcQuery(fromUtc, "fromUtc", out var parsedFromUtc, out var fromError))
            {
                return fromError!;
            }

            // Valida e converte il parametro temporale finale,
            // richiedendo offset esplicito oppure suffisso UTC.
            if (!UtcQueryTimeParser.TryParseOptionalUtcQuery(toUtc, "toUtc", out var parsedToUtc, out var toError))
            {
                return toError!;
            }

            // Delega al service layer il recupero dei log di audit
            // applicando i filtri amministrativi richiesti.
            var result = await _adminAuditService
                .GetAuditLogsAsync(
                    actorUserId,
                    action,
                    entityType,
                    entityId,
                    parsedFromUtc,
                    parsedToUtc,
                    limit,
                    cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            // Se il servizio non restituisce log espliciti,
            // il controller preferisce una collezione vuota invece di un valore nullo.
            return Ok(result.Value ?? Array.Empty<AuditLogDto>());
        }
    }
}
