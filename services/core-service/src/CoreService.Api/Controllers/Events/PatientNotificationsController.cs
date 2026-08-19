/*
 * File: services/core-service/src/CoreService.Api/Controllers/Events/PatientNotificationsController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Patient per la consultazione
 * e la gestione delle proprie notifiche.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * self-service del paziente sul dominio Events limitatamente alle notifiche.
 * Consente di recuperare l'elenco delle notifiche, leggere il dettaglio
 * di una notifica specifica e marcarla come letta.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare le notifiche del paziente autenticato.
 * - Recuperare una notifica specifica del paziente autenticato.
 * - Marcare come letta una notifica del paziente autenticato.
 * - Ricavare in modo affidabile l'identità del paziente dal contesto autenticato.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientNotificationsService
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Patient e non contiene logica di business:
 * delega tutte le regole applicative al servizio specializzato del layer Application.
 */

using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Events.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Events
{
    [ApiController]
    [Route("notifications/patients/me")]
    [Authorize(Roles = "Patient")]
    public sealed class PatientNotificationsController : ControllerBase
    {
        // Servizio applicativo incaricato del recupero e aggiornamento
        // delle notifiche del paziente autenticato.
        private readonly PatientNotificationsService _notificationsService;

        /*
         * Inizializza il controller delle notifiche del paziente
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public PatientNotificationsController(PatientNotificationsService notificationsService)
        {
            _notificationsService = notificationsService
                ?? throw new ArgumentNullException(nameof(notificationsService));
        }

        /*
         * Recupera l'elenco delle notifiche del paziente autenticato,
         * filtrando opzionalmente solo quelle non lette.
         */
        [HttpGet]
        public async Task<ActionResult<IReadOnlyList<NotificationDto>>> GetMyNotifications(
            [FromQuery] bool onlyUnread = false,
            CancellationToken cancellationToken = default)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var currentUserId = currentUserResult.Value;

            // Delega al service layer il recupero delle notifiche
            // appartenenti all'utente corrente.
            var result = await _notificationsService
                .GetMyNotificationsAsync(currentUserId, onlyUnread, cancellationToken)
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

            // Se il servizio non restituisce notifiche esplicite,
            // il controller preferisce una collezione vuota invece di un valore nullo.
            var dtos = result.Value ?? Array.Empty<NotificationDto>();

            return Ok(dtos);
        }

        /*
         * Recupera il dettaglio di una specifica notifica appartenente
         * al paziente autenticato.
         */
        [HttpGet("{notificationId:guid}")]
        public async Task<ActionResult<NotificationDto>> GetMyNotificationById(
            Guid notificationId,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var currentUserId = currentUserResult.Value;

            // Delega al service layer il recupero della notifica specificata.
            var result = await _notificationsService
                .GetMyNotificationByIdAsync(currentUserId, notificationId, cancellationToken)
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

            // Se la notifica non esiste oppure non appartiene all'utente corrente,
            // restituisce un 404 con payload esplicativo.
            if (result.Value is null)
            {
                return NotFound(new
                {
                    code = "notification_not_found",
                    message = "La notifica specificata non esiste oppure non appartiene all'utente corrente."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Marca come letta una specifica notifica appartenente
         * al paziente autenticato.
         */
        [HttpPost("{notificationId:guid}/read")]
        public async Task<ActionResult> MarkAsRead(
            Guid notificationId,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var currentUserId = currentUserResult.Value;

            // Delega al service layer l'aggiornamento dello stato di lettura
            // della notifica specificata.
            var result = await _notificationsService
                .MarkAsReadAsync(currentUserId, notificationId, cancellationToken)
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

            return NoContent();
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

            // Se il token non contiene un identificativo utente valido,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
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
