/*
 * File: services/core-service/src/CoreService.Application/Auth/Options/AccountActivationFlowOptions.cs
 *
 * Scopo
 * -----
 * Definire le opzioni applicative che governano il flusso di attivazione account,
 * inclusi URL pubblico, path di conferma e durata del token.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Auth
 * e centralizza i parametri necessari per costruire correttamente
 * i link di attivazione inviati agli utenti durante il workflow
 * di registrazione e attivazione account.
 *
 * Responsabilità principali
 * -------------------------
 * - Conservare la configurazione del base URL pubblico.
 * - Conservare il path usato per la conferma di attivazione.
 * - Conservare la durata di validità del token di attivazione.
 * - Normalizzare i valori di input e applicare fallback sicuri.
 * - Costruire il link completo di conferma includendo il token codificato.
 *
 * Interazioni principali
 * ----------------------
 * - AccountActivationService
 * - Componenti che inviano e-mail di attivazione
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
    public sealed class AccountActivationFlowOptions
    {
        // URL pubblico base usato per costruire il link di conferma inviato all'utente.
        public string PublicBaseUrl { get; }

        // Path relativo dell'endpoint di conferma attivazione.
        public string ConfirmationPath { get; }

        // Durata di validità del token di attivazione account.
        public TimeSpan TokenLifetime { get; }

        /*
         * Inizializza le opzioni del flusso di attivazione account,
         * normalizzando i valori in ingresso e applicando fallback coerenti.
         */
        public AccountActivationFlowOptions(
            string publicBaseUrl,
            TimeSpan tokenLifetime,
            string confirmationPath = "/api/auth/activate/confirm")
        {
            // Normalizza il base URL pubblico, rimuovendo spazi e slash finali,
            // oppure applica un valore di fallback locale.
            PublicBaseUrl = string.IsNullOrWhiteSpace(publicBaseUrl)
                ? "http://localhost:8080"
                : publicBaseUrl.Trim().TrimEnd('/');

            // Normalizza il path di conferma, assicurando la presenza
            // dello slash iniziale oppure applicando il default previsto.
            ConfirmationPath = string.IsNullOrWhiteSpace(confirmationPath)
                ? "/api/auth/activate/confirm"
                : NormalizePath(confirmationPath);

            // Applica una durata di default di 24 ore quando il valore configurato
            // non è valido o non è strettamente positivo.
            TokenLifetime = tokenLifetime <= TimeSpan.Zero
                ? TimeSpan.FromHours(24)
                : tokenLifetime;
        }

        /*
         * Costruisce il link completo di conferma attivazione
         * includendo il token codificato come query parameter.
         */
        public string BuildConfirmationLink(string rawToken)
        {
            // Il token di attivazione deve essere presente per poter comporre il link.
            if (string.IsNullOrWhiteSpace(rawToken))
            {
                throw new ArgumentException("Il token di attivazione non può essere vuoto.", nameof(rawToken));
            }

            // Codifica il token per renderlo sicuro all'interno dell'URL.
            var encodedToken = Uri.EscapeDataString(rawToken.Trim());

            // Compone il link completo usando base URL, path di conferma e query string.
            return $"{PublicBaseUrl}{ConfirmationPath}?token={encodedToken}";
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
