/*
 * File: services/core-service/src/CoreService.Domain/Clinical/ServiceCatalogItem.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta una prestazione
 * presente nel catalogo dei servizi clinici.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e modella una singola prestazione sanitaria o clinica
 * che può essere esposta nel catalogo applicativo
 * e successivamente associata a prenotazioni, ordini clinici o altri workflow di business.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente una prestazione del catalogo.
 * - Rappresentare codice, nome e descrizione della prestazione.
 * - Conservare il prezzo base espresso in centesimi.
 * - Conservare la valuta associata al prezzo.
 * - Indicare se la prestazione è attiva e quindi utilizzabile nei workflow applicativi.
 * - Tracciare i metadati temporali di creazione e aggiornamento.
 *
 * Note
 * ----
 * Questa entità rappresenta il riferimento centrale del catalogo clinico.
 * Le regole di esposizione al pubblico, ricerca, aggiornamento e utilizzo
 * vengono gestite nei servizi applicativi del layer Application.
 */

namespace CoreService.Domain.Clinical;

public sealed class ServiceCatalogItem
{
    // Identificativo univoco della prestazione di catalogo.
    public Guid Id { get; set; }

    // Codice applicativo o gestionale della prestazione.
    public string Code { get; set; } = string.Empty;

    // Nome descrittivo della prestazione.
    public string Name { get; set; } = string.Empty;

    // Descrizione opzionale della prestazione.
    public string? Description { get; set; }

    // Prezzo base della prestazione espresso in centesimi.
    public int BasePriceCents { get; set; }

    // Valuta associata al prezzo base della prestazione.
    public string Currency { get; set; } = "EUR";

    // Indica se la prestazione è attualmente attiva e utilizzabile.
    public bool IsActive { get; set; }

    // Timestamp UTC di creazione della prestazione nel catalogo.
    public DateTime CreatedAtUtc { get; set; }

    // Timestamp UTC dell'ultima modifica apportata alla prestazione.
    public DateTime UpdatedAtUtc { get; set; }
}

