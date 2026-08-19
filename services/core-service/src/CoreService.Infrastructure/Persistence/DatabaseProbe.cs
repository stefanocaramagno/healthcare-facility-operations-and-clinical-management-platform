/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/DatabaseProbe.cs
 *
 * Scopo
 * -----
 * Fornire un componente infrastrutturale leggero
 * per verificare la raggiungibilità dei database
 * utilizzati dai diversi bounded context del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure
 * e consente di eseguire semplici controlli di connettività
 * verso ciascun database configurato, restituendo un esito booleano
 * per ogni area funzionale dell'applicazione.
 *
 * Responsabilità principali
 * -------------------------
 * - Costruire le connection string dei database tramite DatabaseSettings.
 * - Verificare la raggiungibilità di tutti i database configurati.
 * - Eseguire una semplice query tecnica di probing su ogni database.
 * - Restituire un dizionario con l'esito del probe per ciascun contesto.
 *
 * Note
 * ----
 * Il componente ha finalità diagnostiche e operative.
 * Non contiene logica di business
 * e tratta ogni errore di connessione o query come esito negativo del probe.
 */

using MySqlConnector;

namespace CoreService.Infrastructure.Persistence;

public sealed class DatabaseProbe
{
    // Impostazioni centralizzate utilizzate per costruire
    // le connection string dei database da verificare.
    private readonly DatabaseSettings _settings;

    /*
     * Inizializza il componente di probing dei database
     * con le impostazioni infrastrutturali correnti.
     */
    public DatabaseProbe(DatabaseSettings settings)
    {
        _settings = settings;
    }

    /*
     * Esegue il probe di tutti i database configurati
     * e restituisce un dizionario che associa il nome logico del contesto
     * all'esito della verifica di connettività.
     */
    public async Task<IDictionary<string, bool>> ProbeAllAsync()
    {
        var results = new Dictionary<string, bool>
        {
            ["registry"] = await ProbeAsync(_settings.BuildConnectionString(_settings.RegistryDatabase)),
            ["scheduling"] = await ProbeAsync(_settings.BuildConnectionString(_settings.SchedulingDatabase)),
            ["clinical"] = await ProbeAsync(_settings.BuildConnectionString(_settings.ClinicalDatabase)),
            ["payments"] = await ProbeAsync(_settings.BuildConnectionString(_settings.PaymentsDatabase)),
            ["events"] = await ProbeAsync(_settings.BuildConnectionString(_settings.EventsDatabase))
        };

        return results;
    }

    /*
     * Esegue un probe tecnico su uno specifico database:
     * apre la connessione ed esegue una query minimale di test.
     *
     * In caso di eccezione, il database viene considerato non raggiungibile.
     */
    private static async Task<bool> ProbeAsync(string connectionString)
    {
        try
        {
            // Apre una connessione verso il database specificato
            // utilizzando la connection string fornita.
            await using var conn = new MySqlConnection(connectionString);
            await conn.OpenAsync();

            // Esegue una query minimale per verificare
            // che la connessione sia effettivamente operativa.
            await using var cmd = new MySqlCommand("SELECT 1;", conn);
            var result = await cmd.ExecuteScalarAsync();

            return result is not null;
        }
        catch
        {
            // Qualsiasi errore di connessione o esecuzione
            // viene interpretato come probe fallito.
            return false;
        }
    }
}
