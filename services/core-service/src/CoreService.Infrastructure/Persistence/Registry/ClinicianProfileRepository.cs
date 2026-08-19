/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/ClinicianProfileRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità ClinicianProfile del bounded context Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IClinicianProfileRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Registry.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un profilo clinico tramite UserId.
 * - Recuperare un profilo clinico tramite identificativo del profilo.
 * - Recuperare un profilo clinico tramite numero di licenza.
 * - Persistire un nuovo profilo clinico.
 * - Aggiornare un profilo clinico esistente.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IClinicianProfileRepository
 * - Entità ClinicianProfile del dominio Registry
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
    internal sealed class ClinicianProfileRepository : IClinicianProfileRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire query e operazioni di persistenza sui profili clinico.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public ClinicianProfileRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Recupera un profilo clinico tramite l'identificativo dell'utente associato.
         */
        public Task<ClinicianProfile?> GetByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return _dbContext
                .ClinicianProfiles
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        }

        /*
         * Recupera un profilo clinico tramite il suo identificativo univoco.
         */
        public Task<ClinicianProfile?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return _dbContext
                .ClinicianProfiles
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == id, cancellationToken);
        }

        /*
         * Recupera un profilo clinico tramite numero di licenza professionale.
         */
        public Task<ClinicianProfile?> GetByLicenseNumberAsync(
            string licenseNumber,
            CancellationToken cancellationToken = default)
        {
            // Se il numero di licenza non è valorizzato, il repository evita
            // un accesso inutile al database e restituisce immediatamente null.
            if (string.IsNullOrWhiteSpace(licenseNumber))
            {
                return Task.FromResult<ClinicianProfile?>(null);
            }

            // Normalizza l'input rimuovendo eventuali spazi superflui
            // prima di eseguire il confronto sul database.
            licenseNumber = licenseNumber.Trim();

            // La query viene eseguita in modalità no-tracking
            // perché il dato è richiesto solo per consultazione.
            return _dbContext
                .ClinicianProfiles
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.LicenseNumber == licenseNumber, cancellationToken);
        }

        /*
         * Persiste un nuovo profilo clinico nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            ClinicianProfile profile,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (profile is null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            // Inserisce la nuova entità nel DbContext.
            await _dbContext.ClinicianProfiles.AddAsync(profile, cancellationToken).ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        /*
         * Aggiorna un profilo clinico esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            ClinicianProfile profile,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (profile is null)
            {
                throw new ArgumentNullException(nameof(profile));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.ClinicianProfiles.Update(profile);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
