/*
 * File: services/core-service/src/CoreService.Domain/Clinical/ClinicalReportStatus.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * i possibili stati del ciclo di vita di un referto clinico.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e identifica in modo tipizzato le principali fasi
 * attraversate da un referto nel workflow documentale del sistema.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata gli stati supportati dal sistema.
 * - Consentire controlli applicativi coerenti sulle transizioni del referto.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza dello stato, evitando dipendenze dall'ordine implicito
 * dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Clinical;

public enum ClinicalReportStatus
{
    // Il referto è in fase di redazione e può ancora essere modificato.
    Draft = 0,

    // Il referto è stato firmato e non è più una semplice bozza,
    // ma non è ancora stato pubblicato.
    Signed = 1,

    // Il referto è stato pubblicato ed è disponibile secondo le regole applicative del sistema.
    Published = 2
}

