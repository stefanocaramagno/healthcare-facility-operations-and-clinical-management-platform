/*
 * File: services/core-service/src/CoreService.Api/Controllers/Events/DelegateNotificationsController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Delegate per la consultazione
 * e la gestione delle notifiche associate ai pazienti deleganti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del delegato sul dominio Events limitatamente alle notifiche.
 * Consente di recuperare l'elenco delle notifiche di un assistito selezionato,
 * leggerne il dettaglio e marcarle come lette.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare le notifiche di un paziente delegato.
 * - Recuperare una notifica specifica di un paziente delegato.
 * - Marcare come letta una notifica di un paziente delegato.
 * - Verificare l'identità del delegato autenticato.
 * - Validare la presenza del patientUserId richiesto.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - DelegateNotificationsService
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Delegate e non contiene logica di business:
 * ricava l'identità del delegato dal contesto autenticato e delega
 * tutte le regole applicative al servizio specializzato del layer Application.
 */

using System;
using System.Collections.Generic;
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
    [Route("notifications/delegates/me")]
    [Authorize(Roles = "Delegate")]
    public sealed class DelegateNotificationsController : ControllerBase
    {
        // Servizio applicativo incaricato del recupero e aggiornamento
        // delle notifiche accessibili al delegato per conto dei pazienti deleganti.
        private readonly DelegateNotificationsService _notificationsService;

        /*
         * Inizializza il controller delle notifiche del delegato
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public DelegateNotificationsController(DelegateNotificationsService notificationsService)
        {
            _notificationsService = notificationsService
                ?? throw new ArgumentNullException(nameof(notificationsService));
        }

        /*
         * Recupera l'elenco delle notifiche di un paziente delegato,
         * filtrando opzionalmente solo quelle non lette.
         */
        [HttpGet]
        public async Task<ActionResult<IReadOnlyList<NotificationDto>>> GetMyDelegatedNotifications(
            [FromQuery] Guid patientUserId,
            [FromQuery] bool onlyUnread = false,
            CancellationToken cancellationToken = default)
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

            // Delega al service layer il recupero delle notifiche
            // del paziente delegato selezionato.
            var result = await _notificationsService
                .GetNotificationsForDelegatedPatientAsync(
                    delegateUserId,
                    patientUserId,
                    onlyUnread,
                    cancellationToken)
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
         * al paziente delegato selezionato.
         */
        [HttpGet("{notificationId:guid}")]
        public async Task<ActionResult<NotificationDto>> GetDelegatedNotificationById(
            Guid notificationId,
            [FromQuery] Guid patientUserId,
            CancellationToken cancellationToken = default)
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

            // Delega al service layer il recupero della notifica specificata
            // per il paziente delegato selezionato.
            var result = await _notificationsService
                .GetNotificationByIdForDelegatedPatientAsync(
                    delegateUserId,
                    patientUserId,
                    notificationId,
                    cancellationToken)
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

            // Se la notifica non esiste oppure non appartiene all'assistito selezionato,
            // restituisce un 404 con payload esplicativo.
            if (result.Value is null)
            {
                return NotFound(new
                {
                    code = "notification_not_found",
                    message = "La notifica specificata non esiste oppure non appartiene all’assistito selezionato."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Marca come letta una specifica notifica appartenente
         * al paziente delegato selezionato.
         */
        [HttpPost("{notificationId:guid}/read")]
        public async Task<ActionResult> MarkDelegatedNotificationAsRead(
            Guid notificationId,
            [FromQuery] Guid patientUserId,
            CancellationToken cancellationToken = default)
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

            // Delega al service layer l'aggiornamento dello stato di lettura
            // della notifica selezionata.
            var result = await _notificationsService
                .MarkAsReadForDelegatedPatientAsync(
                    delegateUserId,
                    patientUserId,
                    notificationId,
                    cancellationToken)
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

            // Supporta sia il claim .NET NameIdentifier sia il claim "sub"
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
