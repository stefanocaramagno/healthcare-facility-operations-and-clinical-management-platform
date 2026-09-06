/*
 * File: services/core-service/src/CoreService.Domain/Registry/DelegationStatus.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * i possibili stati di una delega tra paziente e delegato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Registry,
 * e identifica in modo tipizzato il ciclo di vita logico
 * di una delega registrata nel sistema.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata gli stati supportati dal sistema.
 * - Consentire i controlli di validità e utilizzabilità delle deleghe.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza dello stato, evitando dipendenze dall'ordine implicito
 * dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Registry;

public enum DelegationStatus
{
    // La delega è stata creata ma non è ancora attiva.
    Pending = 0,

    // La delega è attiva e può essere utilizzata, se anche temporalmente valida.
    Active = 1,

    // La delega è stata revocata e non può più essere utilizzata.
    Revoked = 2,

    // La delega ha superato il proprio intervallo di validità temporale.
    Expired = 3
}

