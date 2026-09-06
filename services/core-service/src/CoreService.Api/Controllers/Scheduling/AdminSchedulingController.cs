/*
 * File: services/core-service/src/CoreService.Api/Controllers/Scheduling/AdminSchedulingController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint amministrativi relativi alla consultazione e gestione
 * di disponibilità, slot, agenda clinica e appuntamenti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del ruolo Admin sul dominio Scheduling. Consente all'amministrazione
 * di governare disponibilità dei clinici, prenotazioni e transizioni
 * di stato degli appuntamenti.
 *
 * Responsabilità principali
 * -------------------------
 * - Consultare disponibilità e slot dei clinici.
 * - Creare slot di disponibilità e aggiornarne lo stato.
 * - Consultare agenda clinica e appuntamenti amministrativi.
 * - Prenotare, annullare, ripianificare e gestire il check-in degli appuntamenti.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - AdminSchedulingService
 * - UtcQueryTimeParser
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Admin e non contiene logica di business:
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
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Scheduling
{
    [ApiController]
    [Route("scheduling/admin")]
    [Authorize(Roles = "Admin")]
    public sealed class AdminSchedulingController : ControllerBase
    {
        // Servizio applicativo incaricato di tutte le operazioni amministrative
        // sul dominio Scheduling.
        private readonly AdminSchedulingService _adminSchedulingService;

        /*
         * Inizializza il controller amministrativo del dominio Scheduling
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public AdminSchedulingController(AdminSchedulingService adminSchedulingService)
        {
            _adminSchedulingService = adminSchedulingService
                ?? throw new ArgumentNullException(nameof(adminSchedulingService));
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

            // Delega al service layer il recupero della disponibilità amministrativa.
            var result = await _adminSchedulingService
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
         * Recupera gli slot di un clinico specifico filtrando opzionalmente
         * per intervallo temporale e stato dello slot.
         */
        [HttpGet("clinicians/{clinicianUserId:guid}/slots")]
        public async Task<ActionResult<IReadOnlyList<AdminSlotDto>>> GetClinicianSlots(
            Guid clinicianUserId,
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            [FromQuery] string? status,
            CancellationToken cancellationToken)
        {
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

            // Delega al service layer il recupero degli slot del clinico.
            var result = await _adminSchedulingService
                .GetClinicianSlotsAsync(clinicianUserId, parsedFromUtc, parsedToUtc, status, cancellationToken)
                .ConfigureAwait(false);

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
         * Crea nuovi slot di disponibilità per un clinico specifico,
         * associando l'operazione all'amministratore autenticato.
         */
        [HttpPost("clinicians/{clinicianUserId:guid}/slots")]
        public async Task<ActionResult<IReadOnlyList<AdminSlotDto>>> CreateSlotsForClinician(
            Guid clinicianUserId,
            [FromBody] CreateAvailabilitySlotsRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo dell'amministratore dal contesto autenticato.
            var adminIdResult = GetCurrentUserId();
            if (adminIdResult.Result is not null)
            {
                return adminIdResult.Result;
            }

            var adminUserId = adminIdResult.Value;

            // Delega al service layer la creazione degli slot del clinico.
            var result = await _adminSchedulingService
                .CreateSlotsForClinicianAsync(adminUserId, clinicianUserId, request, cancellationToken)
                .ConfigureAwait(false);

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
         * Aggiorna lo stato amministrativo di uno slot esistente,
         * associando l'operazione all'amministratore autenticato.
         */
        [HttpPost("slots/{slotId:guid}/status")]
        public async Task<ActionResult<AdminSlotDto>> UpdateSlotStatus(
            Guid slotId,
            [FromBody] UpdateSlotStatusRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo dell'amministratore dal contesto autenticato.
            var adminIdResult = GetCurrentUserId();
            if (adminIdResult.Result is not null)
            {
                return adminIdResult.Result;
            }

            var adminUserId = adminIdResult.Value;

            // Delega al service layer l'aggiornamento dello stato dello slot.
            var result = await _adminSchedulingService
                .UpdateSlotStatusAsync(adminUserId, slotId, request, cancellationToken)
                .ConfigureAwait(false);

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
         * Recupera l'agenda degli appuntamenti di un clinico specifico
         * in un intervallo temporale opzionale espresso in UTC.
         */
        [HttpGet("clinicians/{clinicianUserId:guid}/appointments")]
        public async Task<ActionResult<IReadOnlyList<ClinicianAgendaItemDto>>> GetClinicianAgenda(
            Guid clinicianUserId,
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
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

            // Delega al service layer il recupero dell'agenda clinica.
            var result = await _adminSchedulingService
                .GetClinicianAgendaAsync(clinicianUserId, parsedFromUtc, parsedToUtc, cancellationToken)
                .ConfigureAwait(false);

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
         * Recupera l'elenco degli appuntamenti amministrativi
         * filtrando opzionalmente per intervallo temporale espresso in UTC.
         */
        [HttpGet("appointments")]
        public async Task<ActionResult<IReadOnlyList<ClinicianAgendaItemDto>>> GetAppointments(
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
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

            // Delega al service layer il recupero degli appuntamenti amministrativi.
            var result = await _adminSchedulingService
                .GetAppointmentsAsync(parsedFromUtc, parsedToUtc, cancellationToken)
                .ConfigureAwait(false);

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
         * Prenota un appuntamento per un paziente su iniziativa dell'amministratore autenticato.
         */
        [HttpPost("appointments")]
        public async Task<ActionResult<PatientAppointmentDto>> BookAppointmentForPatient(
            [FromBody] AdminBookAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo dell'amministratore dal contesto autenticato.
            var adminIdResult = GetCurrentUserId();
            if (adminIdResult.Result is not null)
            {
                return adminIdResult.Result;
            }

            var adminUserId = adminIdResult.Value;

            // Delega al service layer la prenotazione dell'appuntamento.
            var result = await _adminSchedulingService
                .BookAppointmentForPatientAsync(adminUserId, request, cancellationToken)
                .ConfigureAwait(false);

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
         * Annulla un appuntamento esistente per conto dell'amministratore autenticato.
         */
        [HttpPost("appointments/{appointmentId:guid}/cancel")]
        public async Task<ActionResult<PatientAppointmentDto>> CancelAppointment(
            Guid appointmentId,
            [FromBody] CancelAppointmentRequest request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo dell'amministratore dal contesto autenticato.
            var adminIdResult = GetCurrentUserId();
            if (adminIdResult.Result is not null)
            {
                return adminIdResult.Result;
            }

            var adminUserId = adminIdResult.Value;

            // Delega al service layer l'annullamento dell'appuntamento.
            var result = await _adminSchedulingService
                .CancelAppointmentAsync(adminUserId, appointmentId, request, cancellationToken)
                .ConfigureAwait(false);

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
         * Ripianifica un appuntamento esistente per conto dell'amministratore autenticato.
         */
        [HttpPost("appointments/{appointmentId:guid}/reschedule")]
        public async Task<ActionResult<PatientAppointmentDto>> RescheduleAppointment(
            Guid appointmentId,
            [FromBody] RescheduleAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo dell'amministratore dal contesto autenticato.
            var adminIdResult = GetCurrentUserId();
            if (adminIdResult.Result is not null)
            {
                return adminIdResult.Result;
            }

            var adminUserId = adminIdResult.Value;

            // Delega al service layer la ripianificazione dell'appuntamento.
            var result = await _adminSchedulingService
                .RescheduleAppointmentAsync(adminUserId, appointmentId, request, cancellationToken)
                .ConfigureAwait(false);

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
         * Registra il check-in di un appuntamento esistente
         * per conto dell'amministratore autenticato.
         */
        [HttpPost("appointments/{appointmentId:guid}/check-in")]
        public async Task<ActionResult<PatientAppointmentDto>> CheckInAppointment(
            Guid appointmentId,
            [FromBody] CheckInAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo dell'amministratore dal contesto autenticato.
            var adminIdResult = GetCurrentUserId();
            if (adminIdResult.Result is not null)
            {
                return adminIdResult.Result;
            }

            var adminUserId = adminIdResult.Value;

            // Delega al service layer la registrazione del check-in.
            var result = await _adminSchedulingService
                .CheckInAppointmentAsync(adminUserId, appointmentId, request, cancellationToken)
                .ConfigureAwait(false);

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
         * Registra lo stato di no-show di un appuntamento esistente
         * per conto dell'amministratore autenticato.
         */
        [HttpPost("appointments/{appointmentId:guid}/no-show")]
        public async Task<ActionResult<PatientAppointmentDto>> MarkNoShowAppointment(
            Guid appointmentId,
            [FromBody] MarkNoShowAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo dell'amministratore dal contesto autenticato.
            var adminIdResult = GetCurrentUserId();
            if (adminIdResult.Result is not null)
            {
                return adminIdResult.Result;
            }

            var adminUserId = adminIdResult.Value;

            // Delega al service layer la marcatura dell'appuntamento come no-show.
            var result = await _adminSchedulingService
                .MarkNoShowAppointmentAsync(adminUserId, appointmentId, request, cancellationToken)
                .ConfigureAwait(false);

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
         * Ricava l'identificativo Guid dell'amministratore corrente dal token JWT
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
