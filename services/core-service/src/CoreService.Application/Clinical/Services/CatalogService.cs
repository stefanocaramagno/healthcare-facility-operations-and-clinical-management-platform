/*
 * File: services/core-service/src/CoreService.Application/Clinical/Services/CatalogService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi alla consultazione
 * del catalogo delle prestazioni cliniche attive.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Clinical
 * e coordina i workflow che consentono ai client autorizzati
 * di consultare il catalogo delle prestazioni, ricercarle
 * per testo libero oppure recuperarle tramite identificativo o codice.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'elenco delle prestazioni attive.
 * - Applicare un filtro di ricerca testuale sulle prestazioni attive.
 * - Recuperare una prestazione attiva per identificativo.
 * - Recuperare una prestazione attiva per codice.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IServiceCatalogRepository
 * - Entità del dominio Clinical
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati al repository dedicato.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Common;
using CoreService.Application.Clinical.Repositories;
using CoreService.Domain.Clinical;

namespace CoreService.Application.Clinical.Services
{
    public sealed class CatalogService
    {
        // Repository applicativo necessario al recupero
        // delle prestazioni del catalogo clinico.
        private readonly IServiceCatalogRepository _serviceCatalogRepository;

        /*
         * Inizializza il servizio con la dipendenza necessaria
         * ai workflow di consultazione del catalogo.
         */
        public CatalogService(IServiceCatalogRepository serviceCatalogRepository)
        {
            _serviceCatalogRepository = serviceCatalogRepository
                ?? throw new ArgumentNullException(nameof(serviceCatalogRepository));
        }

        /*
         * Recupera tutte le prestazioni attive del catalogo
         * e applica opzionalmente un filtro testuale su codice, nome e descrizione.
         */
        public async Task<OperationResult<IReadOnlyList<ServiceCatalogItemDto>>> GetActiveServicesAsync(
            string? search,
            CancellationToken cancellationToken)
        {
            // Recupera tutte le prestazioni attive dal repository.
            var items = await _serviceCatalogRepository
                .GetAllAsync(includeInactive: false, cancellationToken)
                .ConfigureAwait(false);

            // Se è stato specificato un termine di ricerca,
            // filtra le prestazioni sui principali campi descrittivi.
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim();

                items = items
                    .Where(x =>
                        x.Code.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                        x.Name.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                        (!string.IsNullOrWhiteSpace(x.Description) &&
                         x.Description.Contains(term, StringComparison.OrdinalIgnoreCase)))
                    .ToList();
            }

            // Converte le entità del dominio nei corrispondenti DTO applicativi.
            var dtos = items
                .Select(MapToDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<ServiceCatalogItemDto>>.Success(dtos);
        }

        /*
         * Recupera una prestazione attiva del catalogo a partire dal suo identificativo.
         */
        public async Task<OperationResult<ServiceCatalogItemDto>> GetActiveServiceByIdAsync(
            Guid id,
            CancellationToken cancellationToken)
        {
            // Recupera la prestazione tramite identificativo.
            var item = await _serviceCatalogRepository
                .GetByIdAsync(id, cancellationToken)
                .ConfigureAwait(false);

            // La prestazione deve esistere ed essere attiva.
            if (item is null || !item.IsActive)
            {
                return OperationResult<ServiceCatalogItemDto>.NotFound(
                    "service_not_found",
                    "La prestazione specificata non esiste oppure non è attiva.");
            }

            return OperationResult<ServiceCatalogItemDto>.Success(MapToDto(item));
        }

        /*
         * Recupera una prestazione attiva del catalogo a partire dal suo codice.
         */
        public async Task<OperationResult<ServiceCatalogItemDto>> GetActiveServiceByCodeAsync(
            string code,
            CancellationToken cancellationToken)
        {
            // Il codice della prestazione è obbligatorio.
            if (string.IsNullOrWhiteSpace(code))
            {
                return OperationResult<ServiceCatalogItemDto>.BadRequest(
                    "service_code_required",
                    "Il codice della prestazione è obbligatorio.");
            }

            var trimmedCode = code.Trim();

            // Recupera la prestazione tramite codice.
            var item = await _serviceCatalogRepository
                .GetByCodeAsync(trimmedCode, cancellationToken)
                .ConfigureAwait(false);

            // La prestazione deve esistere ed essere attiva.
            if (item is null || !item.IsActive)
            {
                return OperationResult<ServiceCatalogItemDto>.NotFound(
                    "service_not_found",
                    "La prestazione specificata non esiste oppure non è attiva.");
            }

            return OperationResult<ServiceCatalogItemDto>.Success(MapToDto(item));
        }

        /*
         * Converte un'entità ServiceCatalogItem del dominio
         * nel corrispondente DTO applicativo.
         */
        private static ServiceCatalogItemDto MapToDto(ServiceCatalogItem entity)
        {
            return new ServiceCatalogItemDto(
                entity.Id,
                entity.Code,
                entity.Name,
                entity.Description,
                entity.BasePriceCents,
                entity.Currency,
                entity.IsActive);
        }
    }
}
