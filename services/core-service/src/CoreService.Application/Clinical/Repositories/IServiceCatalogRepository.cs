/*
 * File: services/core-service/src/CoreService.Application/Clinical/Repositories/IServiceCatalogRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * delle prestazioni del catalogo clinico.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Clinical
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono interrogare e modificare il catalogo delle prestazioni,
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare una prestazione per identificativo.
 * - Recuperare una prestazione per codice.
 * - Recuperare l'elenco delle prestazioni del catalogo.
 * - Persistire una nuova prestazione.
 * - Aggiornare una prestazione esistente.
 *
 * Interazioni principali
 * ----------------------
 * - CatalogService
 * - AdminCatalogService
 * - Servizi applicativi che necessitano di consultare il catalogo clinico
 * - Implementazioni infrastrutturali dei repository
 * - Entità ServiceCatalogItem del dominio
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * sul database o sul meccanismo di persistenza:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Domain.Clinical;

namespace CoreService.Application.Clinical.Repositories
{
    public interface IServiceCatalogRepository
    {
        /*
         * Recupera una prestazione del catalogo a partire dal suo identificativo univoco.
         */
        Task<ServiceCatalogItem?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default);

        /*
         * Recupera una prestazione del catalogo a partire dal suo codice univoco.
         */
        Task<ServiceCatalogItem?> GetByCodeAsync(
            string code,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutte le prestazioni del catalogo,
         * con possibilità di includere o escludere quelle inattive.
         */
        Task<IReadOnlyList<ServiceCatalogItem>> GetAllAsync(
            bool includeInactive,
            CancellationToken cancellationToken = default);

        /*
         * Persiste una nuova prestazione del catalogo clinico.
         */
        Task AddAsync(
            ServiceCatalogItem item,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna una prestazione del catalogo clinico già esistente.
         */
        Task UpdateAsync(
            ServiceCatalogItem item,
            CancellationToken cancellationToken = default);
    }
}
