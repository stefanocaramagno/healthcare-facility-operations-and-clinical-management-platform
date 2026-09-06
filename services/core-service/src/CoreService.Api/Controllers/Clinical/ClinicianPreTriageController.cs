/*
 * File: services/core-service/src/CoreService.Api/Controllers/Clinical/ClinicianPreTriageController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Clinician per la consultazione
 * del questionario di pre-triage associato agli appuntamenti di propria competenza.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del clinico sul dominio Clinical limitatamente al pre-triage.
 * Tutte le operazioni sono vincolate all'identità del clinico autenticato
 * ricavata dal token JWT.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare il questionario di pre-triage di uno specifico appuntamento.
 * - Ricavare in modo affidabile l'identità del clinico dal contesto autenticato.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - ClinicianPreTriageService
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Clinician e non contiene logica di business:
 * delega tutte le regole applicative al servizio specializzato del layer Application.
 */

using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Clinical.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Clinical
{
    [ApiController]
    [Route("clinical/clinicians/me/pretriage")]
    [Authorize(Roles = "Clinician")]
    public sealed class ClinicianPreTriageController : ControllerBase
    {
        // Servizio applicativo incaricato del recupero del pre-triage
        // per gli appuntamenti accessibili al clinico autenticato.
        private readonly ClinicianPreTriageService _clinicianPreTriageService;

        /*
         * Inizializza il controller del pre-triage del clinico
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public ClinicianPreTriageController(ClinicianPreTriageService clinicianPreTriageService)
        {
            _clinicianPreTriageService = clinicianPreTriageService
                ?? throw new ArgumentNullException(nameof(clinicianPreTriageService));
        }

        /*
         * Recupera il questionario di pre-triage associato a uno specifico appuntamento
         * del clinico autenticato.
         */
        [HttpGet("appointments/{appointmentId:guid}")]
        public async Task<ActionResult<PreTriageQuestionnaireDto>> GetPreTriageForAppointment(
            Guid appointmentId,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var (clinicianUserId, errorResult) = GetCurrentUserId();
            if (errorResult is not null)
            {
                return errorResult;
            }

            // Delega al service layer il recupero del questionario di pre-triage
            // relativo all'appuntamento richiesto.
            var result = await _clinicianPreTriageService
                .GetPreTriageForAppointmentAsync(clinicianUserId, appointmentId, cancellationToken)
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
            if (string.IsNullOrWhiteSpace(userIdClaim) ||
                !Guid.TryParse(userIdClaim, out var userId))
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
