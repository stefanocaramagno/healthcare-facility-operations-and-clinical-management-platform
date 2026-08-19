/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/ConsentRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità Consent del bounded context Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IConsentRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Registry.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare tutti i consensi associati a un paziente.
 * - Recuperare il consenso più recente di un determinato tipo per un paziente.
 * - Persistire un nuovo consenso.
 * - Aggiornare un consenso esistente.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IConsentRepository
 * - Entità Consent del dominio Registry
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
    internal sealed class ConsentRepository : IConsentRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire query e operazioni di persistenza sui consensi.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public ConsentRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Recupera tutti i consensi associati a un determinato paziente.
         */
        public async Task<IReadOnlyList<Consent>> GetByPatientUserIdAsync(
            Guid patientUserId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            var list = await _dbContext
                .Consents
                .AsNoTracking()
                .Where(c => c.PatientUserId == patientUserId)
                .OrderBy(c => c.Type)
                .ThenByDescending(c => c.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return list;
        }

        /*
         * Recupera il consenso più recente di uno specifico tipo
         * associato a un determinato paziente.
         */
        public async Task<Consent?> GetByPatientAndTypeAsync(
            Guid patientUserId,
            ConsentType type,
            CancellationToken cancellationToken = default)
        {
            // I record vengono ordinati dal più recente al meno recente
            // per restituire il consenso attualmente più rilevante per il chiamante.
            return await _dbContext
                .Consents
                .Where(c => c.PatientUserId == patientUserId && c.Type == type)
                .OrderByDescending(c => c.CreatedAtUtc)
                .FirstOrDefaultAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo consenso nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            Consent consent,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (consent is null)
            {
                throw new ArgumentNullException(nameof(consent));
            }

            // Inserisce la nuova entità nel DbContext.
            await _dbContext.Consents
                .AddAsync(consent, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna un consenso esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            Consent consent,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (consent is null)
            {
                throw new ArgumentNullException(nameof(consent));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.Consents.Update(consent);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }
    }
}
