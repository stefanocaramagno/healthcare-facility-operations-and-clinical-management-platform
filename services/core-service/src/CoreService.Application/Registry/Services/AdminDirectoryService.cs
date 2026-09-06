/*
 * File: services/core-service/src/CoreService.Application/Registry/Services/AdminDirectoryService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso amministrativi del dominio Registry
 * relativi alla ricerca nelle directory di pazienti, delegati e clinici.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Registry
 * e funge da servizio applicativo per le operazioni di ricerca amministrativa.
 * Si occupa di validare i parametri di paging ricevuti dal layer superiore
 * e di delegare al repository specializzato l'esecuzione delle query.
 *
 * Responsabilità principali
 * -------------------------
 * - Eseguire la ricerca amministrativa dei pazienti.
 * - Eseguire la ricerca amministrativa dei delegati.
 * - Eseguire la ricerca amministrativa dei clinici.
 * - Validare i parametri di paginazione skip/take.
 * - Restituire esiti uniformi tramite OperationResult.
 * - Tradurre eventuali errori tecnici in errori applicativi coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - IAdminDirectoryRepository
 * - DTO del layer Application
 * - OperationResult
 *
 * Note
 * ----
 * Il servizio non contiene logica infrastrutturale di accesso ai dati:
 * delega le interrogazioni al repository dedicato e centralizza
 * la validazione applicativa dei parametri di ricerca.
 */

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Registry.Repositories;
using Microsoft.AspNetCore.Http;

namespace CoreService.Application.Registry.Services
{
    public sealed class AdminDirectoryService
    {
        // Repository specializzato nelle ricerche amministrative
        // sulle diverse directory del dominio Registry.
        private readonly IAdminDirectoryRepository _directory;

        /*
         * Inizializza il servizio applicativo con il repository necessario
         * all'esecuzione delle ricerche amministrative.
         */
        public AdminDirectoryService(IAdminDirectoryRepository directory)
        {
            _directory = directory
                ?? throw new ArgumentNullException(nameof(directory));
        }

        /*
         * Ricerca i pazienti applicando eventuali filtri testuali, di stato attivo
         * e parametri di paginazione.
         */
        public async Task<OperationResult<IReadOnlyList<PatientDirectoryItemDto>>> SearchPatientsAsync(
            string? query,
            bool? onlyActive,
            int? skip,
            int? take,
            CancellationToken cancellationToken)
        {
            // Applica valori di default ai parametri di paginazione
            // quando non esplicitamente specificati dal chiamante.
            var safeSkip = skip.GetValueOrDefault(0);
            var safeTake = take.GetValueOrDefault(50);

            // Il numero di record da saltare non può essere negativo.
            if (safeSkip < 0)
            {
                return OperationResult<IReadOnlyList<PatientDirectoryItemDto>>.BadRequest(
                    "invalid_skip",
                    "Il parametro skip non è valido.");
            }

            // Il numero massimo di record richiesti deve rientrare
            // nel range ammesso per proteggere il sistema da richieste eccessive.
            if (safeTake <= 0 || safeTake > 500)
            {
                return OperationResult<IReadOnlyList<PatientDirectoryItemDto>>.BadRequest(
                    "invalid_take",
                    "Il parametro take non è valido (range ammesso: 1..500).");
            }

            try
            {
                // Delega al repository la ricerca dei pazienti
                // usando i parametri già validati.
                var rows = await _directory
                    .SearchPatientsAsync(query, onlyActive, safeSkip, safeTake, cancellationToken)
                    .ConfigureAwait(false);

                return OperationResult<IReadOnlyList<PatientDirectoryItemDto>>.Success(rows);
            }
            catch (Exception)
            {
                // Converte eventuali errori tecnici in un errore applicativo uniforme,
                // evitando di esporre dettagli infrastrutturali ai layer superiori.
                return OperationResult<IReadOnlyList<PatientDirectoryItemDto>>.Failure(
                    StatusCodes.Status500InternalServerError,
                    "search_failed",
                    "Si è verificato un errore durante la ricerca dei pazienti.");
            }
        }

