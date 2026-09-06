/*
 * File: services/core-service/src/CoreService.Application/Auth/Abstractions/IAccountActivationEmailSender.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'invio delle e-mail
 * di attivazione account.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Auth
 * e rappresenta l'astrazione attraverso cui i servizi applicativi
 * richiedono l'invio di messaggi e-mail contenenti il link di attivazione
 * dell'account utente.
 *
 * Responsabilità principali
 * -------------------------
 * - Astrarre il meccanismo concreto di invio dell'e-mail di attivazione.
 * - Consentire al service layer di dipendere da un contratto e non da un'implementazione.
 * - Trasportare le informazioni minime necessarie per comporre il messaggio.
 *
 * Interazioni principali
 * ----------------------
 * - AccountActivationService
 * - Implementazioni infrastrutturali di invio e-mail
 * - Dependency Injection del progetto
 *
 * Note
 * ----
 * L'interfaccia non contiene logica applicativa né dettagli tecnici
 * sul trasporto del messaggio: definisce soltanto il contratto
 * che le implementazioni concrete devono rispettare.
 */

using System;
using System.Threading;
using System.Threading.Tasks;

namespace CoreService.Application.Auth.Abstractions
{
    public interface IAccountActivationEmailSender
    {
        /*
         * Invia un'e-mail di attivazione account all'indirizzo indicato,
         * includendo il link di attivazione e la relativa scadenza.
         */
        Task SendAccountActivationEmailAsync(
            string destinationEmail,
            string activationLink,
            DateTime expiresAtUtc,
            CancellationToken cancellationToken = default);
    }
}
