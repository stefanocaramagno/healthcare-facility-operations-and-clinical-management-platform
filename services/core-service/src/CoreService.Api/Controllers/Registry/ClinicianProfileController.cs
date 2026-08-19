/*
 * File: services/core-service/src/CoreService.Api/Controllers/Registry/ClinicianProfileController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Clinician per la consultazione
 * e l'aggiornamento del proprio profilo.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * self-service del clinico autenticato sul dominio Registry.
 * Tutte le operazioni sono limitate all'utente corrente ricavato dal token JWT.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare il profilo del clinico autenticato.
 * - Aggiornare il profilo del clinico autenticato.
 * - Ricavare in modo affidabile l'identità dell'utente corrente dal contesto autenticato.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - ClinicianProfileService
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller non contiene logica di business del dominio:
 * ricava l'identità del clinico dal contesto autenticato e delega
 * tutte le regole applicative al servizio specializzato.
 */

using System;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Registry.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Registry
{
    [ApiController]
    [Route("registry/clinicians")]
    [Authorize(Roles = "Clinician")]
    public sealed class ClinicianProfileController : ControllerBase
    {
        // Servizio applicativo incaricato della gestione del profilo del clinico autenticato.
        private readonly ClinicianProfileService _clinicianProfileService;

        /*
         * Inizializza il controller del profilo clinico con il servizio applicativo
         * usato per le operazioni self-service del ruolo Clinician.
         */
        public ClinicianProfileController(ClinicianProfileService clinicianProfileService)
        {
            _clinicianProfileService = clinicianProfileService
                ?? throw new ArgumentNullException(nameof(clinicianProfileService));
        }

        /*
         * Recupera il profilo del clinico autenticato.
         */
        [HttpGet("me/profile")]
        public async Task<IActionResult> Get(CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var userIdResult = GetCurrentUserId();
            if (userIdResult.Result is not null)
            {
                return userIdResult.Result;
            }

            var userId = userIdResult.Value;

            // Delega al servizio profilo il recupero del profilo del clinico corrente.
            var result = await _clinicianProfileService
                .GetMyProfileAsync(userId, cancellationToken)
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
                    message = "Si è verificato un errore inatteso durante il recupero del profilo clinico."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea o aggiorna il profilo del clinico autenticato.
         */
        [HttpPut("me/profile")]
        public async Task<IActionResult> Upsert(
            [FromBody] UpsertClinicianProfileRequest request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var userIdResult = GetCurrentUserId();
            if (userIdResult.Result is not null)
            {
                return userIdResult.Result;
            }

            var userId = userIdResult.Value;

            // Delega al servizio profilo il salvataggio del profilo del clinico corrente.
            var result = await _clinicianProfileService
                .UpsertMyProfileAsync(userId, request, cancellationToken)
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
                    message = "Si è verificato un errore inatteso durante il salvataggio del profilo clinico."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Ricava l'identificativo Guid dell'utente corrente dal token JWT
         * e restituisce una ActionResult di errore se il token non è valido.
         */
        private (Guid Value, ActionResult? Result) GetCurrentUserId()
        {
            // Supporta sia il claim NameIdentifier sia il claim JWT "sub"
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var userIdClaim =
                User.FindFirstValue(ClaimTypes.NameIdentifier) ??
                User.FindFirstValue("sub");

            // Se il token non contiene un identificativo utente valido,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(userIdClaim) ||
                !Guid.TryParse(userIdClaim, out var userId))
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
