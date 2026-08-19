/*
 * File: services/core-service/src/CoreService.Application/Events/Abstractions/INotificationEmailSender.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'invio di notifiche tramite e-mail.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Events
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono richiedere l'invio di notifiche e-mail
 * senza dipendere da una specifica tecnologia o implementazione infrastrutturale.
 *
 * Responsabilità principali
 * -------------------------
 * - Esporre un'operazione di invio e-mail per notifiche applicative.
 * - Consentire ai servizi del layer Application di rimanere disaccoppiati
 *   dai dettagli tecnici del canale e-mail.
 *
 * Interazioni principali
 * ----------------------
 * - AdminNotificationsService
 * - Eventuali job o workflow di invio notifiche e-mail
 * - Implementazioni infrastrutturali del sender e-mail
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * su SMTP, provider esterni o librerie di invio:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System.Threading;
using System.Threading.Tasks;

namespace CoreService.Application.Events.Abstractions;

public interface INotificationEmailSender
{
    /*
     * Invia una notifica e-mail al destinatario specificato
     * con l'oggetto e il corpo forniti dal chiamante.
     */
    Task SendNotificationEmailAsync(
        string destinationEmail,
        string subject,
        string body,
        CancellationToken cancellationToken = default);
}

