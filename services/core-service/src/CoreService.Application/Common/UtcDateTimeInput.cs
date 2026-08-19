/*
 * File: services/core-service/src/CoreService.Application/Common/UtcDateTimeInput.cs
 *
 * Scopo
 * -----
 * Fornire una utility condivisa per normalizzare valori DateTime in UTC,
 * distinguendo tra campi obbligatori e campi opzionali.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application e centralizza una regola
 * trasversale di validazione/normalizzazione degli input temporali:
 * i valori devono essere espressi in modo non ambiguo rispetto al fuso orario,
 * così da poter essere gestiti coerentemente all'interno del sistema.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare e normalizzare un DateTime obbligatorio in UTC.
 * - Validare e normalizzare un DateTime opzionale in UTC.
 * - Rifiutare valori temporali con Kind non esplicito.
 * - Restituire un messaggio di errore coerente nei casi di input ambiguo.
 *
 * Interazioni principali
 * ----------------------
 * - Service layer del progetto
 * - DTO e request model che contengono campi DateTime
 *
 * Note
 * ----
 * La classe evita ambiguità sui fusi orari imponendo una semantica chiara:
 * sono accettati solo valori UTC o Local convertibili esplicitamente in UTC,
 * mentre i valori con Kind non specificato vengono rifiutati.
 */

using System;

namespace CoreService.Application.Common
{
    public static class UtcDateTimeInput
    {
        /*
         * Tenta di normalizzare in UTC un valore DateTime obbligatorio,
         * restituendo un errore se il valore è privo di informazione esplicita sul fuso orario.
         */
        public static bool TryNormalizeRequired(
            DateTime value,
            string fieldName,
            out DateTime utcValue,
            out string? errorMessage)
        {
            // Gestisce il valore in base al Kind del DateTime,
            // così da distinguere valori già UTC, valori locali convertibili
            // e valori ambigui privi di informazione temporale affidabile.
            switch (value.Kind)
            {
                case DateTimeKind.Utc:
                    // Se il valore è già UTC, può essere usato direttamente.
                    utcValue = value;
                    errorMessage = null;
                    return true;

                case DateTimeKind.Local:
                    // Se il valore è locale, viene convertito esplicitamente in UTC.
                    utcValue = value.ToUniversalTime();
                    errorMessage = null;
                    return true;

                default:
                    // I valori con Kind Unspecified vengono rifiutati
                    // per evitare ambiguità interpretative sul fuso orario.
                    utcValue = default;
                    errorMessage = $"Il campo '{fieldName}' deve essere espresso con offset esplicito oppure con suffisso 'Z' (UTC).";
                    return false;
            }
        }

        /*
         * Tenta di normalizzare in UTC un valore DateTime opzionale,
         * propagando il risultato nullo quando il campo non è valorizzato.
         */
        public static bool TryNormalizeOptional(
            DateTime? value,
            string fieldName,
            out DateTime? utcValue,
            out string? errorMessage)
        {
            // Inizializza l'output al caso base di valore assente.
            utcValue = null;
            errorMessage = null;

            // Se il campo opzionale non è valorizzato, il metodo considera l'input valido.
            if (!value.HasValue)
            {
                return true;
            }

            // Se il campo è presente, riusa la logica del metodo obbligatorio
            // per eseguire validazione e normalizzazione coerenti.
            if (!TryNormalizeRequired(value.Value, fieldName, out var normalized, out errorMessage))
            {
                return false;
            }

            // Se la normalizzazione ha successo, propaga il valore UTC risultante.
            utcValue = normalized;
            return true;
        }
    }
}
