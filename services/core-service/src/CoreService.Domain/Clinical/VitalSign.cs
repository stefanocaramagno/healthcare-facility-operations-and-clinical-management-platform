/*
 * File: services/core-service/src/CoreService.Domain/Clinical/VitalSign.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta una rilevazione
 * di parametro vitale associata a un encounter clinico.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e modella una singola misurazione clinica effettuata durante
 * la presa in carico del paziente.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente la rilevazione del parametro vitale.
 * - Collegare la rilevazione all'encounter clinico di riferimento.
 * - Rappresentare la tipologia del parametro misurato.
 * - Conservare il valore numerico rilevato e la relativa unità di misura.
 * - Tracciare il momento in cui la misurazione è stata effettuata.
 * - Identificare l'utente che ha registrato la misurazione.
 *
 * Note
 * ----
 * Questa entità rappresenta una singola osservazione clinica strutturata.
 * Più rilevazioni possono essere associate allo stesso encounter
 * per descrivere in modo progressivo lo stato del paziente.
 */

namespace CoreService.Domain.Clinical;

public sealed class VitalSign
{
    // Identificativo univoco della rilevazione di parametro vitale.
    public Guid Id { get; set; }

    // Identificativo dell'encounter clinico a cui la rilevazione appartiene.
    public Guid EncounterId { get; set; }

    // Tipologia del parametro vitale misurato.
    public VitalSignType Type { get; set; }

    // Valore numerico della misurazione.
    public decimal Value { get; set; }

    // Unità di misura associata al valore rilevato.
    public string Unit { get; set; } = string.Empty;

    // Timestamp UTC del momento in cui la misurazione è stata effettuata.
    public DateTime MeasuredAtUtc { get; set; }

    // Identificativo dell'utente che ha registrato la misurazione.
    public Guid MeasuredByUserId { get; set; }
}

