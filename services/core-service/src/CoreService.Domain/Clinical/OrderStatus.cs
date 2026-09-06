/*
 * File: services/core-service/src/CoreService.Domain/Clinical/OrderStatus.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * i possibili stati del ciclo di vita di un ordine clinico.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e identifica in modo tipizzato le principali fasi
 * attraversate da un ordine clinico all'interno del sistema.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata gli stati supportati dal sistema.
 * - Consentire controlli applicativi coerenti sulle transizioni di stato degli ordini.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza dello stato, evitando dipendenze dall'ordine implicito
 * dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Clinical;

public enum OrderStatus
{
    // L'ordine clinico è stato creato ma non è ancora in esecuzione.
    Created = 0,

    // L'ordine clinico è stato preso in carico ed è in corso di esecuzione.
    InProgress = 1,

    // L'ordine clinico è stato completato con successo.
    Completed = 2,

    // L'ordine clinico è stato annullato e non deve più essere eseguito.
    Canceled = 3
}

