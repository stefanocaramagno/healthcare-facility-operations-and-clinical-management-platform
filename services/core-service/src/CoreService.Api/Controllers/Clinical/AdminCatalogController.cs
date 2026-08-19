/*
 * File: services/core-service/src/CoreService.Api/Controllers/Clinical/AdminCatalogController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint amministrativi per la consultazione e la gestione
 * del catalogo delle prestazioni cliniche del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del ruolo Admin sul catalogo clinico. Consente di visualizzare tutte
 * le prestazioni, incluse quelle inattive, e di crearne o aggiornarne
 * le informazioni amministrative.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'elenco completo delle prestazioni del catalogo.
 * - Recuperare il dettaglio di una prestazione per identificativo.
 * - Creare una nuova prestazione di catalogo.
 * - Aggiornare una prestazione esistente.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - AdminCatalogService
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
using CoreService.Application.Clinical.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Clinical
{
    [ApiController]
    [Route("catalog/admin")]
    [Authorize(Roles = "Admin")]
    public sealed class AdminCatalogController : ControllerBase
    {
        // Servizio applicativo incaricato della gestione amministrativa
        // del catalogo delle prestazioni.
        private readonly AdminCatalogService _adminCatalogService;

        /*
         * Inizializza il controller amministrativo del catalogo
         * con il servizio applicativo responsabile delle operazioni richieste.
         */
        public AdminCatalogController(AdminCatalogService adminCatalogService)
        {
            _adminCatalogService = adminCatalogService
                ?? throw new ArgumentNullException(nameof(adminCatalogService));
        }

        /*
         * Recupera l'elenco completo delle prestazioni di catalogo,
         * con possibilità di includere quelle inattive e applicare una ricerca testuale.
         */
        [HttpGet("services")]
        public async Task<ActionResult<IReadOnlyList<ServiceCatalogItemDto>>> GetAllServices(
            [FromQuery] bool includeInactive = true,
            [FromQuery] string? search = null,
            CancellationToken cancellationToken = default)
        {
            // Delega al service layer il recupero dell'elenco amministrativo delle prestazioni.
            var result = await _adminCatalogService
                .GetAllServicesAsync(includeInactive, search, cancellationToken)
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

            // In assenza di risultati espliciti, restituisce una collezione vuota
            // invece di un valore nullo.
            var services = result.Value ?? Array.Empty<ServiceCatalogItemDto>();

            return Ok(services);
        }

        /*
         * Recupera una prestazione di catalogo tramite identificativo univoco,
         * senza limitarsi alle sole prestazioni attive.
         */
        [HttpGet("services/{id:guid}")]
        public async Task<ActionResult<ServiceCatalogItemDto>> GetServiceById(
            Guid id,
            CancellationToken cancellationToken = default)
        {
            // Delega al service layer il recupero della prestazione richiesta.
            var result = await _adminCatalogService
                .GetServiceByIdAsync(id, cancellationToken)
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

            // Se la prestazione non esiste, restituisce un 404 con payload esplicativo.
            if (result.Value is null)
            {
                return NotFound(new
                {
                    code = "service_not_found",
                    message = "La prestazione specificata non esiste."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea una nuova prestazione nel catalogo amministrativo
         * e restituisce il riferimento alla risorsa appena creata.
         */
        [HttpPost("services")]
        public async Task<ActionResult<ServiceCatalogItemDto>> CreateService(
            [FromBody] CreateServiceCatalogItemRequest? request,
            CancellationToken cancellationToken = default)
        {
            // Delega al service layer la creazione della nuova prestazione.
            var result = await _adminCatalogService
                .CreateServiceAsync(request, cancellationToken)
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
                return StatusCode(500, new
                {
                    code = "service_creation_error",
                    message = "Si è verificato un errore inatteso durante la creazione della prestazione."
                });
            }

            var dto = result.Value;

            // Restituisce 201 Created puntando all'endpoint di lettura della prestazione creata.
            return CreatedAtAction(
                nameof(GetServiceById),
                new { id = dto.Id },
                dto);
        }

        /*
         * Aggiorna una prestazione esistente del catalogo amministrativo
         * e restituisce la versione aggiornata della risorsa.
         */
        [HttpPut("services/{id:guid}")]
        public async Task<ActionResult<ServiceCatalogItemDto>> UpdateService(
            Guid id,
            [FromBody] UpdateServiceCatalogItemRequest? request,
            CancellationToken cancellationToken = default)
        {
            // Delega al service layer l'aggiornamento della prestazione esistente.
            var result = await _adminCatalogService
                .UpdateServiceAsync(id, request, cancellationToken)
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
                return StatusCode(500, new
                {
                    code = "service_update_error",
                    message = "Si è verificato un errore inatteso durante l'aggiornamento della prestazione."
                });
            }

            return Ok(result.Value);
        }
    }
}
