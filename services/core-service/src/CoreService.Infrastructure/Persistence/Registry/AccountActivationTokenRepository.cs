/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/AccountActivationTokenRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità AccountActivationToken del bounded context Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IAccountActivationTokenRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Registry.
 *
 * Responsabilità principali
 * -------------------------
 * - Persistire un nuovo token di attivazione account.
 * - Recuperare un token di attivazione valido a partire dal suo hash.
 * - Aggiornare un token di attivazione esistente.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IAccountActivationTokenRepository
 * - Entità AccountActivationToken del dominio Registry
 *
 * Note
 * ----
 * Le operazioni di scrittura persistono immediatamente le modifiche sul database.
 * Il recupero del token valido applica direttamente a livello query
 * i vincoli di non utilizzo e non scadenza.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Registry
{
    public sealed class AccountActivationTokenRepository : IAccountActivationTokenRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire query e operazioni di persistenza sui token di attivazione account.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public AccountActivationTokenRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Persiste un nuovo token di attivazione account nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            AccountActivationToken token,
            CancellationToken cancellationToken = default)
        {
            // Inserisce la nuova entità nel DbContext.
            await _dbContext.AccountActivationTokens.AddAsync(token, cancellationToken).ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        /*
         * Recupera il token di attivazione corrispondente all'hash specificato
         * solo se il token risulta ancora valido.
         */
        public Task<AccountActivationToken?> GetValidByTokenHashAsync(
            string tokenHash,
            CancellationToken cancellationToken = default)
        {
            // Acquisisce il timestamp corrente UTC da usare
            // per verificare la scadenza del token direttamente nella query.
            var nowUtc = DateTime.UtcNow;

            // Restituisce il token solo se:
            // - l'hash corrisponde;
            // - il token non è già stato utilizzato;
            // - il token non è ancora scaduto.
            return _dbContext.AccountActivationTokens
                .FirstOrDefaultAsync(
                    t => t.TokenHash == tokenHash &&
                         t.UsedAtUtc == null &&
                         t.ExpiresAtUtc >= nowUtc,
                    cancellationToken);
        }

        /*
         * Aggiorna un token di attivazione esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            AccountActivationToken token,
            CancellationToken cancellationToken = default)
        {
            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.AccountActivationTokens.Update(token);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
