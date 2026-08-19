/*
 * File: services/core-service/src/CoreService.Domain/Scheduling/AvailabilitySlot.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta uno slot di disponibilità
 * all'interno dell'agenda di un clinico.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Scheduling,
 * e modella una singola finestra temporale prenotabile o non prenotabile
 * associata a un calendario clinico.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente lo slot di disponibilità.
 * - Collegare lo slot al calendario clinico di appartenenza.
 * - Definire l'intervallo temporale coperto dallo slot.
 * - Rappresentare lo stato corrente dello slot.
 * - Tracciare il timestamp di creazione dello slot.
 *
 * Note
 * ----
 * Questa entità costituisce la base del processo di prenotazione:
 * gli appuntamenti vengono infatti associati a specifici slot di disponibilità.
 * Lo stato dello slot influisce direttamente sulla possibilità
 * di utilizzarlo o meno nei workflow applicativi.
 */

namespace CoreService.Domain.Scheduling;

public sealed class AvailabilitySlot
{
    // Identificativo univoco dello slot di disponibilità.
    public Guid Id { get; set; }

    // Identificativo del calendario clinico a cui lo slot appartiene.
    public Guid CalendarId { get; set; }

    // Timestamp UTC di inizio dello slot.
    public DateTime StartUtc { get; set; }

    // Timestamp UTC di fine dello slot.
    public DateTime EndUtc { get; set; }

    // Stato corrente dello slot, utilizzato per determinarne la disponibilità operativa.
    public SlotStatus Status { get; set; }

    // Timestamp UTC di creazione dello slot.
    public DateTime CreatedAtUtc { get; set; }
}

