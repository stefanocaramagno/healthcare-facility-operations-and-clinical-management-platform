/*
 * File: services/core-service/src/CoreService.Domain/Clinical/PreTriageQuestionnaire.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta il questionario di pre-triage
 * compilato dal paziente in relazione a uno specifico appuntamento.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e modella il contenuto informativo raccolto prima della visita,
 * utile ai workflow clinici e alla preparazione dell'incontro sanitario.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente il questionario di pre-triage.
 * - Collegare il questionario all'appuntamento di riferimento.
 * - Collegare il questionario al paziente che lo ha compilato.
 * - Conservare il contenuto testuale del questionario.
 * - Tracciare i metadati temporali di creazione e aggiornamento.
 *
 * Note
 * ----
 * Questa entità rappresenta il record applicativo del pre-triage
 * associato alla prenotazione. La validazione di accesso,
 * consultazione e aggiornamento del questionario
 * viene demandata ai servizi del layer Application.
 */

using System;

namespace CoreService.Domain.Clinical
{
    public sealed class PreTriageQuestionnaire
    {
        // Identificativo univoco del questionario di pre-triage.
        public Guid Id { get; set; }

        // Identificativo dell'appuntamento a cui il questionario si riferisce.
        public Guid AppointmentId { get; set; }

        // Identificativo dell'utente paziente che ha compilato il questionario.
        public Guid PatientUserId { get; set; }

        // Contenuto testuale del questionario di pre-triage.
        public string Content { get; set; } = string.Empty;

        // Timestamp UTC di creazione del questionario.
        public DateTime CreatedAtUtc { get; set; }

        // Timestamp UTC dell'ultima modifica apportata al questionario.
        public DateTime UpdatedAtUtc { get; set; }
    }
}

