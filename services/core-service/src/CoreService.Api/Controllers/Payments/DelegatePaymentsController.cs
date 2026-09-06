/*
 * File: services/core-service/src/CoreService.Api/Controllers/Payments/DelegatePaymentsController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Delegate per la consultazione
 * e la gestione dei pagamenti associati ai pazienti deleganti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del delegato sul dominio Payments. Ogni operazione viene eseguita
 * solo dopo la verifica dell'esistenza di una delega attiva
 * e del relativo perimetro autorizzativo sul paziente indicato.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare i PaymentIntent di un paziente delegato.
 * - Creare un PaymentIntent per un appuntamento di un paziente delegato.
 * - Elaborare un pagamento per conto di un paziente delegato.
 * - Verificare l'identità del delegato autenticato.
 * - Verificare la presenza di una delega attiva con scope compatibile.
 * - Validare i parametri temporali opzionali espressi in UTC con offset esplicito.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientPaymentsService
 * - PaymentCheckoutWorkflowService
 * - DelegationAccessService
 * - UtcQueryTimeParser
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller non contiene logica di business del dominio:
 * ricava l'identità del delegato dal contesto autenticato,
 * verifica il perimetro di delega e delega tutte le operazioni
 * ai servizi applicativi specializzati.
 */

using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Payments.Services;
using CoreService.Application.Registry.Services;
using CoreService.Api.Controllers.Shared;
using CoreService.Domain.Registry;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Payments
{
    [ApiController]
    [Route("payments/delegates")]
    [Authorize(Roles = "Delegate")]
    public sealed class DelegatePaymentsController : ControllerBase
    {
        // Servizi applicativi usati per accedere ai PaymentIntent del paziente delegato,
        // gestire il workflow di pagamento e verificare la validità della delega associata.
        private readonly PatientPaymentsService _patientPaymentsService;
        private readonly PaymentCheckoutWorkflowService _paymentCheckoutWorkflowService;
        private readonly DelegationAccessService _delegationAccessService;

        /*
         * Inizializza il controller dei pagamenti del delegato
         * con i servizi applicativi necessari al controllo deleghe
         * e alla gestione del workflow di pagamento.
         */
        public DelegatePaymentsController(
            PatientPaymentsService patientPaymentsService,
            PaymentCheckoutWorkflowService paymentCheckoutWorkflowService,
            DelegationAccessService delegationAccessService)
        {
            _patientPaymentsService = patientPaymentsService
                ?? throw new ArgumentNullException(nameof(patientPaymentsService));
            _paymentCheckoutWorkflowService = paymentCheckoutWorkflowService
                ?? throw new ArgumentNullException(nameof(paymentCheckoutWorkflowService));
            _delegationAccessService = delegationAccessService
                ?? throw new ArgumentNullException(nameof(delegationAccessService));
        }

        /*
         * Recupera i PaymentIntent di un paziente delegato,
         * previa verifica di una delega attiva almeno in sola lettura.
         */
        [HttpGet("me/intents")]
        public async Task<ActionResult<IReadOnlyList<PaymentIntentDto>>> GetPaymentIntentsForDelegatedPatient(
            [FromQuery] Guid patientUserId,
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del delegato dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            // Il paziente delegato deve essere sempre esplicitato nella richiesta.
            if (patientUserId == Guid.Empty)
            {
                return BadRequest(new
                {
                    code = "invalid_patient_id",
                    message = "Il parametro patientUserId è obbligatorio."
                });
            }

            var delegateUserId = currentUserResult.Value;

            // Verifica che esista una delega attiva che consenta almeno la lettura
            // delle informazioni di pagamento del paziente delegato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(patientUserId, delegateUserId, DelegationScope.ReadOnly, cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(delegationResult.StatusCode, new
                {
                    code = delegationResult.ErrorCode,
                    message = delegationResult.ErrorMessage
                });
            }

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
            // relativi al paziente delegato.
            var result = await _patientPaymentsService
                .GetMyPaymentIntentsAsync(patientUserId, parsedFromUtc, parsedToUtc, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea un nuovo PaymentIntent per un appuntamento di un paziente delegato,
         * previa verifica di una delega attiva con permesso di gestione pagamenti.
         */
        [HttpPost("me/appointments/{appointmentId:guid}/intent")]
        public async Task<ActionResult<PaymentIntentDto>> CreatePaymentIntentForDelegatedPatientAppointment(
            Guid appointmentId,
            [FromQuery] Guid patientUserId,
            [FromBody] CreatePaymentIntentForAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del delegato dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            // Il paziente delegato deve essere sempre esplicitato nella richiesta.
            if (patientUserId == Guid.Empty)
            {
                return BadRequest(new
                {
                    code = "invalid_patient_id",
                    message = "Il parametro patientUserId è obbligatorio."
                });
            }

            var delegateUserId = currentUserResult.Value;

            // Verifica che esista una delega attiva che consenta la gestione dei pagamenti
            // per il paziente indicato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(patientUserId, delegateUserId, DelegationScope.ManagePayments, cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(delegationResult.StatusCode, new
                {
                    code = delegationResult.ErrorCode,
                    message = delegationResult.ErrorMessage
                });
            }

            // Delega al workflow di checkout la creazione del PaymentIntent
            // per l'appuntamento del paziente delegato.
            var result = await _paymentCheckoutWorkflowService
                .CreatePaymentIntentForAppointmentAsync(patientUserId, appointmentId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            return Ok(result.Value);
        }

        /*
         * Elabora il pagamento relativo a un PaymentIntent di un paziente delegato,
         * previa verifica di una delega attiva con permesso di gestione pagamenti.
         */
        [HttpPost("me/intents/{intentId:guid}/process")]
        public async Task<ActionResult<PaymentIntentDto>> ProcessPaymentForDelegatedPatient(
            Guid intentId,
            [FromQuery] Guid patientUserId,
            [FromBody] ProcessPaymentRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del delegato dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            // Il paziente delegato deve essere sempre esplicitato nella richiesta.
            if (patientUserId == Guid.Empty)
            {
                return BadRequest(new
                {
                    code = "invalid_patient_id",
                    message = "Il parametro patientUserId è obbligatorio."
                });
            }

            var delegateUserId = currentUserResult.Value;

            // Verifica che esista una delega attiva che consenta la gestione dei pagamenti
            // per il paziente indicato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(patientUserId, delegateUserId, DelegationScope.ManagePayments, cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(delegationResult.StatusCode, new
                {
                    code = delegationResult.ErrorCode,
                    message = delegationResult.ErrorMessage
                });
            }

            // Delega al workflow di checkout l'elaborazione del pagamento
            // relativo al PaymentIntent del paziente delegato.
            var result = await _paymentCheckoutWorkflowService
                .ProcessPaymentAsync(patientUserId, intentId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            return Ok(result.Value);
        }

        /*
         * Ricava l'identificativo Guid del delegato corrente dal contesto autenticato
         * e restituisce una ActionResult di errore se il token non è valido.
         */
        private (Guid Value, ActionResult? Result) GetCurrentUserId()
        {
            var user = HttpContext.User;

            // Verifica che l'utente sia effettivamente autenticato.
            if (user?.Identity is not { IsAuthenticated: true })
            {
                return (Guid.Empty, Unauthorized(new
                {
                    code = "unauthorized",
                    message = "Utente non autenticato."
                }));
            }

            // Supporta sia NameIdentifier sia i claim JWT "sub"
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var subject =
                user.FindFirstValue(ClaimTypes.NameIdentifier) ??
                user.FindFirstValue(JwtRegisteredClaimNames.Sub) ??
                user.FindFirstValue("sub");

            // Se il token non contiene un identificativo utente valido,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(subject) || !Guid.TryParse(subject, out var userId))
            {
                return (Guid.Empty, Unauthorized(new
                {
                    code = "invalid_token",
                    message = "Token JWT privo di identificativo utente valido."
                }));
            }

            return (userId, null);
        }
    }
}
