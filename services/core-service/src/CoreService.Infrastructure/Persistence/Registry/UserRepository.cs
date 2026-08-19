/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/UserRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità User del bounded context Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IUserRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Registry.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un utente tramite identificativo univoco.
 * - Recuperare un utente tramite indirizzo e-mail.
 * - Persistire un nuovo utente.
 * - Aggiornare un utente esistente.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IUserRepository
 * - Entità User del dominio Registry
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
    public sealed class UserRepository : IUserRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire query e operazioni di persistenza sugli utenti.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public UserRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Recupera un utente tramite il suo identificativo univoco.
         */
        public Task<User?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == id, cancellationToken);
        }

        /*
         * Recupera un utente tramite indirizzo e-mail.
         */
        public Task<User?> GetByEmailAsync(
            string email,
            CancellationToken cancellationToken = default)
        {
            // Se l'e-mail non è valorizzata, il repository evita
            // un accesso inutile al database e restituisce immediatamente null.
            if (string.IsNullOrWhiteSpace(email))
            {
                return Task.FromResult<User?>(null);
            }

            // Normalizza l'input rimuovendo eventuali spazi superflui
            // prima di eseguire il confronto sul database.
            email = email.Trim();

            // La query viene eseguita in modalità no-tracking
            // perché il dato è richiesto solo per consultazione.
            return _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
        }

        /*
         * Persiste un nuovo utente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            User user,
            CancellationToken cancellationToken = default)
        {
            // Inserisce la nuova entità nel DbContext.
            await _dbContext.Users.AddAsync(user, cancellationToken).ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        /*
         * Aggiorna un utente esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            User user,
            CancellationToken cancellationToken = default)
        {
            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.Users.Update(user);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