        /*
         * Ricerca i delegati applicando eventuali filtri testuali, di stato attivo
         * e parametri di paginazione.
         */
        public async Task<OperationResult<IReadOnlyList<DelegateDirectoryItemDto>>> SearchDelegatesAsync(
            string? query,
            bool? onlyActive,
            int? skip,
            int? take,
            CancellationToken cancellationToken)
        {
            // Applica valori di default ai parametri di paginazione
            // quando non esplicitamente specificati dal chiamante.
            var safeSkip = skip.GetValueOrDefault(0);
            var safeTake = take.GetValueOrDefault(50);

            // Il numero di record da saltare non può essere negativo.
            if (safeSkip < 0)
            {
                return OperationResult<IReadOnlyList<DelegateDirectoryItemDto>>.BadRequest(
                    "invalid_skip",
                    "Il parametro skip non è valido.");
            }

            // Il numero massimo di record richiesti deve rientrare
            // nel range ammesso per proteggere il sistema da richieste eccessive.
            if (safeTake <= 0 || safeTake > 500)
            {
                return OperationResult<IReadOnlyList<DelegateDirectoryItemDto>>.BadRequest(
                    "invalid_take",
                    "Il parametro take non è valido (range ammesso: 1..500).");
            }

            try
            {
                // Delega al repository la ricerca dei delegati
                // usando i parametri già validati.
                var rows = await _directory
                    .SearchDelegatesAsync(query, onlyActive, safeSkip, safeTake, cancellationToken)
                    .ConfigureAwait(false);

                return OperationResult<IReadOnlyList<DelegateDirectoryItemDto>>.Success(rows);
            }
            catch (Exception)
            {
                // Converte eventuali errori tecnici in un errore applicativo uniforme,
                // evitando di esporre dettagli infrastrutturali ai layer superiori.
                return OperationResult<IReadOnlyList<DelegateDirectoryItemDto>>.Failure(
                    StatusCodes.Status500InternalServerError,
                    "search_failed",
                    "Si è verificato un errore durante la ricerca dei delegati.");
            }
        }

        /*
         * Ricerca i clinici applicando eventuali filtri testuali, di stato attivo
         * e parametri di paginazione.
         */
        public async Task<OperationResult<IReadOnlyList<ClinicianDirectoryItemDto>>> SearchCliniciansAsync(
            string? query,
            bool? onlyActive,
            int? skip,
            int? take,
            CancellationToken cancellationToken)
        {
            // Applica valori di default ai parametri di paginazione
            // quando non esplicitamente specificati dal chiamante.
            var safeSkip = skip.GetValueOrDefault(0);
            var safeTake = take.GetValueOrDefault(50);

            // Il numero di record da saltare non può essere negativo.
            if (safeSkip < 0)
            {
                return OperationResult<IReadOnlyList<ClinicianDirectoryItemDto>>.BadRequest(
                    "invalid_skip",
                    "Il parametro skip non è valido.");
            }

            // Il numero massimo di record richiesti deve rientrare
            // nel range ammesso per proteggere il sistema da richieste eccessive.
            if (safeTake <= 0 || safeTake > 500)
            {
                return OperationResult<IReadOnlyList<ClinicianDirectoryItemDto>>.BadRequest(
                    "invalid_take",
                    "Il parametro take non è valido (range ammesso: 1..500).");
            }

            try
            {
                // Delega al repository la ricerca dei clinici
                // usando i parametri già validati.
                var rows = await _directory
                    .SearchCliniciansAsync(query, onlyActive, safeSkip, safeTake, cancellationToken)
                    .ConfigureAwait(false);

                return OperationResult<IReadOnlyList<ClinicianDirectoryItemDto>>.Success(rows);
            }
            catch (Exception)
            {
                // Converte eventuali errori tecnici in un errore applicativo uniforme,
                // evitando di esporre dettagli infrastrutturali ai layer superiori.
                return OperationResult<IReadOnlyList<ClinicianDirectoryItemDto>>.Failure(
                    StatusCodes.Status500InternalServerError,
                    "search_failed",
                    "Si è verificato un errore durante la ricerca dei clinici.");
            }
        }
    }
}
