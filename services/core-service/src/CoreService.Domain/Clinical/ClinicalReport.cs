/*
 * File: services/core-service/src/CoreService.Domain/Clinical/ClinicalReport.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta il referto clinico
 * associato a un encounter.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e modella il documento clinico conclusivo o intermedio
 * redatto nell'ambito di uno specifico encounter.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente il referto clinico.
 * - Collegare il referto all'encounter di riferimento.
 * - Rappresentare lo stato corrente del referto nel suo ciclo di vita.
 * - Conservare il contenuto testuale del referto.
 * - Conservare eventuali metadati di firma e integrità documentale.
 * - Tracciare informazioni temporali e soggettive relative a firma e pubblicazione.
 * - Tracciare il timestamp di creazione del referto.
 *
 * Note
 * ----
 * Questa entità supporta un workflow documentale strutturato,
 * che può comprendere almeno le fasi di bozza, firma e pubblicazione.
 * I campi relativi a hash e firma consentono di rappresentare
 * meccanismi di integrità e sottoscrizione del contenuto.
 */

namespace CoreService.Domain.Clinical;

public sealed class ClinicalReport
{
    // Identificativo univoco del referto clinico.
    public Guid Id { get; set; }

    // Identificativo dell'encounter clinico a cui il referto appartiene.
    public Guid EncounterId { get; set; }

    // Stato corrente del referto nel relativo workflow documentale.
    public ClinicalReportStatus Status { get; set; }

    // Contenuto testuale principale del referto clinico.
    public string Content { get; set; } = string.Empty;

    // Hash opzionale del contenuto del referto, utile per verifiche di integrità.
    public string? ContentHash { get; set; }

    // Tipologia o algoritmo di firma eventualmente applicato al referto.
    public string? SignatureType { get; set; }

    // Payload opzionale contenente i dettagli della firma applicata.
    public string? SignaturePayload { get; set; }

    // Timestamp UTC del momento in cui il referto è stato firmato.
    public DateTime? SignedAtUtc { get; set; }

    // Identificativo dell'utente che ha firmato il referto.
    public Guid? SignedByUserId { get; set; }

    // Timestamp UTC del momento in cui il referto è stato pubblicato.
    public DateTime? PublishedAtUtc { get; set; }

    // Identificativo dell'utente che ha pubblicato il referto.
    public Guid? PublishedByUserId { get; set; }

    // Timestamp UTC di creazione del referto clinico.
    public DateTime CreatedAtUtc { get; set; }
}

