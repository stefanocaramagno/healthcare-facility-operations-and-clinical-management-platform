/*
 * File: services/core-service/src/CoreService.Domain/Scheduling/AppointmentStatusChange.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta una variazione di stato
 * intervenuta nel ciclo di vita di un appuntamento.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Scheduling,
 * e modella il record storico di una transizione di stato applicata a un appuntamento.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente la singola variazione di stato.
 * - Collegare la variazione all'appuntamento di riferimento.
 * - Conservare lo stato precedente e lo stato successivo.
 * - Tracciare l'utente che ha effettuato la modifica.
 * - Tracciare il momento esatto della variazione.
 * - Conservare un'eventuale motivazione testuale della transizione.
 *
 * Note
 * ----
 * Questa entità è utile per audit, tracciabilità operativa
 * e ricostruzione cronologica del ciclo di vita dell'appuntamento.
 */

namespace CoreService.Domain.Scheduling;

public sealed class AppointmentStatusChange
{
    // Identificativo univoco del record di variazione di stato.
    public Guid Id { get; set; }

    // Identificativo dell'appuntamento a cui la variazione si riferisce.
    public Guid AppointmentId { get; set; }

    // Stato precedente dell'appuntamento prima della transizione.
    public AppointmentStatus FromStatus { get; set; }

    // Nuovo stato assunto dall'appuntamento dopo la transizione.
    public AppointmentStatus ToStatus { get; set; }

    // Identificativo dell'utente che ha effettuato il cambiamento di stato.
    public Guid ChangedByUserId { get; set; }

    // Timestamp UTC in cui la variazione di stato è stata registrata.
    public DateTime ChangedAtUtc { get; set; }

    // Motivazione opzionale associata alla transizione di stato.
    public string? Reason { get; set; }
}

