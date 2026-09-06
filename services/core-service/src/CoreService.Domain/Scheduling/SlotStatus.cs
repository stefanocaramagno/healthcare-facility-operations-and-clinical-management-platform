/*
 * File: services/core-service/src/CoreService.Domain/Scheduling/SlotStatus.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * i possibili stati operativi di uno slot di disponibilità.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Scheduling,
 * e identifica in modo tipizzato la condizione corrente
 * di uno slot presente nel calendario di un clinico.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata gli stati supportati dal sistema.
 * - Consentire controlli applicativi coerenti sulla prenotabilità degli slot.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza dello stato, evitando dipendenze dall'ordine implicito
 * dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Scheduling;

public enum SlotStatus
{
    // Lo slot è disponibile e può essere utilizzato per una nuova prenotazione.
    Available = 0,

    // Lo slot è riservato e risulta temporaneamente impegnato nel workflow di scheduling.
    Reserved = 1,

    // Lo slot non è disponibile e non può essere prenotato.
    Unavailable = 2
}

