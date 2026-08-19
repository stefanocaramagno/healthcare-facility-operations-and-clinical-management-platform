/*
 * File: services/core-service/src/CoreService.Domain/Clinical/AnamnesisRecord.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta una registrazione anamnestica
 * associata a un encounter clinico.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e modella una singola annotazione anamnestica redatta durante
 * la gestione clinica del paziente.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente il record anamnestico.
 * - Collegare il record all'encounter clinico di riferimento.
 * - Conservare il contenuto testuale dell'anamnesi registrata.
 * - Tracciare il momento di creazione del record.
 * - Identificare l'utente che ha inserito il contenuto anamnestico.
 *
 * Note
 * ----
 * Questa entità rappresenta una singola unità informativa anamnestica
 * prodotta nel contesto di un encounter.
 * Più record anamnestici possono essere associati allo stesso encounter
 * per riflettere l'evoluzione o l'arricchimento progressivo della valutazione clinica.
 */

namespace CoreService.Domain.Clinical;

public sealed class AnamnesisRecord
{
    // Identificativo univoco del record anamnestico.
    public Guid Id { get; set; }

    // Identificativo dell'encounter clinico a cui l'anamnesi appartiene.
    public Guid EncounterId { get; set; }

    // Contenuto testuale dell'anamnesi registrata.
    public string Content { get; set; } = string.Empty;

    // Timestamp UTC di creazione del record anamnestico.
    public DateTime CreatedAtUtc { get; set; }

    // Identificativo dell'utente che ha creato il record anamnestico.
    public Guid CreatedByUserId { get; set; }
}

