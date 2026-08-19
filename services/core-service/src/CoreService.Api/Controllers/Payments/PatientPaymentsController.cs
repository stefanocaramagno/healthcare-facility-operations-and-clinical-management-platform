/*
 * File: services/core-service/src/CoreService.Api/Controllers/Payments/PatientPaymentsController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Patient per la consultazione
 * dei propri PaymentIntent e per l'avvio/elaborazione dei pagamenti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * self-service del paziente sul dominio Payments. Consente al paziente
 * di consultare i propri intenti di pagamento, creare un PaymentIntent
 * per un appuntamento ed elaborare il pagamento associato.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare i PaymentIntent del paziente autenticato.
 * - Creare un PaymentIntent per uno specifico appuntamento.
 * - Elaborare un pagamento su un PaymentIntent esistente.
 * - Validare i parametri temporali opzionali espressi in UTC con offset esplicito.
 * - Ricavare in modo affidabile l'identità del paziente dal contesto autenticato.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientPaymentsService
 * - PaymentCheckoutWorkflowService
 * - UtcQueryTimeParser
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Patient e non contiene logica di business:
 * delega tutte le regole applicative ai servizi specializzati del layer Application.
 */

using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Payments.Services;
using CoreService.Api.Controllers.Shared;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Payments
{
    [ApiController]
    [Route("payments/patients/me")]
    [Authorize(Roles = "Patient")]
    public sealed class PatientPaymentsController : ControllerBase
    {
        // Servizi applicativi usati per il recupero dei PaymentIntent
        // e per la gestione del workflow di checkout/pagamento.
        private readonly PatientPaymentsService _patientPaymentsService;
        private readonly PaymentCheckoutWorkflowService _paymentCheckoutWorkflowService;

        /*
         * Inizializza il controller dei pagamenti del paziente
         * con i servizi applicativi necessari alle operazioni richieste.
         */
        public PatientPaymentsController(
            PatientPaymentsService patientPaymentsService,
            PaymentCheckoutWorkflowService paymentCheckoutWorkflowService)
        {
            _patientPaymentsService = patientPaymentsService
                ?? throw new ArgumentNullException(nameof(patientPaymentsService));
            _paymentCheckoutWorkflowService = paymentCheckoutWorkflowService
                ?? throw new ArgumentNullException(nameof(paymentCheckoutWorkflowService));
        }

        /*
         * Recupera i PaymentIntent del paziente autenticato,
         * filtrando opzionalmente per intervallo temporale espresso in UTC.
         */
        [HttpGet("intents")]
        public async Task<ActionResult<IReadOnlyList<PaymentIntentDto>>> GetMyPaymentIntents(
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

            var patientUserId = currentUserResult.Value;

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

            // Delega al service layer il recupero dei PaymentIntent
            // associati al paziente corrente.
            var result = await _patientPaymentsService
                .GetMyPaymentIntentsAsync(patientUserId, parsedFromUtc, parsedToUtc, cancellationToken)
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

            // Protezione difensiva contro un esito di successo privo di payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il recupero dei PaymentIntent."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea un nuovo PaymentIntent per uno specifico appuntamento
         * del paziente autenticato.
         */
        [HttpPost("appointments/{appointmentId:guid}/intent")]
        public async Task<ActionResult<PaymentIntentDto>> CreatePaymentIntentForAppointment(
            Guid appointmentId,
            [FromBody] CreatePaymentIntentForAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var patientUserId = currentUserResult.Value;

            // Delega al workflow di checkout la creazione del PaymentIntent
            // per l'appuntamento indicato.
            var result = await _paymentCheckoutWorkflowService
                .CreatePaymentIntentForAppointmentAsync(patientUserId, appointmentId, request, cancellationToken)
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
         * Elabora il pagamento relativo a un PaymentIntent esistente
         * del paziente autenticato.
         */
        [HttpPost("intents/{intentId:guid}/process")]
        public async Task<ActionResult<PaymentIntentDto>> ProcessPayment(
            Guid intentId,
            [FromBody] ProcessPaymentRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var patientUserId = currentUserResult.Value;

            // Delega al workflow di checkout l'elaborazione del pagamento
            // relativo al PaymentIntent indicato.
            var result = await _paymentCheckoutWorkflowService
                .ProcessPaymentAsync(patientUserId, intentId, request, cancellationToken)
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
        private (Guid Value, ActionResult? Result) GetCurrentUserId()
        {
            // Supporta sia il claim .NET NameIdentifier sia i claim JWT "sub",
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                              ?? User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                              ?? User.FindFirst("sub")?.Value;

            // Se il token non contiene alcun identificativo utente,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(userIdClaim))
            {
                return (Guid.Empty, Unauthorized(new
                {
                    code = "user_id_missing",
                    message = "Non è stato possibile determinare l'identità dell'utente corrente."
                }));
            }

            // Se il claim presente non è convertibile in Guid, la richiesta viene rifiutata.
            if (!Guid.TryParse(userIdClaim, out var userId))
            {
                return (Guid.Empty, Unauthorized(new
                {
                    code = "user_id_invalid",
                    message = "L'identificativo utente nel token non ha un formato valido."
                }));
            }

            return (userId, null);
        }
    }
}
