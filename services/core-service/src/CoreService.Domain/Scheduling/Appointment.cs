/*
 * File: services/core-service/src/CoreService.Domain/Scheduling/Appointment.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta un appuntamento
 * prenotato nel sistema sanitario.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Scheduling,
 * e modella il record centrale che collega un paziente,
 * un clinico, uno slot di disponibilità e una prestazione richiesta.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente l'appuntamento.
 * - Collegare l'appuntamento allo slot prenotato.
 * - Collegare l'appuntamento al paziente e al clinico coinvolti.
 * - Rappresentare la prestazione associata all'appuntamento.
 * - Conservare l'importo quotato e la valuta applicata.
 * - Rappresentare lo stato corrente del ciclo di vita dell'appuntamento.
 * - Conservare eventuali note operative o contestuali.
 * - Tracciare i metadati temporali di creazione e aggiornamento.
 *
 * Note
 * ----
 * Questa entità è il riferimento principale per i workflow di prenotazione,
 * check-in, encounter clinico, pagamento e notifiche.
 * Lo stato dell'appuntamento governa la possibilità di eseguire
 * molte delle operazioni applicative del sistema.
 */

namespace CoreService.Domain.Scheduling;

public sealed class Appointment
{
    // Identificativo univoco dell'appuntamento.
    public Guid Id { get; set; }

    // Identificativo dello slot di agenda associato all'appuntamento.
    public Guid SlotId { get; set; }

    // Identificativo dell'utente paziente che ha prenotato l'appuntamento.
    public Guid PatientUserId { get; set; }

    // Identificativo dell'utente clinico assegnato all'appuntamento.
    public Guid ClinicianUserId { get; set; }

    // Identificativo della prestazione clinica richiesta.
    public Guid ServiceId { get; set; }

    // Codice applicativo della prestazione associata all'appuntamento.
    public string ServiceCode { get; set; } = string.Empty;

    // Importo quotato dell'appuntamento espresso in centesimi.
    public int QuotedPriceCents { get; set; }

    // Valuta applicata all'importo quotato.
    public string Currency { get; set; } = "EUR";

    // Stato corrente dell'appuntamento all'interno del suo ciclo di vita.
    public AppointmentStatus Status { get; set; }

    // Note opzionali associate all'appuntamento.
    public string? Notes { get; set; }

    // Timestamp UTC di creazione dell'appuntamento.
    public DateTime CreatedAtUtc { get; set; }

    // Timestamp UTC dell'ultima modifica apportata all'appuntamento.
    public DateTime UpdatedAtUtc { get; set; }
}

