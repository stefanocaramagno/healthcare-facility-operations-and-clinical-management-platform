/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/RevokedAccessTokenRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità RevokedAccessToken del bounded context Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IRevokedAccessTokenRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Registry.
 *
 * Responsabilità principali
 * -------------------------
 * - Persistire un nuovo token revocato.
 * - Evitare inserimenti duplicati dello stesso token revocato.
 * - Verificare se un token revocato risulta ancora attivo rispetto alla sua scadenza.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IRevokedAccessTokenRepository
 * - Entità RevokedAccessToken del dominio Registry
 *
 * Note
 * ----
 * Le operazioni di lettura utilizzano AsNoTracking() per evitare
 * il tracking non necessario da parte di Entity Framework Core
 * nei casi di semplice consultazione.
 * L'inserimento del token revocato è idempotente rispetto all'hash del token:
 * se il record esiste già, il repository non esegue un nuovo inserimento.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Registry
{
    public sealed class RevokedAccessTokenRepository : IRevokedAccessTokenRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire query e operazioni di persistenza sui token revocati.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public RevokedAccessTokenRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Persiste un nuovo token revocato nel database
         * solo se non esiste già un record con lo stesso hash.
         */
        public async Task AddAsync(
            RevokedAccessToken revokedToken,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (revokedToken is null)
            {
                throw new ArgumentNullException(nameof(revokedToken));
            }

            // Verifica preventivamente se esiste già un record
            // con lo stesso hash del token, così da rendere l'operazione idempotente.
            var alreadyExists = await _dbContext.RevokedAccessTokens
                .AsNoTracking()
                .AnyAsync(x => x.TokenHash == revokedToken.TokenHash, cancellationToken)
                .ConfigureAwait(false);

            // Se il token revocato è già presente, non viene effettuato alcun nuovo inserimento.
            if (alreadyExists)
            {
                return;
            }

            // Inserisce la nuova entità nel DbContext.
            await _dbContext.RevokedAccessTokens
                .AddAsync(revokedToken, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        /*
         * Verifica se esiste un token revocato con l'hash specificato
         * che risulta ancora attivo rispetto alla sua data di scadenza.
         */
        public Task<bool> ExistsActiveByTokenHashAsync(
            string tokenHash,
            CancellationToken cancellationToken = default)
        {
            // Se l'hash non è valorizzato, il repository evita
            // un accesso inutile al database e restituisce immediatamente false.
            if (string.IsNullOrWhiteSpace(tokenHash))
            {
                return Task.FromResult(false);
            }

            // Acquisisce il timestamp corrente UTC da usare
            // per verificare che la revoca sia ancora rilevante rispetto alla scadenza del token.
            var nowUtc = DateTime.UtcNow;

            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice verifica di esistenza.
            return _dbContext.RevokedAccessTokens
                .AsNoTracking()
                .AnyAsync(
                    x => x.TokenHash == tokenHash && x.ExpiresAtUtc >= nowUtc,
                    cancellationToken);
        }
    }
}
