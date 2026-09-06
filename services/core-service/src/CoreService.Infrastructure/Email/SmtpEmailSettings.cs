/*
 * File: services/core-service/src/CoreService.Infrastructure/Email/SmtpEmailSettings.cs
 *
 * Scopo
 * -----
 * Definire un oggetto di configurazione centralizzato
 * per la gestione dei parametri SMTP utilizzati dal sottosistema e-mail.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure
 * e ha il compito di:
 * - leggere i parametri SMTP dal contesto di esecuzione;
 * - applicare valori di default ragionevoli in assenza di variabili ambiente;
 * - esporre in modo tipizzato le impostazioni necessarie all'invio delle e-mail;
 * - normalizzare i valori opzionali legati alle credenziali SMTP.
 *
 * Responsabilità principali
 * -------------------------
 * - Incapsulare host, porta, credenziali, uso SSL e mittente SMTP.
 * - Materializzare la configurazione a partire dalle variabili ambiente.
 * - Normalizzare i valori opzionali per username e password.
 *
 * Note
 * ----
 * La classe è pensata come value object infrastrutturale immutabile:
 * dopo la costruzione, le proprietà sono accessibili in sola lettura.
 */

using System.Globalization;

namespace CoreService.Infrastructure.Email;

public sealed class SmtpEmailSettings
{
    // Host del server SMTP.
    public string Host { get; }

    // Porta TCP del server SMTP.
    public int Port { get; }

    // Username opzionale usato per l'autenticazione SMTP.
    public string? Username { get; }

    // Password opzionale usata per l'autenticazione SMTP.
    public string? Password { get; }

    // Indica se la connessione SMTP deve usare SSL/TLS.
    public bool UseSsl { get; }

    // Indirizzo e-mail del mittente usato dal sistema.
    public string FromEmail { get; }

    // Nome descrittivo del mittente usato dal sistema.
    public string FromName { get; }

    /*
     * Costruisce l'istanza immutabile contenente
     * tutti i parametri necessari alla configurazione SMTP.
     */
    private SmtpEmailSettings(
        string host,
        int port,
        string? username,
        string? password,
        bool useSsl,
        string fromEmail,
        string fromName)
    {
        Host = host;
        Port = port;
        Username = username;
        Password = password;
        UseSsl = useSsl;
        FromEmail = fromEmail;
        FromName = fromName;
    }

    /*
     * Legge la configurazione SMTP dalle variabili ambiente
     * e applica fallback di default quando necessario.
     */
    public static SmtpEmailSettings FromEnvironment()
    {
        // Recupera i parametri principali del server SMTP.
        var host = Environment.GetEnvironmentVariable("SMTP_HOST") ?? "mailpit";
        var portRaw = Environment.GetEnvironmentVariable("SMTP_PORT") ?? "1025";

        // Recupera e normalizza le credenziali opzionali.
        var username = NormalizeOptional(Environment.GetEnvironmentVariable("SMTP_USERNAME"));
        var password = NormalizeOptional(Environment.GetEnvironmentVariable("SMTP_PASSWORD"));

        // Recupera il flag relativo all'uso di SSL/TLS
        // e i dati del mittente applicativo.
        var useSslRaw = Environment.GetEnvironmentVariable("SMTP_USE_SSL") ?? "false";
        var fromEmail = Environment.GetEnvironmentVariable("SMTP_FROM_EMAIL") ?? "no-reply@healthcare.local";
        var fromName = Environment.GetEnvironmentVariable("SMTP_FROM_NAME") ?? "Healthcare Portal";

        // Effettua il parsing robusto della porta usando cultura invariata.
        // In caso di valore non valido, viene usata la porta SMTP locale di default prevista.
        if (!int.TryParse(portRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var port))
        {
            port = 1025;
        }

        // Interpreta il flag SSL come true solo se il parsing booleano ha successo
        // e il valore esplicito risulta vero.
        var useSsl = bool.TryParse(useSslRaw, out var parsedUseSsl) && parsedUseSsl;

        return new SmtpEmailSettings(
            host: host,
            port: port,
            username: username,
            password: password,
            useSsl: useSsl,
            fromEmail: fromEmail,
            fromName: fromName);
    }

    /*
     * Normalizza un valore stringa opzionale:
     * restituisce null se il contenuto è assente o composto solo da spazi,
     * altrimenti restituisce il valore ripulito tramite Trim().
     */
    private static string? NormalizeOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
