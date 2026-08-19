/*
 * File: services/core-service/src/CoreService.Api/Controllers/Events/AdminNotificationsController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint amministrativi per la consultazione e la creazione
 * delle notifiche applicative del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del ruolo Admin sul dominio Events limitatamente alle notifiche.
 * Consente di consultare l'elenco delle notifiche, recuperare il dettaglio
 * di una notifica specifica e crearne di nuove.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'elenco delle notifiche con filtri opzionali.
 * - Recuperare il dettaglio di una notifica specifica.
 * - Creare una nuova notifica applicativa.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - AdminNotificationsService
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
using CoreService.Application.Events.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Events
{
    [ApiController]
    [Route("notifications/admin")]
    [Authorize(Roles = "Admin")]
    public sealed class AdminNotificationsController : ControllerBase
    {
        // Servizio applicativo incaricato della gestione amministrativa
        // delle notifiche del sistema.
        private readonly AdminNotificationsService _notificationsService;

        /*
         * Inizializza il controller amministrativo delle notifiche
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public AdminNotificationsController(AdminNotificationsService notificationsService)
        {
            _notificationsService = notificationsService
                ?? throw new ArgumentNullException(nameof(notificationsService));
        }

        /*
         * Recupera l'elenco delle notifiche applicando opzionalmente
         * filtri per destinatario e stato.
         */
        [HttpGet]
        public async Task<ActionResult<IReadOnlyList<NotificationDto>>> GetNotifications(
            [FromQuery] Guid? recipientUserId,
            [FromQuery] string? status,
            CancellationToken cancellationToken = default)
        {
            // Delega al service layer il recupero amministrativo delle notifiche,
            // applicando gli eventuali filtri richiesti.
            var result = await _notificationsService
                .GetNotificationsAsync(recipientUserId, status, cancellationToken)
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
         * Recupera il dettaglio di una specifica notifica tramite identificativo univoco.
         */
        [HttpGet("{notificationId:guid}")]
        public async Task<ActionResult<NotificationDto>> GetNotificationById(
            Guid notificationId,
            CancellationToken cancellationToken)
        {
            // Delega al service layer il recupero della notifica richiesta.
            var result = await _notificationsService
                .GetNotificationByIdAsync(notificationId, cancellationToken)
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

            // Se la notifica non esiste, restituisce un 404 con payload esplicativo.
            if (result.Value is null)
            {
                return NotFound(new
                {
                    code = "notification_not_found",
                    message = "La notifica specificata non esiste."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea una nuova notifica applicativa e restituisce
         * il riferimento alla risorsa appena creata.
         */
        [HttpPost]
        public async Task<ActionResult<NotificationDto>> CreateNotification(
            [FromBody] CreateNotificationRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al service layer la creazione della nuova notifica.
            var result = await _notificationsService
                .CreateNotificationAsync(request, cancellationToken)
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
                    message = "Si è verificato un errore inatteso durante la creazione della notifica."
                });
            }

            var dto = result.Value;

            // Restituisce 201 Created puntando all'endpoint di lettura
            // della notifica appena creata.
            return CreatedAtAction(
                nameof(GetNotificationById),
                new { notificationId = dto.Id },
                dto);
        }
    }
}
