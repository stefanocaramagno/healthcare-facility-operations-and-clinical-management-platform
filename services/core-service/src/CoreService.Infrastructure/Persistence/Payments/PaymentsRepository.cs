/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Payments/PaymentsRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * delle entità del bounded context Payments.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IPaymentsRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Payments.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare Payment Intent tramite identificativo, appuntamento o provider.
 * - Recuperare insiemi di Payment Intent tramite filtri applicativi.
 * - Persistire e aggiornare Payment Intent.
 * - Persistire Payment Transaction.
 * - Recuperare le transazioni associate a un determinato Payment Intent.
 *
 * Interazioni principali
 * ----------------------
 * - PaymentsDbContext
 * - IPaymentsRepository
 * - Entità PaymentIntent del dominio Payments
 * - Entità PaymentTransaction del dominio Payments
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
using CoreService.Application.Payments.Repositories;
using CoreService.Domain.Payments;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Payments
{
    public sealed class PaymentsRepository : IPaymentsRepository
    {
        // DbContext del bounded context Payments usato
        // per eseguire query e operazioni di persistenza su intent e transazioni.
        private readonly PaymentsDbContext _paymentsDbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Payments.
         */
        public PaymentsRepository(PaymentsDbContext paymentsDbContext)
        {
            _paymentsDbContext = paymentsDbContext
                ?? throw new ArgumentNullException(nameof(paymentsDbContext));
        }

        /*
         * Recupera un Payment Intent tramite il suo identificativo univoco.
         */
        public async Task<PaymentIntent?> GetIntentByIdAsync(
            Guid intentId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _paymentsDbContext.Intents
                .AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == intentId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera un Payment Intent associato a uno specifico appuntamento.
         */
        public async Task<PaymentIntent?> GetIntentByAppointmentIdAsync(
            Guid appointmentId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _paymentsDbContext.Intents
                .AsNoTracking()
                .SingleOrDefaultAsync(x => x.AppointmentId == appointmentId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera un Payment Intent tramite provider e provider intent identifier.
         */
        public async Task<PaymentIntent?> GetIntentByProviderAsync(
            string provider,
            string providerIntentId,
            CancellationToken cancellationToken = default)
        {
            // Se uno dei due identificativi logici non è valorizzato,
            // il repository evita un accesso inutile al database e restituisce null.
            if (string.IsNullOrWhiteSpace(provider) || string.IsNullOrWhiteSpace(providerIntentId))
            {
                return null;
            }

            // Normalizza gli input rimuovendo eventuali spazi superflui
            // prima di eseguire il confronto sul database.
            var normalizedProvider = provider.Trim();
            var normalizedProviderIntentId = providerIntentId.Trim();

            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _paymentsDbContext.Intents
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    x => x.Provider == normalizedProvider && x.ProviderIntentId == normalizedProviderIntentId,
                    cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera i Payment Intent associati a un insieme di appuntamenti.
         */
        public async Task<IReadOnlyList<PaymentIntent>> GetIntentsByAppointmentIdsAsync(
            IReadOnlyCollection<Guid> appointmentIds,
            CancellationToken cancellationToken = default)
        {
            // Se l'insieme di identificativi non è valorizzato o è vuoto,
            // il repository evita un accesso inutile al database e restituisce una collezione vuota.
            if (appointmentIds == null || appointmentIds.Count == 0)
            {
                return Array.Empty<PaymentIntent>();
            }

            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            return await _paymentsDbContext.Intents
                .AsNoTracking()
                .Where(x => appointmentIds.Contains(x.AppointmentId))
                .OrderBy(x => x.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo Payment Intent nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddIntentAsync(
            PaymentIntent intent,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (intent == null)
            {
                throw new ArgumentNullException(nameof(intent));
            }

            // Inserisce la nuova entità nel DbContext.
            _paymentsDbContext.Intents.Add(intent);

            // Salva immediatamente le modifiche sul database.
            await _paymentsDbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna un Payment Intent esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateIntentAsync(
            PaymentIntent intent,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (intent == null)
            {
                throw new ArgumentNullException(nameof(intent));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _paymentsDbContext.Intents.Update(intent);

            // Salva immediatamente le modifiche sul database.
            await _paymentsDbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste una nuova Payment Transaction nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddTransactionAsync(
            PaymentTransaction transaction,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (transaction == null)
            {
                throw new ArgumentNullException(nameof(transaction));
            }

            // Inserisce la nuova entità nel DbContext.
            _paymentsDbContext.Transactions.Add(transaction);

            // Salva immediatamente le modifiche sul database.
            await _paymentsDbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera tutte le transazioni associate a un determinato Payment Intent.
         */
        public async Task<IReadOnlyList<PaymentTransaction>> GetTransactionsForIntentAsync(
            Guid intentId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            return await _paymentsDbContext.Transactions
                .AsNoTracking()
                .Where(x => x.IntentId == intentId)
                .OrderBy(x => x.ProcessedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera i Payment Intent applicando i filtri opzionali richiesti.
         */
        public async Task<IReadOnlyList<PaymentIntent>> GetIntentsByFilterAsync(
            DateTime? fromUtc,
            DateTime? toUtc,
            PaymentStatus? status,
            string? provider,
            CancellationToken cancellationToken = default)
        {
            // Costruisce la query base in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            var query = _paymentsDbContext.Intents
                .AsNoTracking()
                .AsQueryable();

            // Applica, se presente, il filtro sulla data minima di creazione.
            if (fromUtc.HasValue)
            {
                query = query.Where(x => x.CreatedAtUtc >= fromUtc.Value);
            }

            // Applica, se presente, il filtro sulla data massima di creazione.
            if (toUtc.HasValue)
            {
                query = query.Where(x => x.CreatedAtUtc <= toUtc.Value);
            }

            // Applica, se presente, il filtro sullo stato del pagamento.
            if (status.HasValue)
            {
                var s = status.Value;
                query = query.Where(x => x.Status == s);
            }

            // Applica, se presente, il filtro sul provider.
            if (!string.IsNullOrWhiteSpace(provider))
            {
                query = query.Where(x => x.Provider == provider);
            }

            // Materializza il risultato ordinandolo cronologicamente.
            return await query
                .OrderBy(x => x.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }
    }
}
