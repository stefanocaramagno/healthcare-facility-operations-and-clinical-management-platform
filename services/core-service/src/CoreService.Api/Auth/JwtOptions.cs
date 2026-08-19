/*
 * File: services/core-service/src/CoreService.Api/Auth/JwtOptions.cs
 *
 * Scopo
 * -----
 * Definire le opzioni JWT del Core Service e fornire un meccanismo centralizzato
 * per costruirle a partire dalla configurazione applicativa e dalle variabili d'ambiente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe rappresenta la configurazione autorevole del sottosistema JWT
 * del Core Service. Viene utilizzata per garantire coerenza nella lettura
 * di issuer, secret e durata dei token tra emissione e validazione.
 *
 * Responsabilità principali
 * -------------------------
 * - Modellare i parametri essenziali della configurazione JWT.
 * - Validare i valori ricevuti in ingresso.
 * - Costruire un'istanza coerente a partire dalla configurazione applicativa.
 * - Applicare fallback sicuri e prevedibili quando la configurazione è assente o non valida.
 *
 * Interazioni principali
 * ----------------------
 * - IConfiguration
 * - Program.cs
 * - Componenti che emettono o validano token JWT
 *
 * Note
 * ----
 * La classe centralizza anche alcuni vincoli tecnici importanti,
 * come la lunghezza minima del secret per una firma HS256 coerente
 * tra i diversi servizi dell'architettura.
 */

using System;
using System.Globalization;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace CoreService.Api.Auth
{
    public sealed class JwtOptions
    {
        // Durata di default del token di accesso applicata quando
        // la configurazione non fornisce un valore valido.
        private static readonly TimeSpan DefaultAccessTokenLifetime = TimeSpan.FromMinutes(60);

        public string Issuer { get; }
        public string Secret { get; }
        public TimeSpan AccessTokenLifetime { get; }

        /*
         * Inizializza un nuovo oggetto JwtOptions validando issuer, secret
         * e durata del token prima di renderli disponibili in forma immutabile.
         */
        public JwtOptions(string issuer, string secret, TimeSpan accessTokenLifetime)
        {
            // L'issuer è obbligatorio perché identifica in modo coerente
            // il servizio emittente dei token all'interno dell'architettura.
            if (string.IsNullOrWhiteSpace(issuer))
            {
                throw new ArgumentException("JWT issuer mancante.", nameof(issuer));
            }

            // Il secret è obbligatorio perché costituisce il materiale crittografico
            // usato per la firma simmetrica dei token.
            if (string.IsNullOrWhiteSpace(secret))
            {
                throw new ArgumentException("JWT secret mancante.", nameof(secret));
            }

            // Verifica che il secret abbia almeno 32 byte UTF-8.
            // Questo vincolo evita configurazioni troppo deboli o incoerenti
            // per una firma HS256 condivisa tra i servizi.
            if (Encoding.UTF8.GetByteCount(secret) < 32)
            {
                throw new ArgumentException(
                    "JWT secret troppo corta. Configurare almeno 32 byte per una firma HS256 coerente tra tutti i servizi.",
                    nameof(secret));
            }

            // La durata del token deve essere positiva:
            // un valore nullo o negativo renderebbe la configurazione incoerente.
            if (accessTokenLifetime <= TimeSpan.Zero)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(accessTokenLifetime),
                    "La durata del token JWT deve essere maggiore di zero.");
            }

            // Salva le opzioni validate rendendole disponibili in modo immutabile.
            Issuer = issuer;
            Secret = secret;
            AccessTokenLifetime = accessTokenLifetime;
        }

        /*
         * Costruisce le opzioni JWT leggendo la configurazione applicativa
         * e applicando fallback di default quando alcuni valori sono assenti o non validi.
         */
        public static JwtOptions FromConfiguration(IConfiguration configuration)
        {
            // La configurazione è richiesta per costruire correttamente
            // le opzioni JWT del servizio.
            if (configuration is null)
            {
                throw new ArgumentNullException(nameof(configuration));
            }

            // Recupera l'issuer dando priorità alle variabili d'ambiente
            // e, in alternativa, alle chiavi del file di configurazione.
            var issuer = FirstNonEmpty(
                configuration["JWT_ISSUER"],
                configuration["Jwt:Issuer"]);

            // Recupera il secret JWT supportando più chiavi compatibili,
            // così da rendere il bootstrap più flessibile tra ambienti diversi.
            var secret = FirstNonEmpty(
                configuration["JWT_SECRET"],
                configuration["Jwt:Secret"],
                configuration["Jwt:SigningKey"]);

            // Recupera la durata del token in minuti, con priorità alla configurazione runtime
            // e fallback al valore di default della classe.
            var accessTokenLifetimeMinutesRaw = FirstNonEmpty(
                configuration["JWT_ACCESS_TOKEN_LIFETIME_MINUTES"],
                configuration["Jwt:AccessTokenLifetimeMinutes"],
                ((int)DefaultAccessTokenLifetime.TotalMinutes).ToString(CultureInfo.InvariantCulture));

            // Tenta il parsing della durata; in caso di valore non valido
            // o non positivo, applica la durata di default.
            if (!int.TryParse(accessTokenLifetimeMinutesRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var accessTokenLifetimeMinutes) ||
                accessTokenLifetimeMinutes <= 0)
            {
                accessTokenLifetimeMinutes = (int)DefaultAccessTokenLifetime.TotalMinutes;
            }

            // Costruisce l'istanza finale delle opzioni JWT,
            // normalizzando issuer e secret tramite Trim().
            return new JwtOptions(
                issuer.Trim(),
                secret.Trim(),
                TimeSpan.FromMinutes(accessTokenLifetimeMinutes));
        }

        /*
         * Restituisce il primo valore non nullo, non vuoto e non composto solo da spazi
         * tra quelli ricevuti in input.
         */
        private static string FirstNonEmpty(params string?[] values)
        {
            // Supporta la priorità tra più fonti/config key,
            // restituendo il primo valore realmente utilizzabile.
            foreach (var value in values)
            {
                if (!string.IsNullOrWhiteSpace(value))
                {
                    return value;
                }
            }

            // Se nessun valore utile è presente, restituisce stringa vuota.
            // L'eventuale invalidità verrà poi intercettata dal chiamante.
            return string.Empty;
        }
    }
}
