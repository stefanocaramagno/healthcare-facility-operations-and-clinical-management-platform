/*
 * File: services/core-service/src/CoreService.Domain/Scheduling/AppointmentStatus.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * i possibili stati del ciclo di vita di un appuntamento.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Scheduling,
 * e identifica in modo tipizzato le principali fasi
 * attraversate da un appuntamento nel sistema.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata gli stati supportati dal sistema.
 * - Consentire controlli applicativi coerenti sulle transizioni di stato.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza dello stato, evitando dipendenze dall'ordine implicito
 * dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Scheduling;

public enum AppointmentStatus
{
    // L'appuntamento è stato prenotato correttamente ed è in attesa delle fasi successive.
    Booked = 0,

    // Il paziente ha effettuato il check-in e l'appuntamento è pronto per la gestione clinica.
    CheckedIn = 1,

    // L'appuntamento è stato completato con successo.
    Completed = 2,

    // L'appuntamento è stato annullato prima della sua esecuzione.
    Canceled = 3,

    // Il paziente non si è presentato all'appuntamento previsto.
    NoShow = 4
}

