/*
 * File: services/core-service/src/CoreService.Api/Controllers/Scheduling/DelegateSchedulingController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Delegate per la consultazione
 * della disponibilità e la gestione degli appuntamenti dei pazienti deleganti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del delegato sul dominio Scheduling. Ogni operazione viene eseguita
 * solo dopo la verifica dell'esistenza di una delega attiva e del relativo
 * perimetro autorizzativo sul paziente indicato.
 *
 * Responsabilità principali
 * -------------------------
 * - Consultare la disponibilità per un paziente delegato.
 * - Recuperare gli appuntamenti di un paziente delegato.
 * - Prenotare, ripianificare e annullare appuntamenti per conto del paziente delegato.
 * - Verificare l'identità del delegato autenticato.
 * - Verificare la presenza di una delega attiva con scope compatibile.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientSchedulingService
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
using CoreService.Application.Registry.Services;
using CoreService.Application.Scheduling.Services;
using CoreService.Api.Controllers.Shared;
using CoreService.Domain.Registry;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Scheduling
{
    [ApiController]
    [Route("scheduling/delegates")]
    [Authorize(Roles = "Delegate")]
    public sealed class DelegateSchedulingController : ControllerBase
    {
        // Servizi applicativi usati per le operazioni di scheduling
        // eseguite dal delegato su pazienti per cui esiste una delega attiva.
        private readonly PatientSchedulingService _patientSchedulingService;
        private readonly DelegationAccessService _delegationAccessService;

        /*
         * Inizializza il controller di scheduling del delegato
         * con i servizi applicativi necessari alla verifica delle deleghe
         * e all'esecuzione delle operazioni di scheduling.
         */
        public DelegateSchedulingController(
            PatientSchedulingService patientSchedulingService,
            DelegationAccessService delegationAccessService)
        {
            _patientSchedulingService = patientSchedulingService
                ?? throw new ArgumentNullException(nameof(patientSchedulingService));
            _delegationAccessService = delegationAccessService
                ?? throw new ArgumentNullException(nameof(delegationAccessService));
        }

        /*
         * Recupera la disponibilità dei clinici per un paziente delegato,
         * previa verifica di una delega attiva con permesso di gestione appuntamenti.
         */
        [HttpGet("me/availability")]
        public async Task<ActionResult<IReadOnlyList<AvailabilitySlotDto>>> GetAvailabilityForDelegatedPatient(
            [FromQuery] Guid patientUserId,
            [FromQuery] Guid? clinicianUserId,
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

            // Verifica che esista una delega attiva che consenta la gestione degli appuntamenti
            // per il paziente indicato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(patientUserId, delegateUserId, DelegationScope.ManageAppointments, cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(delegationResult.StatusCode, new
                {
                    code = delegationResult.ErrorCode,
                    message = delegationResult.ErrorMessage
                });
            }

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

            // Delega al servizio di scheduling il recupero della disponibilità visibile.
            var result = await _patientSchedulingService
                .GetAvailabilityAsync(clinicianUserId, parsedFromUtc, parsedToUtc, cancellationToken)
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
         * Recupera gli appuntamenti di un paziente delegato,
         * previa verifica di una delega attiva almeno in sola lettura.
         */
        [HttpGet("me/appointments")]
        public async Task<ActionResult<IReadOnlyList<PatientAppointmentDto>>> GetAppointmentsForDelegatedPatient(
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

            // Per la sola consultazione degli appuntamenti è sufficiente
            // una delega attiva con scope ReadOnly.
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

            // Delega al servizio di scheduling il recupero degli appuntamenti del paziente delegato.
            var result = await _patientSchedulingService
                .GetMyAppointmentsAsync(patientUserId, parsedFromUtc, parsedToUtc, cancellationToken)
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
         * Prenota un nuovo appuntamento per un paziente delegato,
         * previa verifica di una delega attiva con permesso di gestione appuntamenti.
         */
        [HttpPost("me/appointments")]
        public async Task<ActionResult<PatientAppointmentDto>> BookAppointmentForDelegatedPatient(
            [FromQuery] Guid patientUserId,
            [FromBody] BookAppointmentRequest request,
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

            // Verifica che esista una delega attiva che consenta la gestione degli appuntamenti.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(patientUserId, delegateUserId, DelegationScope.ManageAppointments, cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(delegationResult.StatusCode, new
                {
                    code = delegationResult.ErrorCode,
                    message = delegationResult.ErrorMessage
                });
            }

            // Delega al servizio di scheduling la prenotazione dell'appuntamento
            // per conto del paziente delegato.
            var result = await _patientSchedulingService
                .BookAppointmentAsync(patientUserId, request, cancellationToken)
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
         * Ripianifica un appuntamento esistente di un paziente delegato,
         * previa verifica di una delega attiva con permesso di gestione appuntamenti.
         */
        [HttpPost("me/appointments/{appointmentId:guid}/reschedule")]
        public async Task<ActionResult<PatientAppointmentDto>> RescheduleAppointmentForDelegatedPatient(
            Guid appointmentId,
            [FromQuery] Guid patientUserId,
            [FromBody] RescheduleAppointmentRequest request,
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

            // Verifica che esista una delega attiva che consenta la gestione degli appuntamenti.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(patientUserId, delegateUserId, DelegationScope.ManageAppointments, cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(delegationResult.StatusCode, new
                {
                    code = delegationResult.ErrorCode,
                    message = delegationResult.ErrorMessage
                });
            }

            // Delega al servizio di scheduling la ripianificazione dell'appuntamento.
            var result = await _patientSchedulingService
                .RescheduleAppointmentAsync(patientUserId, appointmentId, request, cancellationToken)
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
         * Annulla un appuntamento esistente di un paziente delegato,
         * previa verifica di una delega attiva con permesso di gestione appuntamenti.
         */
        [HttpPost("me/appointments/{appointmentId:guid}/cancel")]
        public async Task<IActionResult> CancelAppointmentForDelegatedPatient(
            Guid appointmentId,
            [FromQuery] Guid patientUserId,
            [FromBody] CancelAppointmentRequest request,
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

            // Verifica che esista una delega attiva che consenta la gestione degli appuntamenti.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(patientUserId, delegateUserId, DelegationScope.ManageAppointments, cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(delegationResult.StatusCode, new
                {
                    code = delegationResult.ErrorCode,
                    message = delegationResult.ErrorMessage
                });
            }

            // Delega al servizio di scheduling l'annullamento dell'appuntamento.
            var result = await _patientSchedulingService
                .CancelAppointmentAsync(patientUserId, appointmentId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            return Ok();
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
