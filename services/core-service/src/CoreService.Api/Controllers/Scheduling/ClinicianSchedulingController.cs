/*
 * File: services/core-service/src/CoreService.Api/Controllers/Scheduling/ClinicianSchedulingController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Clinician per la consultazione
 * della propria agenda appuntamenti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * self-service del clinico sul dominio Scheduling. Consente al clinico
 * di consultare i propri appuntamenti in un intervallo temporale opzionale,
 * ricavando l'identità dal token JWT autenticato.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'agenda del clinico autenticato.
 * - Validare i parametri temporali opzionali espressi in UTC con offset esplicito.
 * - Ricavare in modo affidabile l'identità del clinico dal contesto autenticato.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - ClinicianSchedulingService
 * - UtcQueryTimeParser
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Clinician e non contiene logica di business:
 * delega tutte le regole applicative al servizio specializzato del layer Application.
 */

using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Scheduling.Services;
using CoreService.Api.Controllers.Shared;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Scheduling
{
    [ApiController]
    [Route("scheduling/clinicians")]
    [Authorize(Roles = "Clinician")]
    public sealed class ClinicianSchedulingController : ControllerBase
    {
        // Servizio applicativo incaricato del recupero dell'agenda
        // del clinico autenticato.
        private readonly ClinicianSchedulingService _clinicianSchedulingService;

        /*
         * Inizializza il controller di scheduling del clinico
         * con il servizio applicativo responsabile del recupero agenda.
         */
        public ClinicianSchedulingController(ClinicianSchedulingService clinicianSchedulingService)
        {
            _clinicianSchedulingService = clinicianSchedulingService
                ?? throw new ArgumentNullException(nameof(clinicianSchedulingService));
        }

        /*
         * Recupera l'agenda del clinico autenticato filtrando opzionalmente
         * per intervallo temporale espresso in UTC.
         */
        [HttpGet("me/appointments")]
        public async Task<ActionResult<IReadOnlyList<ClinicianAgendaItemDto>>> GetMyAgenda(
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var userIdResult = GetCurrentUserId();
            if (userIdResult.Result is not null)
            {
                return userIdResult.Result;
            }

            var clinicianUserId = userIdResult.Value;

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

            // Delega al service layer il recupero dell'agenda del clinico corrente.
            var result = await _clinicianSchedulingService
                .GetMyAgendaAsync(clinicianUserId, parsedFromUtc, parsedToUtc, cancellationToken)
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

            return Ok(result.Value);
        }

        /*
         * Ricava l'identificativo Guid del clinico corrente dal token JWT
         * e restituisce una ActionResult di errore se il contesto autenticato non è valido.
         */
        private ActionResult<Guid> GetCurrentUserId()
        {
            // Supporta sia il claim JWT "sub" sia il claim .NET NameIdentifier
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var subject =
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ??
                User.FindFirstValue(ClaimTypes.NameIdentifier);

            // Se il token non contiene alcun identificativo utente, la richiesta viene rifiutata.
            if (string.IsNullOrWhiteSpace(subject))
            {
                return Unauthorized(new
                {
                    code = "invalid_token",
                    message = "Token JWT privo di identificativo utente valido."
                });
            }

            // Se il claim presente non è convertibile in Guid, la richiesta viene rifiutata.
            if (!Guid.TryParse(subject, out var userId))
            {
                return Unauthorized(new
                {
                    code = "invalid_token",
                    message = "Token JWT privo di identificativo utente valido."
                });
            }

            return userId;
        }
    }
}
