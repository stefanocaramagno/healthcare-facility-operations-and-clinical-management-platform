/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/PatientProfileRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità PatientProfile del bounded context Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IPatientProfileRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Registry.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un profilo paziente tramite UserId.
 * - Recuperare un profilo paziente tramite identificativo del profilo.
 * - Persistire un nuovo profilo paziente.
 * - Aggiornare un profilo paziente esistente.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IPatientProfileRepository
 * - Entità PatientProfile del dominio Registry
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
    internal sealed class PatientProfileRepository : IPatientProfileRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire query e operazioni di persistenza sui profili paziente.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public PatientProfileRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Recupera un profilo paziente tramite l'identificativo dell'utente associato.
         */
        public Task<PatientProfile?> GetByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return _dbContext
                .PatientProfiles
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        }

        /*
         * Recupera un profilo paziente tramite il suo identificativo univoco.
         */
        public Task<PatientProfile?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return _dbContext
                .PatientProfiles
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        }

        /*
         * Persiste un nuovo profilo paziente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            PatientProfile profile,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (profile is null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            // Inserisce la nuova entità nel DbContext.
            await _dbContext.PatientProfiles.AddAsync(profile, cancellationToken).ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        /*
         * Aggiorna un profilo paziente esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            PatientProfile profile,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (profile is null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.PatientProfiles.Update(profile);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
