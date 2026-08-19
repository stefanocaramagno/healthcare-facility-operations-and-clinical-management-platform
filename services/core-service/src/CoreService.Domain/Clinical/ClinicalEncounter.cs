/*
 * File: services/core-service/src/CoreService.Domain/Clinical/ClinicalEncounter.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta un encounter clinico,
 * ossia l'episodio operativo associato alla presa in carico del paziente
 * durante uno specifico appuntamento.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e modella il contenitore logico principale delle attività cliniche svolte
 * nel corso di una visita o interazione sanitaria.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente l'encounter clinico.
 * - Collegare l'encounter all'appuntamento da cui ha origine.
 * - Collegare l'encounter al paziente e al clinico coinvolti.
 * - Tracciare l'inizio e l'eventuale conclusione dell'episodio clinico.
 * - Conservare eventuali note generali associate all'encounter.
 * - Tracciare il timestamp di creazione del record.
 *
 * Note
 * ----
 * Questa entità rappresenta la radice logica del percorso clinico operativo:
 * anamnesi, parametri vitali, ordini, esecuzioni e referti
 * vengono infatti collegati all'encounter di riferimento.
 * La presenza o assenza di EndedAtUtc consente inoltre di distinguere
 * encounter ancora aperti da encounter già conclusi.
 */

namespace CoreService.Domain.Clinical;

public sealed class ClinicalEncounter
{
    // Identificativo univoco dell'encounter clinico.
    public Guid Id { get; set; }

    // Identificativo dell'appuntamento da cui l'encounter ha origine.
    public Guid AppointmentId { get; set; }

    // Identificativo dell'utente paziente coinvolto nell'encounter.
    public Guid PatientUserId { get; set; }

    // Identificativo dell'utente clinico responsabile dell'encounter.
    public Guid ClinicianUserId { get; set; }

    // Timestamp UTC di avvio dell'encounter clinico.
    public DateTime StartedAtUtc { get; set; }

    // Timestamp UTC di conclusione dell'encounter.
    // Rimane nullo finché l'encounter è ancora aperto.
    public DateTime? EndedAtUtc { get; set; }

    // Note generali opzionali associate all'encounter clinico.
    public string? Notes { get; set; }

    // Timestamp UTC di creazione del record di encounter.
    public DateTime CreatedAtUtc { get; set; }
}

