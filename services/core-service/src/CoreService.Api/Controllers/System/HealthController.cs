/*
 * File: services/core-service/src/CoreService.Api/Controllers/System/HealthController.cs
 *
 * Scopo
 * -----
 * Esporre l'endpoint di health del Core Service, verificando la disponibilità
 * dei database logici necessari al corretto funzionamento del backend.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller fornisce una vista sintetica dello stato operativo
 * del Core Service dal punto di vista della persistenza, permettendo
 * a gateway, strumenti di monitoraggio o ambienti di orchestrazione
 * di verificare rapidamente la salute del servizio.
 *
 * Responsabilità principali
 * -------------------------
 * - Ricevere la richiesta HTTP di health check.
 * - Delegare al DatabaseProbe la verifica delle connessioni ai database.
 * - Costruire un payload descrittivo dello stato del servizio.
 * - Restituire 200 OK oppure 503 Service Unavailable in base all'esito della verifica.
 *
 * Interazioni principali
 * ----------------------
 * - DatabaseProbe
 * - ASP.NET Core MVC
 * - Endpoint /health del Core Service
 *
 * Note
 * ----
 * Questo controller non verifica la correttezza funzionale dei domini applicativi,
 * ma la raggiungibilità dei database su cui il servizio basa le proprie operazioni.
 */

using CoreService.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers;

// Controller API dedicato all'esposizione della health del Core Service.
[ApiController]
[Route("health")]
public class HealthController : ControllerBase
{
    // Componente infrastrutturale incaricato di verificare lo stato
    // dei database logici utilizzati dal backend.
    private readonly DatabaseProbe _db;

    /*
     * Inizializza il controller di health con il componente incaricato
     * di sondare la disponibilità dei database del servizio.
     */
    public HealthController(DatabaseProbe db)
    {
        // Il probe del database è una dipendenza essenziale per questo endpoint,
        // poiché la health del servizio viene calcolata proprio a partire da esso.
        _db = db;
    }

    /*
     * Esegue il controllo di health del Core Service e restituisce
     * lo stato aggregato delle dipendenze database.
     */
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        // Esegue la verifica di tutti i database configurati nel Core Service
        // e ottiene una mappa nome-database -> esito booleano.
        var dbResults = await _db.ProbeAllAsync();

        // Il servizio viene considerato sano solo se tutte le dipendenze database
        // risultano raggiungibili e operative.
        var allOk = dbResults.Values.All(x => x);

        // Costruisce il payload JSON di health,
        // includendo nome del servizio, esito globale, timestamp UTC
        // e dettaglio delle verifiche sui database.
        var payload = new
        {
            service = "core-service",
            ok = allOk,
            timeUtc = DateTime.UtcNow.ToString("O"),
            databases = dbResults
        };

        // Restituisce:
        // - 200 OK se tutte le verifiche sono positive;
        // - 503 Service Unavailable se almeno una dipendenza risulta non disponibile.
        return allOk ? Ok(payload) : StatusCode(StatusCodes.Status503ServiceUnavailable, payload);
    }
}
