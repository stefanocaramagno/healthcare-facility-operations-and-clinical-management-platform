/*
 * File: services/core-service/src/CoreService.Application/Clinical/Services/AdminCatalogService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi amministrativi relativi
 * alla consultazione e alla gestione del catalogo delle prestazioni cliniche.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Clinical
 * e coordina i workflow che consentono all'amministratore di:
 * - consultare tutte le prestazioni del catalogo, attive e non attive;
 * - recuperare una prestazione per identificativo;
 * - creare una nuova prestazione;
 * - aggiornare una prestazione esistente.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'elenco completo delle prestazioni del catalogo.
 * - Applicare un filtro di ricerca testuale sulle prestazioni.
 * - Recuperare una prestazione per identificativo.
 * - Validare i payload amministrativi di creazione e aggiornamento.
 * - Garantire l'unicità del codice prestazione in fase di creazione.
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
    public sealed class AdminCatalogService
    {
        // Repository applicativo necessario alla gestione amministrativa
        // del catalogo delle prestazioni cliniche.
        private readonly IServiceCatalogRepository _serviceCatalogRepository;

        /*
         * Inizializza il servizio con la dipendenza necessaria
         * ai workflow amministrativi del catalogo clinico.
         */
        public AdminCatalogService(IServiceCatalogRepository serviceCatalogRepository)
        {
            _serviceCatalogRepository = serviceCatalogRepository
                ?? throw new ArgumentNullException(nameof(serviceCatalogRepository));
        }

        /*
         * Recupera tutte le prestazioni del catalogo,
         * includendo opzionalmente anche quelle inattive
         * e applicando, se richiesto, un filtro testuale.
         */
        public async Task<OperationResult<IReadOnlyList<ServiceCatalogItemDto>>> GetAllServicesAsync(
            bool includeInactive,
            string? search,
            CancellationToken cancellationToken)
        {
            // Recupera dal repository tutte le prestazioni coerenti
            // con il flag che decide se includere o meno quelle inattive.
            var items = await _serviceCatalogRepository
                .GetAllAsync(includeInactive, cancellationToken)
                .ConfigureAwait(false);

            // Se è stato specificato un termine di ricerca,
            // applica un filtro testuale su codice, nome e descrizione.
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

            // Converte le entità del dominio nei relativi DTO applicativi.
            var dtos = items
                .Select(MapToDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<ServiceCatalogItemDto>>.Success(dtos);
        }

        /*
         * Recupera una prestazione del catalogo a partire dal suo identificativo,
         * senza imporre che essa sia attiva.
         */
        public async Task<OperationResult<ServiceCatalogItemDto>> GetServiceByIdAsync(
            Guid id,
            CancellationToken cancellationToken)
        {
            // Recupera la prestazione richiesta tramite identificativo univoco.
            var item = await _serviceCatalogRepository
                .GetByIdAsync(id, cancellationToken)
                .ConfigureAwait(false);

            // Se la prestazione non esiste, restituisce un not found applicativo.
            if (item is null)
            {
                return OperationResult<ServiceCatalogItemDto>.NotFound(
                    "service_not_found",
                    "La prestazione specificata non esiste.");
            }

            return OperationResult<ServiceCatalogItemDto>.Success(MapToDto(item));
        }

        /*
         * Crea una nuova prestazione del catalogo,
         * validando il payload e garantendo l'unicità del codice.
         */
        public async Task<OperationResult<ServiceCatalogItemDto>> CreateServiceAsync(
            CreateServiceCatalogItemRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload è obbligatorio per poter creare una nuova prestazione.
            if (request is null)
            {
                return OperationResult<ServiceCatalogItemDto>.BadRequest(
                    "invalid_request",
                    "Il payload della richiesta non può essere nullo.");
            }

            var code = (request.Code ?? string.Empty).Trim();
            var name = (request.Name ?? string.Empty).Trim();

            // Il codice prestazione è un campo obbligatorio.
            if (string.IsNullOrWhiteSpace(code))
            {
                return OperationResult<ServiceCatalogItemDto>.BadRequest(
                    "service_code_required",
                    "Il codice della prestazione è obbligatorio.");
            }

            // Il nome prestazione è un campo obbligatorio.
            if (string.IsNullOrWhiteSpace(name))
            {
                return OperationResult<ServiceCatalogItemDto>.BadRequest(
                    "service_name_required",
                    "Il nome della prestazione è obbligatorio.");
            }

            // Il prezzo base non può assumere valori negativi.
            if (request.BasePriceCents < 0)
            {
                return OperationResult<ServiceCatalogItemDto>.BadRequest(
                    "invalid_base_price",
                    "Il prezzo base non può essere negativo.");
            }

            // Verifica l'assenza di una prestazione già esistente con lo stesso codice.
            var existingWithCode = await _serviceCatalogRepository
                .GetByCodeAsync(code, cancellationToken)
                .ConfigureAwait(false);

            if (existingWithCode is not null)
            {
                return OperationResult<ServiceCatalogItemDto>.Conflict(
                    "service_code_already_exists",
                    $"Esiste già una prestazione con codice '{code}'.");
            }

            var nowUtc = DateTime.UtcNow;

            // Costruisce la nuova entità di dominio applicando le normalizzazioni testuali necessarie.
            var entity = new ServiceCatalogItem
            {
                Id = Guid.NewGuid(),
                Code = code,
                Name = name,
                Description = string.IsNullOrWhiteSpace(request.Description)
                    ? null
                    : request.Description.Trim(),
                BasePriceCents = request.BasePriceCents,
                Currency = string.IsNullOrWhiteSpace(request.Currency)
                    ? "EUR"
                    : request.Currency.Trim().ToUpperInvariant(),
                IsActive = true,
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            await _serviceCatalogRepository
                .AddAsync(entity, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapToDto(entity);

            return OperationResult<ServiceCatalogItemDto>.Success(dto);
        }

        /*
         * Aggiorna una prestazione esistente del catalogo,
         * validando il payload e applicando le modifiche consentite.
         */
        public async Task<OperationResult<ServiceCatalogItemDto>> UpdateServiceAsync(
            Guid id,
            UpdateServiceCatalogItemRequest? request,
            CancellationToken cancellationToken)
        {
            // Il payload è obbligatorio per poter aggiornare una prestazione.
            if (request is null)
            {
                return OperationResult<ServiceCatalogItemDto>.BadRequest(
                    "invalid_request",
                    "Il payload della richiesta non può essere nullo.");
            }

            // Il prezzo base non può assumere valori negativi.
            if (request.BasePriceCents < 0)
            {
                return OperationResult<ServiceCatalogItemDto>.BadRequest(
                    "invalid_base_price",
                    "Il prezzo base non può essere negativo.");
            }

            // Recupera la prestazione esistente da aggiornare.
            var entity = await _serviceCatalogRepository
                .GetByIdAsync(id, cancellationToken)
                .ConfigureAwait(false);

            if (entity is null)
            {
                return OperationResult<ServiceCatalogItemDto>.NotFound(
                    "service_not_found",
                    "La prestazione specificata non esiste.");
            }

            var newName = (request.Name ?? string.Empty).Trim();

            // Il nome aggiornato della prestazione rimane obbligatorio.
            if (string.IsNullOrWhiteSpace(newName))
            {
                return OperationResult<ServiceCatalogItemDto>.BadRequest(
                    "service_name_required",
                    "Il nome della prestazione è obbligatorio.");
            }

            // Aggiorna i campi modificabili dell'entità esistente.
            entity.Name = newName;
            entity.Description = string.IsNullOrWhiteSpace(request.Description)
                ? null
                : request.Description.Trim();
            entity.BasePriceCents = request.BasePriceCents;
            entity.Currency = string.IsNullOrWhiteSpace(request.Currency)
                ? entity.Currency
                : request.Currency.Trim().ToUpperInvariant();
            entity.IsActive = request.IsActive;
            entity.UpdatedAtUtc = DateTime.UtcNow;

            await _serviceCatalogRepository
                .UpdateAsync(entity, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapToDto(entity);

            return OperationResult<ServiceCatalogItemDto>.Success(dto);
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
