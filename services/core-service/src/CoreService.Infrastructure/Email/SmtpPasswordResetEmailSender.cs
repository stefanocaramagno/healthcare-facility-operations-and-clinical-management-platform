/*
 * File: services/core-service/src/CoreService.Infrastructure/Email/SmtpPasswordResetEmailSender.cs
 *
 * Scopo
 * -----
 * Implementare il sender infrastrutturale responsabile
 * dell'invio delle e-mail di reimpostazione password tramite protocollo SMTP.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IPasswordResetEmailSender del layer Application.
 * Il suo compito è tradurre la richiesta applicativa di invio
 * di una e-mail di reset password
 * in una consegna effettiva tramite server SMTP configurato.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare i parametri minimi necessari all'invio dell'e-mail.
 * - Costruire il messaggio e-mail HTML di reimpostazione password.
 * - Configurare il client SMTP in base alle impostazioni infrastrutturali.
 * - Eseguire l'invio dell'e-mail verso il destinatario richiesto.
 *
 * Interazioni principali
 * ----------------------
 * - SmtpEmailSettings
 * - IPasswordResetEmailSender
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
using CoreService.Application.Auth.Abstractions;

namespace CoreService.Infrastructure.Email;

public sealed class SmtpPasswordResetEmailSender : IPasswordResetEmailSender
{
    // Impostazioni SMTP centralizzate usate
    // per configurare il mittente e il client di invio.
    private readonly SmtpEmailSettings _settings;

    /*
     * Inizializza il sender con le impostazioni SMTP necessarie
     * per l'invio delle e-mail di reimpostazione password.
     */
    public SmtpPasswordResetEmailSender(SmtpEmailSettings settings)
    {
        _settings = settings
          ?? throw new ArgumentNullException(nameof(settings));
    }

    /*
     * Invia una e-mail HTML di reimpostazione password al destinatario specificato.
     */
    public async Task SendPasswordResetEmailAsync(
        string destinationEmail,
        string resetLink,
        DateTime expiresAtUtc,
        CancellationToken cancellationToken = default)
    {
        // Verifica che l'indirizzo e-mail del destinatario sia valorizzato.
        if (string.IsNullOrWhiteSpace(destinationEmail))
        {
            throw new ArgumentException("L'e-mail del destinatario è obbligatoria.", nameof(destinationEmail));
        }

        // Verifica che il link di reset sia valorizzato.
        if (string.IsNullOrWhiteSpace(resetLink))
        {
            throw new ArgumentException("Il link di reset è obbligatorio.", nameof(resetLink));
        }

        // Interrompe l'operazione prima di allocare ulteriori risorse
        // se è già stata richiesta la cancellazione.
        cancellationToken.ThrowIfCancellationRequested();

        // Costruisce il messaggio e-mail completo,
        // configurando mittente, oggetto, encoding e corpo HTML.
        using var message = new MailMessage
        {
            From = new MailAddress(_settings.FromEmail, _settings.FromName),
            Subject = "Reimpostazione password | Healthcare Portal",
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = true,
            Body = BuildHtmlBody(resetLink, expiresAtUtc)
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
     * Costruisce il corpo HTML dell'e-mail di reimpostazione password,
     * includendo link di reset e data di scadenza del token.
     */
    private static string BuildHtmlBody(string resetLink, DateTime expiresAtUtc)
    {
        // Esegue l'encoding HTML del link
        // per evitare problemi di rendering o injection nel markup.
        var encodedLink = WebUtility.HtmlEncode(resetLink);

        // Converte la scadenza in orario locale e la formatta
        // per la visualizzazione nel template dell'e-mail.
        var expirationText = expiresAtUtc.ToLocalTime().ToString("dd/MM/yyyy HH:mm");

        return $@"
<!doctype html>
<html lang=""it"">
  <body style=""margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;"">
    <div style=""max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;"">
      <div style=""font-size:22px;font-weight:700;margin-bottom:12px;"">Healthcare Portal</div>
      <div style=""font-size:18px;font-weight:600;margin-bottom:12px;"">Reimpostazione password</div>
      <p style=""margin:0 0 16px 0;line-height:1.6;"">
        Abbiamo ricevuto una richiesta di reimpostazione della password associata al tuo account.
      </p>
      <p style=""margin:0 0 20px 0;line-height:1.6;"">
        Per proseguire, utilizza il pulsante seguente. Il link resterà valido fino a <strong>{WebUtility.HtmlEncode(expirationText)}</strong>.
      </p>
      <p style=""margin:0 0 24px 0;"">
        <a href=""{encodedLink}"" style=""display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;"">
          Reimposta password
        </a>
      </p>
      <p style=""margin:0 0 12px 0;line-height:1.6;"">
        Se il pulsante non fosse disponibile, copia e incolla questo link nel browser:
      </p>
      <p style=""margin:0 0 16px 0;word-break:break-all;color:#1d4ed8;line-height:1.6;"">{encodedLink}</p>
      <p style=""margin:0;color:#475569;line-height:1.6;font-size:14px;"">
        Se non hai richiesto tu questa operazione, puoi ignorare l'e-mail: la password corrente resterà invariata.
      </p>
    </div>
  </body>
</html>";
    }
}
