/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/DelegateProfileRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità DelegateProfile del bounded context Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IDelegateProfileRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Registry.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un profilo delegato tramite UserId.
 * - Recuperare un profilo delegato tramite identificativo del profilo.
 * - Persistire un nuovo profilo delegato.
 * - Aggiornare un profilo delegato esistente.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IDelegateProfileRepository
 * - Entità DelegateProfile del dominio Registry
 *
 * Note
 * ----
 * Le operazioni di lettura utilizzano AsNoTracking() per evitare
 * il tracking non necessario da parte di Entity Framework Core
 * nei casi di semplice consultazione.
 * Le operazioni di scrittura persistono immediatamente le modifiche sul database.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Registry
{
    internal sealed class DelegateProfileRepository : IDelegateProfileRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire query e operazioni di persistenza sui profili delegato.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public DelegateProfileRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Recupera un profilo delegato tramite l'identificativo dell'utente associato.
         */
        public Task<DelegateProfile?> GetByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return _dbContext
                .DelegateProfiles
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        }

        /*
         * Recupera un profilo delegato tramite il suo identificativo univoco.
         */
        public Task<DelegateProfile?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return _dbContext
                .DelegateProfiles
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        }

        /*
         * Persiste un nuovo profilo delegato nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            DelegateProfile profile,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (profile is null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            // Inserisce la nuova entità nel DbContext.
            await _dbContext.DelegateProfiles.AddAsync(profile, cancellationToken).ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        /*
         * Aggiorna un profilo delegato esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            DelegateProfile profile,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (profile is null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.DelegateProfiles.Update(profile);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
