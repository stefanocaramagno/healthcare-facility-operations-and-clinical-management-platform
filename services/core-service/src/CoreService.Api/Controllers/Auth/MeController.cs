/*
 * File: services/core-service/src/CoreService.Api/Controllers/Auth/MeController.cs
 *
 * Scopo
 * -----
 * Esporre l'endpoint HTTP che consente all'utente autenticato
 * di recuperare le informazioni essenziali del proprio profilo corrente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di accesso REST per la consultazione
 * del profilo dell'utente autenticato, utilizzando l'identità ricavata
 * dal token JWT già validato dal middleware di autenticazione.
 *
 * Responsabilità principali
 * -------------------------
 * - Verificare la presenza di un identificativo utente valido nei claim.
 * - Delegare al service layer il recupero del profilo corrente.
 * - Gestire correttamente gli esiti di successo, not found ed errore.
 * - Restituire una risposta HTTP coerente con il contratto dell'endpoint /me.
 *
 * Interazioni principali
 * ----------------------
 * - MeService
 * - ClaimsPrincipal / JWT claims
 * - DTO MeResponse
 *
 * Note
 * ----
 * Il controller non contiene logica di business sul profilo utente:
 * si limita a estrarre l'identità dal contesto autenticato
 * e a delegare il recupero dati al servizio applicativo.
 */

using System;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Auth.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Auth
{
    [ApiController]
    [Route("me")]
    public sealed class MeController : ControllerBase
    {
        // Servizio applicativo incaricato di recuperare i dati dell'utente corrente.
        private readonly MeService _meService;

        /*
         * Inizializza il controller con il servizio applicativo
         * usato per ottenere il profilo dell'utente autenticato.
         */
        public MeController(MeService meService)
        {
            _meService = meService
                ?? throw new ArgumentNullException(nameof(meService));
        }

        /*
         * Recupera il profilo essenziale dell'utente autenticato
         * a partire dall'identificativo presente nei claim del token JWT.
         */
        [HttpGet]
        [Authorize]
        [ProducesResponseType(typeof(MeResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        public async Task<IActionResult> Get(CancellationToken cancellationToken)
        {
            // Prova a ricavare l'identificativo dell'utente dai claim standard
            // supportando sia NameIdentifier sia il claim JWT "sub".
            var userIdClaim =
                User.FindFirstValue(ClaimTypes.NameIdentifier) ??
                User.FindFirstValue("sub");

            // Se il token non contiene un identificativo utente valido,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                return Unauthorized(new
                {
                    code = "invalid_token",
                    message = "Token JWT privo di identificativo utente valido."
                });
            }

            // Delega al service layer il recupero del profilo dell'utente corrente.
            var result = await _meService
                .GetCurrentUserAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            // Gestisce i diversi esiti di errore restituiti dal servizio applicativo.
            if (result.IsFailure)
            {
                if (result.IsNotFound)
                {
                    return NotFound();
                }

                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            // Protezione difensiva per il caso anomalo di successo senza payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il recupero del profilo."
                });
            }

            var user = result.Value;

            // Costruisce il DTO di risposta con le informazioni essenziali
            // del profilo dell'utente autenticato.
            var response = new MeResponse
            {
                Id = user.Id,
                Email = user.Email,
                Role = user.Role
            };

            return Ok(response);
        }
    }
}
