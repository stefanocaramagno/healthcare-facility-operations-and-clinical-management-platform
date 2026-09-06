/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/DatabaseSettings.cs
 *
 * Scopo
 * -----
 * Definire un oggetto di configurazione centralizzato
 * per la gestione dei parametri di connessione ai database del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e ha il compito di:
 * - leggere i parametri di configurazione dal contesto di esecuzione;
 * - applicare valori di default ragionevoli in assenza di variabili ambiente;
 * - esporre in modo tipizzato i nomi dei database dei diversi bounded context;
 * - costruire le connection string da utilizzare dai componenti di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Incapsulare host, porta, credenziali e nomi dei database.
 * - Materializzare la configurazione a partire dalle variabili ambiente.
 * - Fornire un metodo uniforme per costruire la connection string
 *   di uno specifico database.
 *
 * Note
 * ----
 * La classe è pensata come value object infrastrutturale immutabile:
 * dopo la costruzione, le proprietà sono accessibili in sola lettura.
 */

using System.Globalization;

namespace CoreService.Infrastructure.Persistence;

public sealed class DatabaseSettings
{
    // Host del server database.
    public string Host { get; }

    // Porta TCP del server database.
    public int Port { get; }

    // Utente utilizzato per l'autenticazione verso il database.
    public string User { get; }

    // Password utilizzata per l'autenticazione verso il database.
    public string Password { get; }

    // Nome del database relativo al bounded context Registry.
    public string RegistryDatabase { get; }

    // Nome del database relativo al bounded context Scheduling.
    public string SchedulingDatabase { get; }

    // Nome del database relativo al bounded context Clinical.
    public string ClinicalDatabase { get; }

    // Nome del database relativo al bounded context Payments.
    public string PaymentsDatabase { get; }

    // Nome del database relativo al bounded context Events.
    public string EventsDatabase { get; }

    /*
     * Costruisce l'istanza immutabile contenente
     * tutti i parametri necessari alla connessione ai database.
     */
    private DatabaseSettings(
        string host,
        int port,
        string user,
        string password,
        string registryDatabase,
        string schedulingDatabase,
        string clinicalDatabase,
        string paymentsDatabase,
        string eventsDatabase)
    {
        Host = host;
        Port = port;
        User = user;
        Password = password;

        RegistryDatabase = registryDatabase;
        SchedulingDatabase = schedulingDatabase;
        ClinicalDatabase = clinicalDatabase;
        PaymentsDatabase = paymentsDatabase;
        EventsDatabase = eventsDatabase;
    }

    /*
     * Legge la configurazione dai valori presenti nelle variabili ambiente
     * e applica fallback di default quando necessario.
     */
    public static DatabaseSettings FromEnvironment()
    {
        // Recupera i parametri generali di connessione.
        var host = Environment.GetEnvironmentVariable("DB_HOST") ?? "mysql";
        var portRaw = Environment.GetEnvironmentVariable("DB_PORT") ?? "3306";
        var user = Environment.GetEnvironmentVariable("DB_USER") ?? "app_user";
        var password = Environment.GetEnvironmentVariable("DB_PASSWORD") ?? "app_password";

        // Recupera il nome del database Registry.
        // Per retrocompatibilità, se DB_REGISTRY_NAME non è valorizzata,
        // viene considerata anche la variabile generica DB_NAME.
        var registry = Environment.GetEnvironmentVariable("DB_REGISTRY_NAME")
                       ?? Environment.GetEnvironmentVariable("DB_NAME")
                       ?? "healthcare_registry";

        // Recupera i nomi dei database degli altri bounded context,
        // applicando per ciascuno un valore di default dedicato.
        var scheduling = Environment.GetEnvironmentVariable("DB_SCHEDULING_NAME") ?? "healthcare_scheduling";
        var clinical = Environment.GetEnvironmentVariable("DB_CLINICAL_NAME") ?? "healthcare_clinical";
        var payments = Environment.GetEnvironmentVariable("DB_PAYMENTS_NAME") ?? "healthcare_payments";
        var eventsDb = Environment.GetEnvironmentVariable("DB_EVENTS_NAME") ?? "healthcare_events";

        // Effettua il parsing robusto della porta usando cultura invariata.
        // In caso di valore non valido, viene usata la porta standard MySQL.
        if (!int.TryParse(portRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var port))
        {
            port = 3306;
        }

        return new DatabaseSettings(host, port, user, password, registry, scheduling, clinical, payments, eventsDb);
    }

    /*
     * Costruisce la connection string per il database specificato,
     * utilizzando i parametri generali correnti dell'istanza.
     */
    public string BuildConnectionString(string database)
    {
        return $"Server={Host};Port={Port};Database={database};User={User};Password={Password};SslMode=Preferred;Allow User Variables=true;";
    }
}
