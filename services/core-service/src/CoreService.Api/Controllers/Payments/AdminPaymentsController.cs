/*
 * File: services/core-service/src/CoreService.Api/Controllers/Payments/AdminPaymentsController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint amministrativi per la consultazione e la gestione
 * dei PaymentIntent e delle relative transazioni del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del ruolo Admin sul dominio Payments. Consente di consultare gli intenti
 * di pagamento, ispezionare le transazioni associate e gestire operazioni
 * amministrative come registrazione pagamenti in presenza, riconciliazione
 * e simulazione dell'esito del provider.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'elenco dei PaymentIntent con filtri opzionali.
 * - Recuperare le transazioni associate a un PaymentIntent specifico.
 * - Registrare un pagamento in presenza per un appuntamento.
 * - Riconciliare un PaymentIntent esistente.
 * - Simulare l'esito del provider di pagamento.
 * - Validare i parametri temporali opzionali espressi in UTC con offset esplicito.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - AdminPaymentsService
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
using CoreService.Application.Payments.Services;
using CoreService.Api.Controllers.Shared;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Payments
{
    [ApiController]
    [Route("payments/admin")]
    [Authorize(Roles = "Admin")]
    public sealed class AdminPaymentsController : ControllerBase
    {
        // Servizio applicativo incaricato delle operazioni amministrative
        // sul dominio dei pagamenti.
        private readonly AdminPaymentsService _adminPaymentsService;

        /*
         * Inizializza il controller amministrativo dei pagamenti
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public AdminPaymentsController(AdminPaymentsService adminPaymentsService)
        {
            _adminPaymentsService = adminPaymentsService
                ?? throw new ArgumentNullException(nameof(adminPaymentsService));
        }

        /*
         * Recupera l'elenco dei PaymentIntent applicando opzionalmente
         * filtri temporali, di stato e di provider.
         */
        [HttpGet("intents")]
        public async Task<ActionResult<IReadOnlyList<AdminPaymentIntentDto>>> GetPaymentIntents(
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            [FromQuery] string? status,
            [FromQuery] string? provider,
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

            // Delega al service layer il recupero amministrativo dei PaymentIntent.
            var result = await _adminPaymentsService
                .GetPaymentIntentsAsync(parsedFromUtc, parsedToUtc, status, provider, cancellationToken)
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
         * Recupera tutte le transazioni associate a uno specifico PaymentIntent.
         */
        [HttpGet("intents/{intentId:guid}/transactions")]
        public async Task<ActionResult<IReadOnlyList<PaymentTransactionDto>>> GetTransactionsForIntent(
            Guid intentId,
            CancellationToken cancellationToken)
        {
            // Delega al service layer il recupero delle transazioni
            // appartenenti al PaymentIntent richiesto.
            var result = await _adminPaymentsService
                .GetTransactionsForIntentAsync(intentId, cancellationToken)
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
         * Registra un pagamento effettuato in presenza per uno specifico appuntamento.
         */
        [HttpPost("appointments/{appointmentId:guid}/in-person")]
        public async Task<ActionResult<PaymentIntentDto>> RegisterInPersonPayment(
            Guid appointmentId,
            [FromBody] RegisterInPersonPaymentRequest? request,
            CancellationToken cancellationToken)
        {
            // Delega al service layer la registrazione del pagamento in presenza
            // associato all'appuntamento indicato.
            var result = await _adminPaymentsService
                .RegisterInPersonPaymentAsync(appointmentId, request, cancellationToken)
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
         * Esegue la riconciliazione amministrativa di uno specifico PaymentIntent.
         */
        [HttpPost("intents/{intentId:guid}/reconcile")]
        public async Task<ActionResult<PaymentIntentDto>> ReconcilePayment(
            Guid intentId,
            [FromBody] ReconcilePaymentRequest? request,
            CancellationToken cancellationToken)
        {
            // Delega al service layer la riconciliazione del PaymentIntent richiesto.
            var result = await _adminPaymentsService
                .ReconcilePaymentAsync(intentId, request, cancellationToken)
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
         * Simula l'esito del provider di pagamento per uno specifico PaymentIntent,
         * utile in contesti di test o demo amministrativa.
         */
        [HttpPost("intents/{intentId:guid}/simulate-provider-outcome")]
        public async Task<ActionResult<PaymentIntentDto>> SimulateProviderOutcome(
            Guid intentId,
            [FromBody] SimulateProviderOutcomeRequest? request,
            CancellationToken cancellationToken)
        {
            // Delega al service layer la simulazione dell'esito provider
            // per il PaymentIntent richiesto.
            var result = await _adminPaymentsService
                .SimulateProviderOutcomeAsync(intentId, request, cancellationToken)
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
    }
}
