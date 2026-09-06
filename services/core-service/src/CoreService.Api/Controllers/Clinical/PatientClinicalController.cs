/*
 * File: services/core-service/src/CoreService.Api/Controllers/Clinical/PatientClinicalController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Patient per la consultazione
 * dei propri referti clinici pubblicati.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * self-service del paziente sul dominio Clinical limitatamente ai referti.
 * Tutte le operazioni sono vincolate all'identità del paziente autenticato
 * ricavata dal token JWT.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'elenco dei referti pubblicati del paziente autenticato.
 * - Validare i parametri temporali opzionali espressi in UTC con offset esplicito.
 * - Ricavare in modo affidabile l'identità del paziente dal contesto autenticato.
 * - Tradurre gli esiti del workflow in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientClinicalService
 * - UtcQueryTimeParser
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Patient e non contiene logica di business:
 * delega tutte le regole applicative al servizio specializzato del layer Application.
 */

using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Clinical.Services;
using CoreService.Api.Controllers.Shared;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Clinical
{
    [ApiController]
    [Route("clinical/patients/me")]
    [Authorize(Roles = "Patient")]
    public sealed class PatientClinicalController : ControllerBase
    {
        // Servizio applicativo incaricato del recupero dei referti clinici
        // pubblicati e visibili al paziente autenticato.
        private readonly PatientClinicalService _patientClinicalService;

        /*
         * Inizializza il controller clinico del paziente
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public PatientClinicalController(PatientClinicalService patientClinicalService)
        {
            _patientClinicalService = patientClinicalService
                ?? throw new ArgumentNullException(nameof(patientClinicalService));
        }

        /*
         * Recupera l'elenco dei referti pubblicati del paziente autenticato,
         * filtrando opzionalmente per intervallo temporale espresso in UTC.
         */
        [HttpGet("reports")]
        public async Task<ActionResult<IReadOnlyList<PatientClinicalReportDto>>> GetMyReports(
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var currentUserId = currentUserResult.Value;

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

            // Delega al service layer il recupero dei referti pubblicati
            // relativi al paziente corrente.
            var reports = await _patientClinicalService
                .GetPublishedReportsForPatientAsync(
                    currentUserId,
                    parsedFromUtc,
                    parsedToUtc,
                    cancellationToken)
                .ConfigureAwait(false);

            return Ok(reports);
        }

        /*
         * Ricava l'identificativo Guid del paziente corrente dal token JWT
         * e restituisce una ActionResult di errore se il contesto autenticato non è valido.
         */
        private (Guid Value, ActionResult? Result) GetCurrentUserId()
        {
            // Supporta sia il claim .NET NameIdentifier sia i claim JWT "sub",
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var userIdClaim =
                User.FindFirst(ClaimTypes.NameIdentifier)?.Value ??
                User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ??
                User.FindFirst("sub")?.Value;

            // Se il token non contiene un identificativo utente valido,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                var errorPayload = new
                {
                    code = "invalid_token",
                    message = "Token JWT privo di identificativo utente valido."
                };

                return (Guid.Empty, Unauthorized(errorPayload));
            }

            return (userId, null);
        }
    }
}
