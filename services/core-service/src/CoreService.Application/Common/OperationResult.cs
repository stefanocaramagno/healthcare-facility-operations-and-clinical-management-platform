/*
 * File: services/core-service/src/CoreService.Application/Common/OperationResult.cs
 *
 * Scopo
 * -----
 * Definire un contenitore standardizzato per rappresentare l'esito
 * delle operazioni applicative, sia nei casi di successo sia nei casi di errore.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe costituisce un contratto comune del layer Application
 * per restituire ai chiamanti un risultato uniforme, comprensivo di:
 * stato di successo/fallimento, codice HTTP logico, eventuale payload
 * e dettagli di errore semanticamente significativi.
 *
 * Responsabilità principali
 * -------------------------
 * - Incapsulare il valore di ritorno di un'operazione applicativa.
 * - Distinguere in modo esplicito successo e fallimento.
 * - Trasportare codice di stato, codice errore e messaggio errore.
 * - Fornire factory methods semplificati per i casi più comuni.
 * - Offrire proprietà di supporto per verificare rapidamente la tipologia di errore.
 *
 * Interazioni principali
 * ----------------------
 * - Service layer del progetto
 * - Controller API che traducono l'esito in risposta HTTP
 * - DTO e modelli applicativi restituiti come valore
 *
 * Note
 * ----
 * Questa classe non è legata a uno specifico dominio funzionale:
 * è una utility trasversale del layer Application usata per uniformare
 * la gestione degli esiti in tutto il sistema.
 */

using System;

namespace CoreService.Application.Common
{
    public sealed class OperationResult<T>
    {
        // Indica se l'operazione si è conclusa correttamente.
        public bool IsSuccess { get; }

        // Indica se l'operazione è fallita.
        public bool IsFailure => !IsSuccess;

        // Codice di stato logico associato all'esito dell'operazione.
        public int StatusCode { get; }

        // Codice applicativo dell'errore, valorizzato solo nei casi di fallimento.
        public string? ErrorCode { get; }

        // Messaggio descrittivo dell'errore, valorizzato solo nei casi di fallimento.
        public string? ErrorMessage { get; }

        // Payload dell'operazione, valorizzato tipicamente nei casi di successo.
        public T? Value { get; }

        // Shortcut booleane utili per controllare rapidamente la categoria di errore.
        public bool IsForbidden => IsFailure && StatusCode == 403;
        public bool IsNotFound => IsFailure && StatusCode == 404;
        public bool IsBadRequest => IsFailure && StatusCode == 400;
        public bool IsConflict => IsFailure && StatusCode == 409;
        public bool IsServerError => IsFailure && StatusCode >= 500 && StatusCode < 600;

        /*
         * Inizializza una nuova istanza del risultato operativo
         * con tutti gli elementi necessari a rappresentarne l'esito.
         */
        private OperationResult(
            bool isSuccess,
            int statusCode,
            string? errorCode,
            string? errorMessage,
            T? value)
        {
            // Salva in modo immutabile tutte le informazioni rilevanti
            // che descrivono l'esito dell'operazione.
            IsSuccess = isSuccess;
            StatusCode = statusCode;
            ErrorCode = errorCode;
            ErrorMessage = errorMessage;
            Value = value;
        }

        /*
         * Costruisce un risultato di successo contenente il valore prodotto
         * dall'operazione applicativa.
         */
        public static OperationResult<T> Success(T value)
        {
            // Nei casi di successo il codice logico di default è 200
            // e non sono presenti dettagli di errore.
            return new OperationResult<T>(
                isSuccess: true,
                statusCode: 200,
                errorCode: null,
                errorMessage: null,
                value: value);
        }

        /*
         * Costruisce un risultato di fallimento generico
         * con codice di stato, codice errore e messaggio descrittivo.
         */
        public static OperationResult<T> Failure(int statusCode, string errorCode, string errorMessage)
        {
            // Il codice errore è obbligatorio per garantire
            // una gestione consistente lato controller e client.
            if (string.IsNullOrWhiteSpace(errorCode))
            {
                throw new ArgumentException("Il codice di errore non può essere nullo o vuoto.", nameof(errorCode));
            }

            // Anche il messaggio di errore è obbligatorio,
            // così da fornire un contesto leggibile sull'anomalia.
            if (string.IsNullOrWhiteSpace(errorMessage))
            {
                throw new ArgumentException("Il messaggio di errore non può essere nullo o vuoto.", nameof(errorMessage));
            }

            // Nei casi di fallimento il valore è assente
            // e vengono valorizzati i dettagli dell'errore.
            return new OperationResult<T>(
                isSuccess: false,
                statusCode: statusCode,
                errorCode: errorCode,
                errorMessage: errorMessage,
                value: default);
        }

        /*
         * Costruisce un risultato di fallimento corrispondente
         * a un accesso non consentito.
         */
        public static OperationResult<T> Forbidden(string errorCode, string errorMessage)
        {
            return Failure(403, errorCode, errorMessage);
        }

        /*
         * Costruisce un risultato di fallimento corrispondente
         * a una risorsa non trovata.
         */
        public static OperationResult<T> NotFound(string errorCode, string errorMessage)
        {
            return Failure(404, errorCode, errorMessage);
        }

        /*
         * Costruisce un risultato di fallimento corrispondente
         * a una richiesta non valida.
         */
        public static OperationResult<T> BadRequest(string errorCode, string errorMessage)
        {
            return Failure(400, errorCode, errorMessage);
        }

        /*
         * Costruisce un risultato di fallimento corrispondente
         * a un conflitto applicativo.
         */
        public static OperationResult<T> Conflict(string errorCode, string errorMessage)
        {
            return Failure(409, errorCode, errorMessage);
        }

        /*
         * Costruisce un risultato di fallimento corrispondente
         * a un errore interno del server.
         */
        public static OperationResult<T> ServerError(string errorCode, string errorMessage)
        {
            return Failure(500, errorCode, errorMessage);
        }
    }
}
