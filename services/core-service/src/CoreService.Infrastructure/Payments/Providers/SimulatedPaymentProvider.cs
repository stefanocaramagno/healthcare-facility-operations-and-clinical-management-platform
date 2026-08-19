/*
 * File: services/core-service/src/CoreService.Infrastructure/Payments/Providers/SimulatedPaymentProvider.cs
 *
 * Scopo
 * -----
 * Implementare un provider di pagamento simulato
 * per la gestione dei workflow di checkout e processamento
 * in ambienti di sviluppo, test o dimostrazione.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IPaymentProvider del layer Application.
 * Il suo compito è simulare il comportamento di un provider esterno di pagamento,
 * restituendo identificativi, stati iniziali e payload JSON coerenti
 * con il ciclo di vita atteso dal sistema,
 * senza effettuare integrazioni reali con servizi terzi.
 *
 * Responsabilità principali
 * -------------------------
 * - Simulare la creazione di un Payment Intent.
 * - Simulare l'avvio della fase di processamento di un Payment Intent.
 * - Generare identificativi provider fittizi ma realistici.
 * - Restituire payload JSON utili per audit, debugging e persistenza.
 *
 * Interazioni principali
 * ----------------------
 * - IPaymentProvider
 * - PaymentProviderCreateIntentResult
 * - PaymentProviderProcessResult
 * - Entità PaymentStatus del dominio Payments
 *
 * Note
 * ----
 * Il provider non interagisce con gateway di pagamento reali.
 * Tutti i risultati vengono prodotti localmente in modo deterministico
 * rispetto alla semantica del workflow applicativo,
 * pur utilizzando identificativi casuali per simulare risposte esterne realistiche.
 */

using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Payments.Providers;
using CoreService.Domain.Payments;

namespace CoreService.Infrastructure.Payments.Providers
{
    public sealed class SimulatedPaymentProvider : IPaymentProvider
    {
        /*
         * Simula la creazione di un nuovo Payment Intent presso un provider esterno,
         * restituendo un identificativo provider, una transazione iniziale
         * e lo stato CREATED.
         */
        public Task<PaymentProviderCreateIntentResult> CreateIntentAsync(
            int amountCents,
            string currency,
            string idempotencyKey,
            CancellationToken cancellationToken = default)
        {
            // Genera identificativi simulati che imitano
            // quelli normalmente restituiti da un gateway di pagamento reale.
            var providerIntentId = $"pi_sim_{Guid.NewGuid():N}";
            var providerTransactionId = $"tx_sim_create_{Guid.NewGuid():N}";

            // Costruisce un payload descrittivo della simulazione,
            // utile per persistenza, audit e debugging applicativo.
            var payload = new
            {
                provider = "SIMULATED",
                eventType = "intent.created",
                simulated = true,
                providerIntentId,
                providerTransactionId,
                amountCents,
                currency,
                idempotencyKey,
                status = "CREATED"
            };

            // Restituisce il risultato della simulazione
            // con stato iniziale Created e payload JSON serializzato.
            var result = new PaymentProviderCreateIntentResult(
                Provider: "SIMULATED",
                ProviderIntentId: providerIntentId,
                InitialStatus: PaymentStatus.Created,
                ProviderTransactionId: providerTransactionId,
                RawResponseJson: JsonSerializer.Serialize(payload));

            return Task.FromResult(result);
        }

        /*
         * Simula l'avvio del processamento di un Payment Intent esistente,
         * restituendo una transazione provider e lo stato PENDING.
         */
        public Task<PaymentProviderProcessResult> ProcessIntentAsync(
            string providerIntentId,
            int amountCents,
            string currency,
            string? method,
            CancellationToken cancellationToken = default)
        {
            // Normalizza il metodo di pagamento:
            // se non specificato, viene assunto CARD come fallback predefinito.
            var normalizedMethod = string.IsNullOrWhiteSpace(method)
                ? "CARD"
                : method.Trim().ToUpperInvariant();

            // Genera un identificativo simulato della transazione di processamento.
            var providerTransactionId = $"tx_sim_process_{Guid.NewGuid():N}";

            // Costruisce un payload descrittivo della fase di processamento simulata.
            var payload = new
            {
                provider = "SIMULATED",
                eventType = "payment.processing",
                simulated = true,
                providerIntentId,
                providerTransactionId,
                amountCents,
                currency,
                method = normalizedMethod,
                status = "PENDING"
            };

            // Restituisce il risultato della simulazione
            // con stato Pending e payload JSON serializzato.
            var result = new PaymentProviderProcessResult(
                Status: PaymentStatus.Pending,
                ProviderTransactionId: providerTransactionId,
                RawResponseJson: JsonSerializer.Serialize(payload));

            return Task.FromResult(result);
        }
    }
}
