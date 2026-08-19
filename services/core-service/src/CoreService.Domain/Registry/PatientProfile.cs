/*
 * File: services/core-service/src/CoreService.Domain/Registry/PatientProfile.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta il profilo anagrafico
 * e di contatto associato a un utente con ruolo Patient.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Registry,
 * e modella le informazioni personali principali del paziente
 * complementari rispetto all'account applicativo di base.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare i dati anagrafici essenziali del paziente.
 * - Mantenere il collegamento logico con l'entità User tramite UserId.
 * - Conservare eventuali recapiti e informazioni di contatto.
 * - Tracciare i metadati temporali di creazione e aggiornamento del profilo.
 *
 * Note
 * ----
 * Questa entità contiene i dati di profilo specifici del paziente.
 * Le informazioni strettamente legate all'autenticazione e all'autorizzazione
 * restano invece responsabilità dell'entità User.
 */

namespace CoreService.Domain.Registry;

public sealed class PatientProfile
{
    // Identificativo univoco del profilo paziente.
    public Guid Id { get; set; }

    // Identificativo dell'utente applicativo a cui il profilo appartiene.
    public Guid UserId { get; set; }

    // Nome del paziente.
    public string FirstName { get; set; } = string.Empty;

    // Cognome del paziente.
    public string LastName { get; set; } = string.Empty;

    // Data di nascita del paziente espressa in UTC.
    public DateTime DateOfBirthUtc { get; set; }

    // Numero di telefono del paziente, se disponibile.
    public string? Phone { get; set; }

    // Indirizzo del paziente, se disponibile.
    public string? Address { get; set; }

    // Timestamp UTC di creazione del profilo.
    public DateTime CreatedAtUtc { get; set; }

    // Timestamp UTC dell'ultima modifica del profilo.
    public DateTime UpdatedAtUtc { get; set; }
}

