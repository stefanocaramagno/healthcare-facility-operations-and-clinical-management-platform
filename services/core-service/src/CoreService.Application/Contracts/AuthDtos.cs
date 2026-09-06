/*
 * File: services/core-service/src/CoreService.Application/Contracts/AuthDtos.cs
 *
 * Scopo
 * -----
 * Definire i DTO utilizzati dal dominio applicativo di autenticazione
 * per trasportare dati tra controller, service layer e client.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file raccoglie i contratti dati relativi ai principali workflow Auth:
 * registrazione, login, reset password, attivazione account e recupero
 * delle informazioni essenziali dell'utente autenticato.
 *
 * Responsabilità principali
 * -------------------------
 * - Definire i payload di input per le operazioni Auth.
 * - Definire i payload di output restituiti dal sistema.
 * - Centralizzare le annotazioni di validazione sui campi richiesti.
 *
 * Interazioni principali
 * ----------------------
 * - Controller Auth del Core Service
 * - Servizi applicativi del dominio Auth
 * - DataAnnotations per la validazione dei modelli
 *
 * Note
 * ----
 * Questi DTO non contengono logica di business:
 * rappresentano esclusivamente contratti dati del layer Application.
 */

using System;
using System.ComponentModel.DataAnnotations;

namespace CoreService.Application.Contracts
{
    /*
     * DTO di input usato per la registrazione di un nuovo utente Patient.
     */
    public sealed class RegisterPatientRequest
    {
        // Indirizzo e-mail del paziente da registrare.
        [Required]
        [EmailAddress]
        public string Email { get; init; } = string.Empty;

        // Password iniziale dell'account del paziente.
        [Required]
        [MinLength(8, ErrorMessage = "La password deve contenere almeno 8 caratteri.")]
        public string Password { get; init; } = string.Empty;

        // Nome del paziente.
        [Required]
        public string FirstName { get; init; } = string.Empty;

        // Cognome del paziente.
        [Required]
        public string LastName { get; init; } = string.Empty;

        // Data di nascita del paziente, espressa in UTC.
        [Required]
        public DateTime? DateOfBirthUtc { get; init; }

        // Numero di telefono del paziente.
        [Phone]
        public string? Phone { get; init; }

        // Indirizzo del paziente.
        public string? Address { get; init; }
    }

    /*
     * DTO di input usato per la registrazione di un nuovo utente Delegate.
     */
    public sealed class RegisterDelegateRequest
    {
        // Nome del delegato.
        [Required]
        public string FirstName { get; init; } = string.Empty;

        // Cognome del delegato.
        [Required]
        public string LastName { get; init; } = string.Empty;

        // Numero di telefono del delegato.
        [Phone]
        public string? Phone { get; init; }

        // Indirizzo del delegato.
        public string? Address { get; init; }

        // Indirizzo e-mail del delegato da registrare.
        [Required]
        [EmailAddress]
        public string Email { get; init; } = string.Empty;

        // Password iniziale dell'account del delegato.
        [Required]
        [MinLength(8, ErrorMessage = "La password deve contenere almeno 8 caratteri.")]
        public string Password { get; init; } = string.Empty;
    }

    /*
     * DTO di input usato per il workflow di login.
     */
    public sealed class LoginRequest
    {
        // Indirizzo e-mail dell'utente che tenta l'accesso.
        [Required]
        [EmailAddress]
        public string Email { get; init; } = string.Empty;

        // Password usata per l'autenticazione.
        [Required]
        public string Password { get; init; } = string.Empty;
    }

    /*
     * DTO di input usato per richiedere l'avvio del reset password.
     */
    public sealed class ForgotPasswordRequest
    {
        // Indirizzo e-mail dell'account per cui avviare il reset password.
        [Required]
        [EmailAddress]
        public string Email { get; init; } = string.Empty;
    }

    /*
     * DTO di input usato per completare il reset password.
     */
    public sealed class ResetPasswordRequest
    {
        // Token di reset password ricevuto dall'utente.
        [Required]
        public string Token { get; init; } = string.Empty;

        // Nuova password da impostare sull'account.
        [Required]
        [MinLength(8, ErrorMessage = "La password deve contenere almeno 8 caratteri.")]
        public string NewPassword { get; init; } = string.Empty;
    }

    /*
     * DTO di input usato per attivare un account tramite token.
     */
    public sealed class ActivateAccountRequest
    {
        // Token di attivazione account.
        [Required]
        public string Token { get; init; } = string.Empty;
    }

    /*
     * DTO di input usato per richiedere il reinvio dell'e-mail di attivazione.
     */
    public sealed class ResendActivationEmailRequest
    {
        // Indirizzo e-mail dell'account per cui reinviare l'attivazione.
        [Required]
        [EmailAddress]
        public string Email { get; init; } = string.Empty;
    }

    /*
     * DTO di output restituito in caso di login riuscito.
     */
    public sealed class AuthResponse
    {
        // Identificativo univoco dell'utente autenticato.
        public Guid UserId { get; init; }

        // Indirizzo e-mail dell'utente autenticato.
        public string Email { get; init; } = string.Empty;

        // Ruolo applicativo dell'utente autenticato.
        public string Role { get; init; } = string.Empty;

        // Token JWT di accesso rilasciato dal sistema.
        public string AccessToken { get; init; } = string.Empty;

        // Istante UTC di scadenza del token JWT.
        public DateTime ExpiresAtUtc { get; init; }
    }

    /*
     * DTO di output restituito dopo una registrazione completata
     * ma ancora in attesa di attivazione account.
     */
    public sealed class RegistrationPendingActivationResponse
    {
        // Identificativo univoco del nuovo utente registrato.
        public Guid UserId { get; init; }

        // Indirizzo e-mail del nuovo utente registrato.
        public string Email { get; init; } = string.Empty;

        // Ruolo applicativo del nuovo utente registrato.
        public string Role { get; init; } = string.Empty;

        // Indica se il workflow richiede attivazione prima del primo accesso.
        public bool ActivationRequired { get; init; }

        // Indica se l'account risulta già attivo.
        public bool IsActive { get; init; }

        // Messaggio descrittivo da mostrare al client.
        public string Message { get; init; } = string.Empty;
    }

    /*
     * DTO di output usato per rappresentare le informazioni essenziali
     * dell'utente autenticato corrente.
     */
    public sealed class MeResponse
    {
        // Identificativo univoco dell'utente corrente.
        public Guid Id { get; init; }

        // Indirizzo e-mail dell'utente corrente.
        public string Email { get; init; } = string.Empty;

        // Ruolo applicativo dell'utente corrente.
        public string Role { get; init; } = string.Empty;
    }
}
