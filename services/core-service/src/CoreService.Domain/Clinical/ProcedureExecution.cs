/*
 * File: services/core-service/src/CoreService.Domain/Clinical/ProcedureExecution.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta l'esecuzione
 * di una procedura o attività clinica associata a un ordine.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e modella il record operativo che documenta l'effettiva esecuzione
 * di una prestazione o procedura derivante da un ordine clinico.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente l'esecuzione procedurale.
 * - Collegare l'esecuzione all'ordine clinico di riferimento.
 * - Tracciare il momento in cui la procedura è stata effettuata.
 * - Identificare l'utente che ha eseguito la procedura.
 * - Conservare l'esito dell'esecuzione.
 * - Conservare eventuali note aggiuntive o operative.
 *
 * Note
 * ----
 * Questa entità rappresenta la concretizzazione operativa di un ordine clinico.
 * Può essere utilizzata per tracciare il completamento delle attività
 * e per alimentare i successivi workflow clinici e documentali.
 */

namespace CoreService.Domain.Clinical;

public sealed class ProcedureExecution
{
    // Identificativo univoco dell'esecuzione procedurale.
    public Guid Id { get; set; }

    // Identificativo dell'ordine clinico da cui deriva l'esecuzione.
    public Guid OrderId { get; set; }

    // Timestamp UTC del momento in cui la procedura è stata eseguita.
    public DateTime PerformedAtUtc { get; set; }

    // Identificativo dell'utente che ha eseguito o registrato la procedura.
    public Guid PerformedByUserId { get; set; }

    // Esito testuale dell'esecuzione procedurale.
    public string Outcome { get; set; } = string.Empty;

    // Note opzionali associate all'esecuzione.
    public string? Notes { get; set; }
}
