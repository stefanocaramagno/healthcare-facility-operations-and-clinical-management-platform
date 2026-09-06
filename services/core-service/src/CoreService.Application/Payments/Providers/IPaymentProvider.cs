/*
 * File: services/core-service/src/CoreService.Application/Payments/Providers/IPaymentProvider.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'interazione
 * con un provider di pagamento esterno o simulato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file appartiene al layer Application del dominio Payments
 * e contiene:
 * - i record che modellano i risultati restituiti dal provider;
 * - l'interfaccia tramite cui i servizi applicativi
 *   possono creare e processare Payment Intent
 *   senza dipendere dall'implementazione concreta del provider.
 *
 * Responsabilità principali
 * -------------------------
 * - Modellare l'esito della creazione di un Payment Intent lato provider.
 * - Modellare l'esito dell'elaborazione di un Payment Intent lato provider.
 * - Definire il contratto per la creazione di intent di pagamento.
 * - Definire il contratto per l'elaborazione di intent di pagamento.
 *
 * Interazioni principali
 * ----------------------
 * - PaymentCheckoutWorkflowService
 * - Implementazioni concrete del provider di pagamento
 * - Entità e stati del dominio Payments
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * su gateway o SDK specifici:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System.Threading;
using System.Threading.Tasks;
using CoreService.Domain.Payments;

namespace CoreService.Application.Payments.Providers
{
    /*
     * Modella il risultato restituito dal provider
     * in fase di creazione di un nuovo Payment Intent.
     */
    public sealed record PaymentProviderCreateIntentResult(
        string Provider,
        string ProviderIntentId,
        PaymentStatus InitialStatus,
        string ProviderTransactionId,
        string RawResponseJson
    );

    /*
     * Modella il risultato restituito dal provider
     * in fase di elaborazione di un Payment Intent esistente.
     */
    public sealed record PaymentProviderProcessResult(
        PaymentStatus Status,
        string ProviderTransactionId,
        string RawResponseJson
    );

    public interface IPaymentProvider
    {
        /*
         * Richiede al provider la creazione di un nuovo Payment Intent
         * per l'importo, la valuta e la chiave di idempotenza specificati.
         */
        Task<PaymentProviderCreateIntentResult> CreateIntentAsync(
            int amountCents,
            string currency,
            string idempotencyKey,
            CancellationToken cancellationToken = default);

        /*
         * Richiede al provider l'elaborazione di un Payment Intent già creato,
         * specificando eventuale metodo di pagamento.
         */
        Task<PaymentProviderProcessResult> ProcessIntentAsync(
            string providerIntentId,
            int amountCents,
            string currency,
            string? method,
            CancellationToken cancellationToken = default);
    }
}
