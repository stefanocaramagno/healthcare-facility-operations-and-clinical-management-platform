/*
 * File: services/core-service/src/CoreService.Application/Auth/Security/PasswordSecurity.cs
 *
 * Scopo
 * -----
 * Fornire utilità condivise per la normalizzazione delle e-mail,
 * l'hashing delle password, la verifica delle password
 * e il calcolo dell'hash di token applicativi.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Auth
 * e centralizza le operazioni di sicurezza elementari usate
 * nei workflow di autenticazione e gestione credenziali.
 *
 * Responsabilità principali
 * -------------------------
 * - Normalizzare gli indirizzi e-mail in modo coerente.
 * - Generare hash sicuri delle password mediante PBKDF2.
 * - Verificare una password rispetto al suo hash persistito.
 * - Calcolare hash SHA-256 di token applicativi.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Auth
 * - Primitive crittografiche del framework .NET
 *
 * Note
 * ----
 * La classe non gestisce persistenza o trasporto dati:
 * fornisce esclusivamente primitive di sicurezza riutilizzabili
 * dal resto dell'applicazione.
 */

using System;
using System.Security.Cryptography;
using System.Text;

namespace CoreService.Application.Auth.Security
{
    public static class PasswordSecurity
    {
        /*
         * Normalizza un indirizzo e-mail rimuovendo spazi superflui
         * e convertendolo in minuscolo in maniera culture-invariant.
         */
        public static string NormalizeEmail(string email) =>
            (email ?? string.Empty).Trim().ToLowerInvariant();

        /*
         * Genera un hash sicuro della password usando PBKDF2 con SHA-256,
         * includendo salt casuale e numero di iterazioni nel formato persistito.
         */
        public static string HashPassword(string password)
        {
            // Dimensione del salt casuale espresso in byte.
            const int saltSize = 16;

            // Dimensione della chiave derivata espressa in byte.
            const int keySize = 32;

            // Numero di iterazioni PBKDF2 scelto per aumentare il costo computazionale.
            const int iterations = 100_000;

            // Genera un salt crittograficamente sicuro per rendere unico ogni hash.
            var salt = RandomNumberGenerator.GetBytes(saltSize);

            // Deriva l'hash della password a partire da password, salt e parametri scelti.
            var hash = Rfc2898DeriveBytes.Pbkdf2(
                password,
                salt,
                iterations,
                HashAlgorithmName.SHA256,
                keySize);

            // Restituisce una rappresentazione serializzata composta da:
            // iterazioni.saltBase64.hashBase64
            return string.Join(
                '.',
                iterations.ToString(),
                Convert.ToBase64String(salt),
                Convert.ToBase64String(hash));
        }

        /*
         * Verifica se una password in chiaro corrisponde all'hash persistito,
         * rieseguendo PBKDF2 con gli stessi parametri memorizzati.
         */
        public static bool VerifyPassword(string password, string passwordHash)
        {
            // Un hash mancante o vuoto non può essere verificato.
            if (string.IsNullOrWhiteSpace(passwordHash))
            {
                return false;
            }

            // Il formato atteso è: iterazioni.salt.hash
            var parts = passwordHash.Split('.', 3);
            if (parts.Length != 3)
            {
                return false;
            }

            // Estrae e valida il numero di iterazioni persistito.
            if (!int.TryParse(parts[0], out var iterations))
            {
                return false;
            }

            // Decodifica salt e hash atteso dalla rappresentazione Base64.
            var salt = Convert.FromBase64String(parts[1]);
            var expectedHash = Convert.FromBase64String(parts[2]);

            // Ricalcola l'hash della password fornita usando gli stessi parametri.
            var actualHash = Rfc2898DeriveBytes.Pbkdf2(
                password,
                salt,
                iterations,
                HashAlgorithmName.SHA256,
                expectedHash.Length);

            // Confronta i due hash in tempo costante per ridurre il rischio
            // di attacchi basati sul timing.
            return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
        }

        /*
         * Calcola l'hash SHA-256 di un token applicativo
         * per poterne memorizzare o confrontare una forma non in chiaro.
         */
        public static string ComputeTokenHash(string token)
        {
            // Crea un'istanza SHA-256 per il calcolo dell'impronta del token.
            using var sha256 = SHA256.Create();

            // Converte il token in sequenza di byte UTF-8, gestendo anche input null.
            var bytes = Encoding.UTF8.GetBytes(token ?? string.Empty);

            // Calcola l'hash del token.
            var hash = sha256.ComputeHash(bytes);

            // Restituisce la rappresentazione Base64 dell'hash risultante.
            return Convert.ToBase64String(hash);
        }
    }
}
