/*
 * File: services/core-service/src/CoreService.Domain/Registry/ClinicianProfile.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta il profilo anagrafico
 * e professionale associato a un utente con ruolo Clinician.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Registry,
 * e modella le informazioni personali e professionali principali del clinico,
 * complementari rispetto all'account applicativo di base.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare i dati anagrafici essenziali del clinico.
 * - Mantenere il collegamento logico con l'entità User tramite UserId.
 * - Conservare le informazioni professionali rilevanti del clinico.
 * - Conservare eventuali recapiti e informazioni di contatto.
 * - Tracciare i metadati temporali di creazione e aggiornamento del profilo.
 *
 * Note
 * ----
 * Questa entità contiene i dati di profilo specifici del clinico.
 * Le informazioni strettamente legate all'autenticazione e all'autorizzazione
 * restano invece responsabilità dell'entità User.
 */

namespace CoreService.Domain.Registry;

public sealed class ClinicianProfile
{
    // Identificativo univoco del profilo clinico.
    public Guid Id { get; set; }

    // Identificativo dell'utente applicativo a cui il profilo appartiene.
    public Guid UserId { get; set; }

    // Nome del clinico.
    public string FirstName { get; set; } = string.Empty;

    // Cognome del clinico.
    public string LastName { get; set; } = string.Empty;

    // Numero di telefono del clinico, se disponibile.
    public string? Phone { get; set; }

    // Specializzazione professionale del clinico.
    public string Specialty { get; set; } = string.Empty;

    // Numero di iscrizione professionale o identificativo abilitativo del clinico.
    public string LicenseNumber { get; set; } = string.Empty;

    // Sede operativa principale del clinico, se disponibile.
    public string? OfficeLocation { get; set; }

    // Timestamp UTC di creazione del profilo.
    public DateTime CreatedAtUtc { get; set; }

    // Timestamp UTC dell'ultima modifica del profilo.
    public DateTime UpdatedAtUtc { get; set; }
}
