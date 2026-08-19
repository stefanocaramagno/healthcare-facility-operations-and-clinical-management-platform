/*
 * File: services/core-service/src/CoreService.Api/Controllers/Registry/DelegateDelegationsController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Delegate per la consultazione
 * delle deleghe associate all'utente autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * self-service del delegato sul dominio delle deleghe.
 * Tutte le operazioni sono limitate all'utente corrente ricavato dal token JWT.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'elenco delle deleghe associate al delegato autenticato.
 * - Ricavare in modo affidabile l'identità dell'utente corrente dal contesto autenticato.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - DelegationAccessService
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller non contiene logica di business sulle deleghe:
 * ricava l'identità del delegato dal contesto autenticato e delega
 * il recupero dei dati al servizio applicativo specializzato.
 */

using System;
using System.Collections.Generic;
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
    [Route("registry/delegates")]
    [Authorize(Roles = "Delegate")]
    public sealed class DelegateDelegationsController : ControllerBase
    {
        // Servizio applicativo incaricato del recupero delle deleghe
        // visibili al delegato autenticato.
        private readonly DelegationAccessService _delegationAccessService;

        /*
         * Inizializza il controller delle deleghe del delegato
         * con il servizio applicativo necessario al recupero dei dati.
         */
        public DelegateDelegationsController(DelegationAccessService delegationAccessService)
        {
            _delegationAccessService = delegationAccessService
                ?? throw new ArgumentNullException(nameof(delegationAccessService));
        }

        /*
         * Recupera tutte le deleghe associate al delegato autenticato.
         */
        [HttpGet("me/delegations")]
        public async Task<IActionResult> GetMyDelegations(CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del delegato dal contesto autenticato.
            var userIdResult = GetCurrentUserId();
            if (userIdResult.Result is not null)
            {
                return userIdResult.Result;
            }

            var delegateUserId = userIdResult.Value;

            // Delega al servizio applicativo il recupero delle deleghe
            // appartenenti al delegato corrente.
            var result = await _delegationAccessService
                .GetDelegationsForDelegateAsync(delegateUserId, cancellationToken)
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
                    message = "Si è verificato un errore inatteso durante il recupero delle deleghe del delegato."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Ricava l'identificativo Guid dell'utente corrente dal contesto autenticato
         * e restituisce una ActionResult di errore se l'utente non è autenticato
         * oppure se il token non contiene un identificativo valido.
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

            // Supporta sia il claim NameIdentifier sia il claim JWT "sub"
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var userIdClaim =
                user.FindFirstValue(ClaimTypes.NameIdentifier) ??
                user.FindFirstValue("sub");

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
