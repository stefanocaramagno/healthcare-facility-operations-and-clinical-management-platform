/*
 * File: services/core-service/src/CoreService.Api/Controllers/Scheduling/PatientSchedulingController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Patient per la consultazione
 * della disponibilità e la gestione dei propri appuntamenti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * self-service del paziente sul dominio Scheduling. Consente al paziente
 * di consultare slot disponibili, visualizzare i propri appuntamenti,
 * prenotare, annullare e ripianificare.
 *
 * Responsabilità principali
 * -------------------------
 * - Consultare la disponibilità dei clinici in un intervallo temporale opzionale.
 * - Recuperare gli appuntamenti del paziente autenticato.
 * - Prenotare un nuovo appuntamento.
 * - Annullare un appuntamento esistente.
 * - Ripianificare un appuntamento esistente.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientSchedulingService
 * - UtcQueryTimeParser
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Patient e non contiene logica di business:
 * ricava l'identità del paziente dal contesto autenticato e delega
 * tutte le regole applicative al servizio specializzato.
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
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Scheduling
{
    [ApiController]
    [Route("scheduling/patients/me")]
    [Authorize(Roles = "Patient")]
    public sealed class PatientSchedulingController : ControllerBase
    {
        // Servizio applicativo incaricato delle operazioni di scheduling
        // eseguite dal paziente autenticato.
        private readonly PatientSchedulingService _patientSchedulingService;

        /*
         * Inizializza il controller di scheduling del paziente
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public PatientSchedulingController(PatientSchedulingService patientSchedulingService)
        {
            _patientSchedulingService = patientSchedulingService
                ?? throw new ArgumentNullException(nameof(patientSchedulingService));
        }

        /*
         * Recupera la disponibilità dei clinici filtrando opzionalmente
         * per clinico e intervallo temporale espresso in UTC.
         */
        [HttpGet("availability")]
        public async Task<ActionResult<IReadOnlyList<AvailabilitySlotDto>>> GetAvailability(
            [FromQuery] Guid? clinicianUserId,
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
            // Valida e converte il parametro temporale iniziale, richiedendo offset esplicito.
            if (!UtcQueryTimeParser.TryParseOptionalUtcQuery(fromUtc, "fromUtc", out var parsedFromUtc, out var fromError))
            {
                return fromError!;
            }

            // Valida e converte il parametro temporale finale, richiedendo offset esplicito.
            if (!UtcQueryTimeParser.TryParseOptionalUtcQuery(toUtc, "toUtc", out var parsedToUtc, out var toError))
            {
                return toError!;
            }

            // Delega al service layer il recupero della disponibilità visibile al paziente.
            var result = await _patientSchedulingService
                .GetAvailabilityAsync(clinicianUserId, parsedFromUtc, parsedToUtc, cancellationToken)
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
         * Recupera gli appuntamenti del paziente autenticato
         * filtrando opzionalmente per intervallo temporale espresso in UTC.
         */
        [HttpGet("appointments")]
        public async Task<ActionResult<IReadOnlyList<PatientAppointmentDto>>> GetMyAppointments(
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var userIdResult = GetCurrentUserId();
            if (userIdResult.Result is not null)
            {
                return userIdResult.Result;
            }

            var patientUserId = userIdResult.Value;

            // Valida e converte il parametro temporale iniziale.
            if (!UtcQueryTimeParser.TryParseOptionalUtcQuery(fromUtc, "fromUtc", out var parsedFromUtc, out var fromError))
            {
                return fromError!;
            }

            // Valida e converte il parametro temporale finale.
            if (!UtcQueryTimeParser.TryParseOptionalUtcQuery(toUtc, "toUtc", out var parsedToUtc, out var toError))
            {
                return toError!;
            }

            // Delega al service layer il recupero degli appuntamenti del paziente corrente.
            var result = await _patientSchedulingService
                .GetMyAppointmentsAsync(patientUserId, parsedFromUtc, parsedToUtc, cancellationToken)
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
         * Prenota un nuovo appuntamento per il paziente autenticato.
         */
        [HttpPost("appointments")]
        public async Task<ActionResult<PatientAppointmentDto>> BookAppointment(
            [FromBody] BookAppointmentRequest request,
            CancellationToken cancellationToken)
        {
            // Il body della richiesta è obbligatorio per poter effettuare la prenotazione.
            if (request == null)
            {
                return BadRequest(new
                {
                    code = "invalid_request",
                    message = "Il body della richiesta non può essere nullo."
                });
            }

            // Ricava l'identificativo del paziente dal contesto autenticato.
            var userIdResult = GetCurrentUserId();
            if (userIdResult.Result is not null)
            {
                return userIdResult.Result;
            }

            var patientUserId = userIdResult.Value;

            // Delega al service layer la prenotazione dell'appuntamento.
            var result = await _patientSchedulingService
                .BookAppointmentAsync(patientUserId, request, cancellationToken)
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
         * Annulla un appuntamento esistente del paziente autenticato.
         */
        [HttpPost("appointments/{appointmentId:guid}/cancel")]
        public async Task<ActionResult<PatientAppointmentDto>> CancelAppointment(
            Guid appointmentId,
            [FromBody] CancelAppointmentRequest request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var userIdResult = GetCurrentUserId();
            if (userIdResult.Result is not null)
            {
                return userIdResult.Result;
            }

            var patientUserId = userIdResult.Value;

            // Delega al service layer l'annullamento dell'appuntamento.
            var result = await _patientSchedulingService
                .CancelAppointmentAsync(patientUserId, appointmentId, request, cancellationToken)
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
         * Ripianifica un appuntamento esistente del paziente autenticato.
         */
        [HttpPost("appointments/{appointmentId:guid}/reschedule")]
        public async Task<ActionResult<PatientAppointmentDto>> RescheduleAppointment(
            Guid appointmentId,
            [FromBody] RescheduleAppointmentRequest request,
            CancellationToken cancellationToken)
        {
            // Il body della richiesta è obbligatorio per poter eseguire la ripianificazione.
            if (request == null)
            {
                return BadRequest(new
                {
                    code = "invalid_request",
                    message = "Il body della richiesta non può essere nullo."
                });
            }

            // Ricava l'identificativo del paziente dal contesto autenticato.
            var userIdResult = GetCurrentUserId();
            if (userIdResult.Result is not null)
            {
                return userIdResult.Result;
            }

            var patientUserId = userIdResult.Value;

            // Delega al service layer la ripianificazione dell'appuntamento.
            var result = await _patientSchedulingService
                .RescheduleAppointmentAsync(patientUserId, appointmentId, request, cancellationToken)
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
         * Ricava l'identificativo Guid del paziente corrente dal token JWT
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
                return Unauthorized();
            }

            // Se il claim presente non è convertibile in Guid, la richiesta viene rifiutata.
            if (!Guid.TryParse(subject, out var userId))
            {
                return Unauthorized();
            }

            return userId;
        }
    }
}
