/*
 * File: services/core-service/src/CoreService.Api/Controllers/Clinical/PatientPreTriageController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Patient per la consultazione
 * e la compilazione del questionario di pre-triage associato a un appuntamento.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * self-service del paziente sul dominio Clinical limitatamente al pre-triage.
 * Tutte le operazioni sono vincolate all'utente autenticato ricavato dal token JWT.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare il questionario di pre-triage di uno specifico appuntamento.
 * - Creare o aggiornare il questionario di pre-triage di uno specifico appuntamento.
 * - Ricavare in modo affidabile l'identità del paziente dal contesto autenticato.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientPreTriageService
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Patient e non contiene logica di business:
 * delega tutte le regole applicative al servizio specializzato del layer Application.
 */

using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Clinical.Services;
using CoreService.Application.Contracts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Clinical
{
    [ApiController]
    [Route("clinical/patients/me/pretriage")]
    [Authorize(Roles = "Patient")]
    public sealed class PatientPreTriageController : ControllerBase
    {
        // Servizio applicativo incaricato della gestione del pre-triage
        // del paziente autenticato.
        private readonly PatientPreTriageService _patientPreTriageService;

        /*
         * Inizializza il controller di pre-triage del paziente
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public PatientPreTriageController(PatientPreTriageService patientPreTriageService)
        {
            _patientPreTriageService = patientPreTriageService
                ?? throw new ArgumentNullException(nameof(patientPreTriageService));
        }

        /*
         * Recupera il questionario di pre-triage associato a uno specifico appuntamento
         * del paziente autenticato.
         */
        [HttpGet("appointments/{appointmentId:guid}")]
        public async Task<IActionResult> GetForAppointment(
            Guid appointmentId,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var (userId, errorResult) = TryGetCurrentUserId();
            if (errorResult != null)
            {
                return errorResult;
            }

            // Delega al service layer il recupero del questionario di pre-triage
            // relativo all'appuntamento richiesto.
            var result = await _patientPreTriageService
                .GetForAppointmentAsync(userId, appointmentId, cancellationToken)
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
         * Crea o aggiorna il questionario di pre-triage associato
         * a uno specifico appuntamento del paziente autenticato.
         */
        [HttpPut("appointments/{appointmentId:guid}")]
        public async Task<IActionResult> UpsertForAppointment(
            Guid appointmentId,
            [FromBody] UpsertPreTriageQuestionnaireRequest request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var (userId, errorResult) = TryGetCurrentUserId();
            if (errorResult != null)
            {
                return errorResult;
            }

            // Delega al service layer il salvataggio del questionario di pre-triage
            // relativo all'appuntamento richiesto.
            var result = await _patientPreTriageService
                .UpsertForAppointmentAsync(userId, appointmentId, request, cancellationToken)
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
         * e restituisce un IActionResult di errore se il contesto autenticato non è valido.
         */
        private (Guid userId, IActionResult? errorResult) TryGetCurrentUserId()
        {
            // Supporta sia il claim .NET NameIdentifier sia i claim JWT "sub",
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var subClaim =
                User.FindFirst(ClaimTypes.NameIdentifier)?.Value ??
                User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ??
                User.FindFirst("sub")?.Value;

            // Se il token non contiene un identificativo utente valido,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(subClaim) || !Guid.TryParse(subClaim, out var userId))
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
