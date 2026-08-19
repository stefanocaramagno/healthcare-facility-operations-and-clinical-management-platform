/*
 * File: services/core-service/src/CoreService.Domain/Events/NotificationStatus.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * i possibili stati del ciclo di vita di una notifica.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Events,
 * e identifica in modo tipizzato le principali fasi
 * attraversate da una notifica nel relativo workflow di pianificazione,
 * consegna e consultazione.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata gli stati supportati dal sistema.
 * - Consentire controlli applicativi coerenti sulla visibilità e trattabilità delle notifiche.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza dello stato, evitando dipendenze dall'ordine implicito
 * dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Events;

public enum NotificationStatus
{
    // La notifica è stata creata ma non è ancora stata inviata
    // o resa disponibile al destinatario.
    Pending = 0,

    // La notifica è stata inviata correttamente
    // oppure, nel caso di notifiche in-app, è già disponibile al destinatario.
    Sent = 1,

    // La notifica ha subito un errore durante il processo di consegna o lavorazione.
    Failed = 2,

    // La notifica è stata letta dal destinatario.
    Read = 3
}

