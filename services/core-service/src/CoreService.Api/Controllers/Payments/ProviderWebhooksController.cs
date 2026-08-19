/*
 * File: services/core-service/src/CoreService.Api/Controllers/Payments/ProviderWebhooksController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint dedicati alla ricezione dei webhook del provider di pagamento,
 * limitatamente al flusso simulato previsto dal sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per gli eventi webhook
 * provenienti dal provider simulato di pagamento. Consente al backend
 * di ricevere notifiche tecniche interne e tradurle in aggiornamenti
 * del relativo PaymentIntent.
 *
 * Responsabilità principali
 * -------------------------
 * - Ricevere il webhook simulato del provider di pagamento.
 * - Verificare che la richiesta provenga da un servizio interno autorizzato.
 * - Delegare al service layer la gestione dell'evento webhook.
 * - Tradurre gli esiti del workflow in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PaymentWebhookService
 * - Variabili d'ambiente per il secret interno
 * - Header HTTP X-Internal-Service-Secret
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller non contiene logica di business sui pagamenti:
 * verifica il requisito minimo di trust della chiamata e delega
 * il processamento effettivo al servizio applicativo specializzato.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Payments.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Payments
{
    [ApiController]
    [Route("payments/provider/webhooks")]
    public sealed class ProviderWebhooksController : ControllerBase
    {
        // Header usato per autenticare le richieste interne dirette
        // verso il webhook simulato del provider.
        private const string InternalServiceSecretHeader = "X-Internal-Service-Secret";

        // Servizio applicativo incaricato della gestione degli eventi webhook
        // provenienti dal provider simulato.
        private readonly PaymentWebhookService _paymentWebhookService;

        /*
         * Inizializza il controller dei webhook provider
         * con il servizio applicativo responsabile della loro gestione.
         */
        public ProviderWebhooksController(PaymentWebhookService paymentWebhookService)
        {
            _paymentWebhookService = paymentWebhookService
                ?? throw new ArgumentNullException(nameof(paymentWebhookService));
        }

        /*
         * Gestisce il webhook simulato del provider di pagamento,
         * previa verifica del secret interno di servizio.
         */
        [AllowAnonymous]
        [HttpPost("simulated")]
        public async Task<ActionResult<PaymentIntentDto>> HandleSimulatedWebhook(
            [FromBody] SimulatedPaymentWebhookRequest? request,
            CancellationToken cancellationToken)
        {
            // Il webhook simulato è accettato solo da chiamate interne autorizzate.
            if (!HasValidInternalServiceSecret())
            {
                return Unauthorized(new
                {
                    code = "invalid_internal_service_secret",
                    message = "Richiesta non autorizzata."
                });
            }

            // Delega al service layer la gestione dell'evento webhook simulato.
            var result = await _paymentWebhookService
                .HandleSimulatedWebhookAsync(request, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            return Ok(result.Value);
        }

        /*
         * Verifica che la richiesta corrente contenga il secret interno corretto,
         * richiesto per accedere al webhook simulato.
         */
        private bool HasValidInternalServiceSecret()
        {
            // Recupera il secret interno configurato a runtime.
            var configuredSecret = Environment.GetEnvironmentVariable("INTERNAL_SERVICE_SECRET")?.Trim() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(configuredSecret))
            {
                return false;
            }

            // Recupera il secret fornito dalla richiesta tramite header dedicato
            // e lo confronta in modo esatto con quello configurato.
            var providedSecret = Request.Headers[InternalServiceSecretHeader].ToString().Trim();
            return !string.IsNullOrWhiteSpace(providedSecret)
                && string.Equals(providedSecret, configuredSecret, StringComparison.Ordinal);
        }
    }
}
