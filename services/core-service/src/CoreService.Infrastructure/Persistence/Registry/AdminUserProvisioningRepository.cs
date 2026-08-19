/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/AdminUserProvisioningRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale dedicato
 * alla creazione atomica di utenti e relativi profili applicativi
 * nel bounded context Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IAdminUserProvisioningRepository del layer Application.
 * Il suo compito è tradurre i workflow amministrativi di provisioning utenti
 * in operazioni di persistenza Entity Framework Core verso il database Registry,
 * garantendo la coerenza transazionale tra la creazione dell'utente
 * e la creazione del profilo associato.
 *
 * Responsabilità principali
 * -------------------------
 * - Creare un utente Patient insieme al relativo PatientProfile.
 * - Creare un utente Delegate insieme al relativo DelegateProfile.
 * - Creare un utente Clinician insieme al relativo ClinicianProfile.
 * - Garantire atomicità tra inserimento dell'utente e inserimento del profilo.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IAdminUserProvisioningRepository
 * - Entità User del dominio Registry
 * - Entità PatientProfile del dominio Registry
 * - Entità DelegateProfile del dominio Registry
 * - Entità ClinicianProfile del dominio Registry
 *
 * Note
 * ----
 * Ogni operazione di provisioning viene eseguita all'interno
 * di una transazione database esplicita, così da evitare stati parziali
 * in caso di errore durante la creazione combinata di utente e profilo.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;

namespace CoreService.Infrastructure.Persistence.Registry
{
    internal sealed class AdminUserProvisioningRepository : IAdminUserProvisioningRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire i workflow di provisioning amministrativo degli utenti.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public AdminUserProvisioningRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Crea atomicamente un utente con ruolo Patient
         * insieme al relativo profilo paziente.
         */
        public async Task CreatePatientWithProfileAsync(
            User user,
            PatientProfile profile,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'avvio del workflow con riferimenti nulli.
            ArgumentNullException.ThrowIfNull(user);
            ArgumentNullException.ThrowIfNull(profile);

            // Avvia una transazione esplicita per garantire
            // la coerenza atomica tra inserimento utente e inserimento profilo.
            await using var transaction = await _dbContext.Database
                .BeginTransactionAsync(cancellationToken)
                .ConfigureAwait(false);

            // Inserisce l'utente nel DbContext.
            await _dbContext.Users.AddAsync(user, cancellationToken).ConfigureAwait(false);

            // Inserisce il profilo paziente associato nel DbContext.
            await _dbContext.PatientProfiles.AddAsync(profile, cancellationToken).ConfigureAwait(false);

            // Persiste entrambe le entità sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

            // Conferma definitivamente la transazione.
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        /*
         * Crea atomicamente un utente con ruolo Delegate
         * insieme al relativo profilo delegato.
         */
        public async Task CreateDelegateWithProfileAsync(
            User user,
            DelegateProfile profile,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'avvio del workflow con riferimenti nulli.
            ArgumentNullException.ThrowIfNull(user);
            ArgumentNullException.ThrowIfNull(profile);

            // Avvia una transazione esplicita per garantire
            // la coerenza atomica tra inserimento utente e inserimento profilo.
            await using var transaction = await _dbContext.Database
                .BeginTransactionAsync(cancellationToken)
                .ConfigureAwait(false);

            // Inserisce l'utente nel DbContext.
            await _dbContext.Users.AddAsync(user, cancellationToken).ConfigureAwait(false);

            // Inserisce il profilo delegato associato nel DbContext.
            await _dbContext.DelegateProfiles.AddAsync(profile, cancellationToken).ConfigureAwait(false);

            // Persiste entrambe le entità sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

            // Conferma definitivamente la transazione.
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }

        /*
         * Crea atomicamente un utente con ruolo Clinician
         * insieme al relativo profilo clinico.
         */
        public async Task CreateClinicianWithProfileAsync(
            User user,
            ClinicianProfile profile,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'avvio del workflow con riferimenti nulli.
            ArgumentNullException.ThrowIfNull(user);
            ArgumentNullException.ThrowIfNull(profile);

            // Avvia una transazione esplicita per garantire
            // la coerenza atomica tra inserimento utente e inserimento profilo.
            await using var transaction = await _dbContext.Database
                .BeginTransactionAsync(cancellationToken)
                .ConfigureAwait(false);

            // Inserisce l'utente nel DbContext.
            await _dbContext.Users.AddAsync(user, cancellationToken).ConfigureAwait(false);

            // Inserisce il profilo clinico associato nel DbContext.
            await _dbContext.ClinicianProfiles.AddAsync(profile, cancellationToken).ConfigureAwait(false);

            // Persiste entrambe le entità sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

            // Conferma definitivamente la transazione.
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
