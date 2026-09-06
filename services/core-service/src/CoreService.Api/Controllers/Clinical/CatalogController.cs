/*
 * File: services/core-service/src/CoreService.Api/Controllers/Clinical/CatalogController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint autenticati per la consultazione del catalogo
 * delle prestazioni attive disponibili nel sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per la lettura
 * del catalogo clinico lato applicazione. Consente agli utenti autenticati
 * di consultare l'elenco delle prestazioni attive e di recuperare
 * il dettaglio di una prestazione per identificativo o per codice.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'elenco delle prestazioni attive.
 * - Supportare la ricerca testuale opzionale sulle prestazioni.
 * - Recuperare una prestazione attiva tramite identificativo univoco.
 * - Recuperare una prestazione attiva tramite codice funzionale.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - CatalogService
 * - DTO del layer Application
 * - ASP.NET Core MVC
 *
 * Note
 * ----
 * Il controller è protetto da autenticazione generica e non contiene
 * logica di business del dominio: delega tutte le regole applicative
 * al servizio specializzato del layer Application.
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
    [Route("catalog")]
    [Authorize]
    public sealed class CatalogController : ControllerBase
    {
        // Servizio applicativo incaricato della consultazione
        // del catalogo delle prestazioni cliniche.
        private readonly CatalogService _catalogService;

        /*
         * Inizializza il controller del catalogo con il servizio applicativo
         * responsabile del recupero delle prestazioni attive.
         */
        public CatalogController(CatalogService catalogService)
        {
            _catalogService = catalogService
                ?? throw new ArgumentNullException(nameof(catalogService));
        }

        /*
         * Recupera l'elenco delle prestazioni attive,
         * filtrabile opzionalmente tramite ricerca testuale.
         */
        [HttpGet("services")]
        public async Task<ActionResult<IReadOnlyList<ServiceCatalogItemDto>>> GetActiveServices(
            [FromQuery] string? search,
            CancellationToken cancellationToken = default)
        {
            // Delega al service layer il recupero delle prestazioni attive,
            // applicando l'eventuale filtro di ricerca testuale.
            var result = await _catalogService
                .GetActiveServicesAsync(search, cancellationToken)
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
         * Recupera una prestazione attiva tramite identificativo univoco.
         */
        [HttpGet("services/{id:guid}")]
        public async Task<ActionResult<ServiceCatalogItemDto>> GetServiceById(
            Guid id,
            CancellationToken cancellationToken = default)
        {
            // Delega al service layer il recupero della prestazione attiva per Id.
            var result = await _catalogService
                .GetActiveServiceByIdAsync(id, cancellationToken)
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

            // Se la prestazione non è presente oppure non è attiva,
            // restituisce un 404 con payload esplicativo.
            if (result.Value is null)
            {
                return NotFound(new
                {
                    code = "service_not_found",
                    message = "La prestazione specificata non esiste oppure non è attiva."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Recupera una prestazione attiva tramite codice funzionale.
         */
        [HttpGet("services/by-code/{code}")]
        public async Task<ActionResult<ServiceCatalogItemDto>> GetServiceByCode(
            string code,
            CancellationToken cancellationToken = default)
        {
            // Delega al service layer il recupero della prestazione attiva per codice.
            var result = await _catalogService
                .GetActiveServiceByCodeAsync(code, cancellationToken)
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

            // Se la prestazione non è presente oppure non è attiva,
            // restituisce un 404 con payload esplicativo.
            if (result.Value is null)
            {
                return NotFound(new
                {
                    code = "service_not_found",
                    message = "La prestazione specificata non esiste oppure non è attiva."
                });
            }

            return Ok(result.Value);
        }
    }
}
