/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/DelegationRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità Delegation del bounded context Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IDelegationRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Registry.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare una delega tramite identificativo univoco.
 * - Recuperare una delega tramite coppia paziente/delegato.
 * - Recuperare l'elenco delle deleghe associate a un paziente.
 * - Recuperare l'elenco delle deleghe associate a un delegato.
 * - Persistire una nuova delega.
 * - Aggiornare una delega esistente.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IDelegationRepository
 * - Entità Delegation del dominio Registry
 *
 * Note
 * ----
 * Le operazioni di lettura che restituiscono collezioni utilizzano AsNoTracking()
 * per evitare il tracking non necessario da parte di Entity Framework Core
 * nei casi di semplice consultazione.
 * Le operazioni di scrittura persistono immediatamente le modifiche sul database.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Registry
{
    internal sealed class DelegationRepository : IDelegationRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire query e operazioni di persistenza sulle deleghe.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public DelegationRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Recupera una delega tramite il suo identificativo univoco.
         */
        public async Task<Delegation?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default)
        {
            // La query restituisce al massimo una delega
            // associata all'identificativo richiesto.
            return await _dbContext
                .Delegations
                .SingleOrDefaultAsync(d => d.Id == id, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera una delega tramite la coppia paziente/delegato.
         */
        public async Task<Delegation?> GetByPatientAndDelegateAsync(
            Guid patientUserId,
            Guid delegateUserId,
            CancellationToken cancellationToken = default)
        {
            // La query individua l'eventuale delega esistente
            // tra il paziente e il delegato specificati.
            return await _dbContext
                .Delegations
                .SingleOrDefaultAsync(
                    d => d.PatientUserId == patientUserId && d.DelegateUserId == delegateUserId,
                    cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera tutte le deleghe associate a un determinato paziente.
         */
        public async Task<IReadOnlyList<Delegation>> GetByPatientUserIdAsync(
            Guid patientUserId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            var list = await _dbContext
                .Delegations
                .AsNoTracking()
                .Where(d => d.PatientUserId == patientUserId)
                .OrderBy(d => d.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return list;
        }

        /*
         * Recupera tutte le deleghe associate a un determinato delegato.
         */
        public async Task<IReadOnlyList<Delegation>> GetByDelegateUserIdAsync(
            Guid delegateUserId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            var list = await _dbContext
                .Delegations
                .AsNoTracking()
                .Where(d => d.DelegateUserId == delegateUserId)
                .OrderBy(d => d.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return list;
        }

        /*
         * Persiste una nuova delega nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            Delegation delegation,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (delegation is null)
            {
                throw new ArgumentNullException(nameof(delegation));
            }

            // Inserisce la nuova entità nel DbContext.
            await _dbContext.Delegations
                .AddAsync(delegation, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna una delega esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            Delegation delegation,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (delegation is null)
            {
                throw new ArgumentNullException(nameof(delegation));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.Delegations.Update(delegation);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }
    }
}
