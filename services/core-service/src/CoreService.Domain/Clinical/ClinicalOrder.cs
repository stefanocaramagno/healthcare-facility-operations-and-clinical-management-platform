/*
 * File: services/core-service/src/CoreService.Domain/Clinical/ClinicalOrder.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta un ordine clinico
 * emesso nell'ambito di un encounter.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e modella una richiesta operativa o prestazionale associata
 * al percorso clinico del paziente durante uno specifico encounter.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente l'ordine clinico.
 * - Collegare l'ordine all'encounter in cui è stato generato.
 * - Collegare l'ordine alla voce di catalogo clinico richiesta.
 * - Rappresentare lo stato corrente dell'ordine.
 * - Conservare eventuali note operative o contestuali.
 * - Tracciare il momento di creazione dell'ordine.
 * - Identificare l'utente che ha emesso l'ordine.
 *
 * Note
 * ----
 * Questa entità rappresenta un elemento centrale del workflow clinico operativo:
 * a partire da essa possono derivare una o più esecuzioni procedurali
 * e il suo stato viene utilizzato dai servizi applicativi
 * per governarne il ciclo di vita.
 */

namespace CoreService.Domain.Clinical;

public sealed class ClinicalOrder
{
    // Identificativo univoco dell'ordine clinico.
    public Guid Id { get; set; }

    // Identificativo dell'encounter clinico a cui l'ordine appartiene.
    public Guid EncounterId { get; set; }

    // Identificativo della voce di catalogo clinico richiesta tramite questo ordine.
    public Guid CatalogItemId { get; set; }

    // Stato corrente dell'ordine clinico nel suo ciclo di vita operativo.
    public OrderStatus Status { get; set; }

    // Note opzionali associate all'ordine clinico.
    public string? Notes { get; set; }

    // Timestamp UTC di creazione dell'ordine clinico.
    public DateTime CreatedAtUtc { get; set; }

    // Identificativo dell'utente che ha creato l'ordine clinico.
    public Guid CreatedByUserId { get; set; }
}

