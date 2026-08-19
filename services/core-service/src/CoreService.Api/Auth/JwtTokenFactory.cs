/*
 * File: services/core-service/src/CoreService.Api/Auth/JwtTokenFactory.cs
 *
 * Scopo
 * -----
 * Generare i token JWT di accesso del Core Service sulla base della configurazione
 * centralizzata e delle informazioni essenziali dell'utente autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe incapsula la logica tecnica di costruzione del token JWT,
 * separando la generazione del token dai servizi applicativi che gestiscono
 * autenticazione e login.
 *
 * Responsabilità principali
 * -------------------------
 * - Ricevere le opzioni JWT già validate dal bootstrap applicativo.
 * - Costruire i claim rilevanti del token di accesso.
 * - Firmare il token con chiave simmetrica HS256.
 * - Restituire sia il token serializzato sia la sua scadenza UTC.
 *
 * Interazioni principali
 * ----------------------
 * - JwtOptions
 * - Servizi applicativi di autenticazione
 * - Librerie Microsoft.IdentityModel.Tokens e System.IdentityModel.Tokens.Jwt
 *
 * Note
 * ----
 * Il token contiene sia claim standard JWT sia claim .NET/di compatibilità,
 * così da facilitare l'integrazione con i diversi componenti dell'architettura.
 */

using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace CoreService.Api.Auth
{
    public sealed class JwtTokenFactory
    {
        // Opzioni JWT condivise dal servizio, già validate in fase di bootstrap.
        private readonly JwtOptions _jwtOptions;

        /*
         * Inizializza il factory dei token JWT usando la configurazione
         * centralizzata del servizio.
         */
        public JwtTokenFactory(JwtOptions jwtOptions)
        {
            // Le opzioni JWT sono obbligatorie perché definiscono issuer,
            // secret e durata del token da emettere.
            _jwtOptions = jwtOptions ?? throw new ArgumentNullException(nameof(jwtOptions));
        }

        /*
         * Crea un token JWT di accesso per l'utente indicato e restituisce
         * sia il token serializzato sia la relativa scadenza UTC.
         */
        public (string AccessToken, DateTime ExpiresAtUtc) CreateToken(Guid userId, string email, string role)
        {
            // Calcola la scadenza assoluta del token sulla base della durata
            // configurata centralmente nel servizio.
            var expiresAtUtc = DateTime.UtcNow.Add(_jwtOptions.AccessTokenLifetime);

            // Costruisce la chiave simmetrica usata per firmare il token JWT.
            var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtOptions.Secret));

            // Definisce le credenziali di firma usando algoritmo HMAC SHA-256.
            var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

            // Costruisce l'insieme dei claim inseriti nel token.
            // Sono presenti:
            // - claim standard JWT come "sub" ed "email";
            // - claim .NET standard per identity e ruolo;
            // - claim "role" aggiuntivo per compatibilità applicativa.
            var claims = new List<Claim>
            {
                new(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new(JwtRegisteredClaimNames.Email, email),
                new(ClaimTypes.NameIdentifier, userId.ToString()),
                new(ClaimTypes.Role, role),
                new("role", role)
            };

            // Crea il token JWT specificando issuer, claim, validità temporale
            // e credenziali di firma.
            var token = new JwtSecurityToken(
                issuer: _jwtOptions.Issuer,
                audience: null,
                claims: claims,
                notBefore: DateTime.UtcNow,
                expires: expiresAtUtc,
                signingCredentials: credentials);

            // Serializza il token nel formato stringa trasmissibile al client.
            var tokenString = new JwtSecurityTokenHandler().WriteToken(token);

            // Restituisce il token di accesso insieme alla sua scadenza UTC,
            // utile per il chiamante e per eventuale UI/client awareness.
            return (tokenString, expiresAtUtc);
        }
    }
}
