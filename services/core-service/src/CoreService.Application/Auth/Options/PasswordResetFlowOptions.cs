/*
 * File: services/core-service/src/CoreService.Application/Auth/Options/PasswordResetFlowOptions.cs
 *
 * Scopo
 * -----
 * Definire le opzioni applicative che governano il flusso di reset password,
 * inclusi URL frontend, path della pagina di reset e durata del token.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Auth
 * e centralizza i parametri necessari per costruire correttamente
 * i link di reset password inviati agli utenti durante il workflow
 * di recupero credenziali.
 *
 * Responsabilità principali
 * -------------------------
 * - Conservare la configurazione del base URL frontend.
 * - Conservare il path della pagina di reset password.
 * - Conservare la durata di validità del token di reset.
 * - Normalizzare i valori di input e applicare fallback sicuri.
 * - Costruire il link completo di reset includendo il token codificato.
 *
 * Interazioni principali
 * ----------------------
 * - AuthService
 * - Componenti che inviano e-mail di reset password
 * - Configurazione applicativa / variabili d'ambiente
 *
 * Note
 * ----
 * La classe non gestisce persistenza né invio e-mail:
 * rappresenta esclusivamente un contenitore configurazionale
 * con piccole utility di normalizzazione e composizione URL.
 */

using System;

namespace CoreService.Application.Auth.Options
{
    public sealed class PasswordResetFlowOptions
    {
        // URL base del frontend usato per costruire il link di reset inviato all'utente.
        public string FrontendBaseUrl { get; }

        // Path relativo della pagina frontend che gestisce il reset password.
        public string ResetPasswordPagePath { get; }

        // Durata di validità del token di reset password.
        public TimeSpan TokenLifetime { get; }

        /*
         * Inizializza le opzioni del flusso di reset password,
         * normalizzando i valori in ingresso e applicando fallback coerenti.
         */
        public PasswordResetFlowOptions(
            string frontendBaseUrl,
            TimeSpan tokenLifetime,
            string resetPasswordPagePath = "/pages/auth/reset-password.html")
        {
            // Normalizza il base URL del frontend, rimuovendo spazi e slash finali,
            // oppure applica un valore di fallback locale.
            FrontendBaseUrl = string.IsNullOrWhiteSpace(frontendBaseUrl)
                ? "http://localhost:8080"
                : frontendBaseUrl.Trim().TrimEnd('/');

            // Normalizza il path della pagina di reset, assicurando la presenza
            // dello slash iniziale oppure applicando il default previsto.
            ResetPasswordPagePath = string.IsNullOrWhiteSpace(resetPasswordPagePath)
                ? "/pages/auth/reset-password.html"
                : NormalizePath(resetPasswordPagePath);

            // Applica una durata di default di 1 ora quando il valore configurato
            // non è valido o non è strettamente positivo.
            TokenLifetime = tokenLifetime <= TimeSpan.Zero
                ? TimeSpan.FromHours(1)
                : tokenLifetime;
        }

        /*
         * Costruisce il link completo di reset password
         * includendo il token codificato come query parameter.
         */
        public string BuildResetLink(string rawToken)
        {
            // Il token di reset deve essere presente per poter comporre il link.
            if (string.IsNullOrWhiteSpace(rawToken))
            {
                throw new ArgumentException("Il token di reset non può essere vuoto.", nameof(rawToken));
            }

            // Codifica il token per renderlo sicuro all'interno dell'URL.
            var encodedToken = Uri.EscapeDataString(rawToken.Trim());

            // Compone il link completo usando base URL frontend, path della pagina
            // di reset e query string contenente il token.
            return $"{FrontendBaseUrl}{ResetPasswordPagePath}?token={encodedToken}";
        }

        /*
         * Normalizza un path assicurando che inizi con lo slash,
         * così da poter essere concatenato correttamente al base URL.
         */
        private static string NormalizePath(string value)
        {
            var path = value.Trim();
            return path.StartsWith('/') ? path : "/" + path;
        }
    }
}
