/*
 * File: services/core-service/src/CoreService.Infrastructure/Email/SmtpNotificationEmailSender.cs
 *
 * Scopo
 * -----
 * Implementare il sender infrastrutturale responsabile
 * dell'invio di notifiche e-mail generiche tramite protocollo SMTP.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia INotificationEmailSender del layer Application.
 * Il suo compito è tradurre la richiesta applicativa di invio
 * di una notifica e-mail
 * in una consegna effettiva tramite server SMTP configurato.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare i parametri minimi necessari all'invio dell'e-mail.
 * - Costruire il messaggio e-mail HTML a partire da oggetto e corpo testuale.
 * - Configurare il client SMTP in base alle impostazioni infrastrutturali.
 * - Eseguire l'invio dell'e-mail verso il destinatario richiesto.
 *
 * Interazioni principali
 * ----------------------
 * - SmtpEmailSettings
 * - INotificationEmailSender
 * - SmtpClient / MailMessage del framework .NET
 *
 * Note
 * ----
 * La classe delega la configurazione del canale SMTP all'oggetto SmtpEmailSettings.
 * Il corpo HTML viene costruito in modo centralizzato tramite un metodo dedicato,
 * così da mantenere separata la logica di composizione del contenuto
 * dalla logica di invio del messaggio.
 */

using System;
using System.Net;
using System.Net.Mail;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Events.Abstractions;

namespace CoreService.Infrastructure.Email;

public sealed class SmtpNotificationEmailSender : INotificationEmailSender
{
    // Impostazioni SMTP centralizzate usate
    // per configurare il mittente e il client di invio.
    private readonly SmtpEmailSettings _settings;

    /*
     * Inizializza il sender con le impostazioni SMTP necessarie
     * per l'invio delle notifiche e-mail generiche.
     */
    public SmtpNotificationEmailSender(SmtpEmailSettings settings)
    {
        _settings = settings
            ?? throw new ArgumentNullException(nameof(settings));
    }

    /*
     * Invia una notifica e-mail HTML al destinatario specificato.
     */
    public async Task SendNotificationEmailAsync(
        string destinationEmail,
        string subject,
        string body,
        CancellationToken cancellationToken = default)
    {
        // Verifica che l'indirizzo e-mail del destinatario sia valorizzato.
        if (string.IsNullOrWhiteSpace(destinationEmail))
        {
            throw new ArgumentException("L'e-mail del destinatario è obbligatoria.", nameof(destinationEmail));
        }

        // Verifica che l'oggetto dell'e-mail sia valorizzato.
        if (string.IsNullOrWhiteSpace(subject))
        {
            throw new ArgumentException("L'oggetto dell'e-mail è obbligatorio.", nameof(subject));
        }

        // Verifica che il corpo del messaggio sia valorizzato.
        if (string.IsNullOrWhiteSpace(body))
        {
            throw new ArgumentException("Il corpo dell'e-mail è obbligatorio.", nameof(body));
        }

        // Interrompe l'operazione prima di allocare ulteriori risorse
        // se è già stata richiesta la cancellazione.
        cancellationToken.ThrowIfCancellationRequested();

        // Costruisce il messaggio e-mail completo,
        // configurando mittente, oggetto, encoding e corpo HTML.
        using var message = new MailMessage
        {
            From = new MailAddress(_settings.FromEmail, _settings.FromName),
            Subject = subject.Trim(),
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = true,
            Body = BuildHtmlBody(subject, body)
        };

        // Aggiunge il destinatario normalizzando l'input tramite Trim().
        message.To.Add(new MailAddress(destinationEmail.Trim()));

        // Configura il client SMTP utilizzando le impostazioni infrastrutturali correnti.
        using var client = new SmtpClient(_settings.Host, _settings.Port)
        {
            DeliveryMethod = SmtpDeliveryMethod.Network,
            EnableSsl = _settings.UseSsl,
            UseDefaultCredentials = false
        };

        // Se sono presenti credenziali SMTP esplicite,
        // le applica al client di invio.
        if (!string.IsNullOrWhiteSpace(_settings.Username))
        {
            client.Credentials = new NetworkCredential(_settings.Username, _settings.Password ?? string.Empty);
        }

        // Esegue l'invio effettivo dell'e-mail.
        await client.SendMailAsync(message).ConfigureAwait(false);
    }

    /*
     * Costruisce il corpo HTML dell'e-mail di notifica
     * a partire da oggetto e contenuto testuale libero.
     */
    private static string BuildHtmlBody(string subject, string body)
    {
        // Esegue l'encoding HTML dell'oggetto
        // per evitare problemi di rendering o injection nel markup.
        var encodedSubject = WebUtility.HtmlEncode(subject.Trim());

        // Esegue l'encoding HTML del corpo testuale
        // e converte gli a-capo in tag HTML di interruzione riga.
        var encodedBody = WebUtility.HtmlEncode(body.Trim())
            .Replace("\r\n", "<br/>", StringComparison.Ordinal)
            .Replace("\n", "<br/>", StringComparison.Ordinal);

        return $@"
<!doctype html>
<html lang=""it"">
  <body style=""margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;"">
    <div style=""max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;"">
      <div style=""font-size:22px;font-weight:700;margin-bottom:12px;"">Healthcare Portal</div>
      <div style=""font-size:18px;font-weight:600;margin-bottom:12px;"">{encodedSubject}</div>
      <div style=""margin:0;line-height:1.7;font-size:15px;color:#334155;"">{encodedBody}</div>
      <p style=""margin:24px 0 0 0;color:#64748b;line-height:1.6;font-size:13px;"">
        Questa comunicazione è stata generata dal portale della struttura sanitaria.
      </p>
    </div>
  </body>
</html>";
    }
}
