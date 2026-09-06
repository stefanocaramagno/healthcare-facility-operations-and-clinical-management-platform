/*
 * File: services/core-service/src/CoreService.Domain/Registry/ConsentType.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * le tipologie di consenso gestite dal sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Registry,
 * e identifica in modo tipizzato le diverse finalità
 * per cui un paziente può esprimere o negare il proprio consenso.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata i consensi supportati dal sistema.
 * - Consentire controlli applicativi coerenti sui consensi obbligatori e facoltativi.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza della tipologia di consenso,
 * evitando dipendenze dall'ordine implicito dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Registry;

public enum ConsentType
{
    // Consenso relativo al trattamento sanitario e alle attività cliniche.
    Treatment = 0,

    // Consenso relativo al trattamento dei dati personali necessari ai servizi applicativi.
    DataProcessing = 1,

    // Consenso facoltativo relativo a comunicazioni promozionali o di marketing.
    Marketing = 2
}

