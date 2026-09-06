/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Clinical/ServiceCatalogRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità ServiceCatalogItem del bounded context Clinical.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IServiceCatalogRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Clinical.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare una prestazione di catalogo tramite identificativo univoco.
 * - Recuperare una prestazione di catalogo tramite codice.
 * - Recuperare l'elenco delle prestazioni di catalogo, con possibilità di includere o escludere quelle inattive.
 * - Persistire una nuova prestazione di catalogo.
 * - Aggiornare una prestazione di catalogo esistente.
 *
 * Interazioni principali
 * ----------------------
 * - ClinicalDbContext
 * - IServiceCatalogRepository
 * - Entità ServiceCatalogItem del dominio Clinical
 *
 * Note
 * ----
 * Le operazioni di lettura utilizzano AsNoTracking() per evitare
 * il tracking non necessario da parte di Entity Framework Core
 * nei casi di semplice consultazione.
 * Le operazioni di scrittura persistono immediatamente le modifiche sul database.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Clinical.Repositories;
using CoreService.Domain.Clinical;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Clinical
{
    public sealed class ServiceCatalogRepository : IServiceCatalogRepository
    {
        // DbContext del bounded context Clinical usato
        // per eseguire query e operazioni di persistenza sul catalogo prestazioni.
        private readonly ClinicalDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Clinical.
         */
        public ServiceCatalogRepository(ClinicalDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Recupera una prestazione di catalogo tramite il suo identificativo univoco.
         */
        public async Task<ServiceCatalogItem?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _dbContext.ServiceCatalog
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera una prestazione di catalogo tramite il relativo codice.
         */
        public async Task<ServiceCatalogItem?> GetByCodeAsync(
            string code,
            CancellationToken cancellationToken = default)
        {
            // Se il codice non è valorizzato, il repository evita
            // un accesso inutile al database e restituisce immediatamente null.
            if (string.IsNullOrWhiteSpace(code))
            {
                return null;
            }

            // Normalizza l'input rimuovendo eventuali spazi superflui
            // prima di eseguire il confronto sul database.
            var normalizedCode = code.Trim();

            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _dbContext.ServiceCatalog
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Code == normalizedCode, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera l'elenco delle prestazioni di catalogo,
         * includendo opzionalmente anche quelle inattive.
         */
        public async Task<IReadOnlyList<ServiceCatalogItem>> GetAllAsync(
            bool includeInactive,
            CancellationToken cancellationToken = default)
        {
            // Costruisce la query base in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            IQueryable<ServiceCatalogItem> query = _dbContext.ServiceCatalog.AsNoTracking();

            // Se richiesto, limita il risultato alle sole prestazioni attive.
            if (!includeInactive)
            {
                query = query.Where(x => x.IsActive);
            }

            // Ordina il catalogo in modo stabile e leggibile
            // prima della materializzazione dei risultati.
            var items = await query
                .OrderBy(x => x.Name)
                .ThenBy(x => x.Code)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return items;
        }

        /*
         * Persiste una nuova prestazione di catalogo nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            ServiceCatalogItem item,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (item is null)
            {
                throw new ArgumentNullException(nameof(item));
            }

            // Inserisce la nuova entità nel DbContext.
            await _dbContext.ServiceCatalog
                .AddAsync(item, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna una prestazione di catalogo esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            ServiceCatalogItem item,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (item is null)
            {
                throw new ArgumentNullException(nameof(item));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.ServiceCatalog.Update(item);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }
    }
}
