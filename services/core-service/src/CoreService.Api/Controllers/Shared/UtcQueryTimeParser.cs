/*
 * File: services/core-service/src/CoreService.Api/Controllers/Shared/UtcQueryTimeParser.cs
 *
 * Scopo
 * -----
 * Fornire una utility condivisa per il parsing dei parametri query opzionali
 * che rappresentano istanti temporali e che devono essere espressi in modo
 * non ambiguo rispetto al fuso orario.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe supporta i controller API che accettano filtri temporali
 * tramite query string, imponendo che la data/ora in ingresso includa
 * un offset esplicito oppure il suffisso UTC "Z".
 *
 * Responsabilità principali
 * -------------------------
 * - Validare il formato temporale ricevuto via query string.
 * - Rifiutare valori privi di offset esplicito.
 * - Convertire il valore valido in DateTime UTC.
 * - Restituire un BadRequest coerente in caso di input non valido.
 *
 * Interazioni principali
 * ----------------------
 * - Controller API che usano parametri temporali opzionali
 * - DateTimeOffset / parsing con CultureInfo.InvariantCulture
 * - ActionResult per la produzione uniforme dell'errore HTTP
 *
 * Note
 * ----
 * La finalità principale di questa utility è evitare ambiguità temporali
 * lato API, imponendo un formato esplicito e coerente per le date ricevute.
 */

using System;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Shared
{
    internal static class UtcQueryTimeParser
    {
        // Espressione regolare che verifica la presenza di un offset esplicito
        // finale nel valore temporale:
        // - "Z" per UTC
        // - "+HH:mm" oppure "-HH:mm" per offset espliciti.
        private static readonly Regex ExplicitOffsetRegex =
            new(@"(?:Z|[+-]\d{2}:\d{2})$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /*
         * Tenta di validare e convertire un parametro query opzionale in un DateTime UTC,
         * rifiutando valori privi di offset esplicito o non parseabili.
         */
        public static bool TryParseOptionalUtcQuery(
            string? rawValue,
            string parameterName,
            out DateTime? utcValue,
            out ActionResult? errorResult)
        {
            // Valori di output inizializzati al caso "nessun valore valido presente".
            utcValue = null;
            errorResult = null;

            // Se il parametro query è assente o vuoto, il parsing viene considerato valido
            // perché il parametro è opzionale.
            if (string.IsNullOrWhiteSpace(rawValue))
            {
                return true;
            }

            // Rifiuta subito valori temporali senza offset esplicito o suffisso UTC,
            // così da evitare interpretazioni ambigue lato server.
            if (!HasExplicitOffset(rawValue))
            {
                errorResult = BuildInvalidDateTimeResult(parameterName);
                return false;
            }

            // Esegue il parsing del valore come DateTimeOffset usando formato invariant
            // e semantica round-trip, così da preservare correttamente offset e istante.
            if (!DateTimeOffset.TryParse(
                rawValue,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var parsed))
            {
                errorResult = BuildInvalidDateTimeResult(parameterName);
                return false;
            }

            // Normalizza il valore in UTC per l'uso interno applicativo.
            utcValue = parsed.UtcDateTime;
            return true;
        }

        /*
         * Verifica se la stringa contiene un offset esplicito finale coerente
         * con i vincoli richiesti dall'API.
         */
        private static bool HasExplicitOffset(string rawValue)
            => ExplicitOffsetRegex.IsMatch(rawValue.Trim());

        /*
         * Costruisce una risposta HTTP 400 uniforme per segnalare
         * un parametro temporale espresso in formato non valido o ambiguo.
         */
        private static BadRequestObjectResult BuildInvalidDateTimeResult(string parameterName)
            => new(new
            {
                code = "invalid_datetime",
                message = $"Il parametro '{parameterName}' deve essere espresso con offset esplicito oppure con suffisso 'Z' (UTC)."
            });
    }
}
