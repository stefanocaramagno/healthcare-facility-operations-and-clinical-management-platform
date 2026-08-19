/*
 * File: services/core-service/src/CoreService.Domain/Scheduling/ClinicianCalendar.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta il calendario associato a un clinico.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Scheduling,
 * e modella il contenitore logico degli slot di disponibilità
 * su cui vengono costruite le prenotazioni degli appuntamenti.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente il calendario clinico.
 * - Collegare il calendario al clinico proprietario.
 * - Definire il fuso orario di riferimento del calendario.
 * - Tracciare il timestamp di creazione del calendario.
 *
 * Note
 * ----
 * Questa entità rappresenta la radice logica a cui appartengono gli AvailabilitySlot
 * del clinico. Il fuso orario consente di interpretare correttamente
 * la presentazione e la gestione temporale delle disponibilità.
 */

namespace CoreService.Domain.Scheduling;

public sealed class ClinicianCalendar
{
    // Identificativo univoco del calendario clinico.
    public Guid Id { get; set; }

    // Identificativo dell'utente clinico proprietario del calendario.
    public Guid ClinicianUserId { get; set; }

    // Fuso orario di riferimento del calendario.
    public string TimeZone { get; set; } = "UTC";

    // Timestamp UTC di creazione del calendario.
    public DateTime CreatedAtUtc { get; set; }
}

