/*
 * File: services/core-service/src/CoreService.Domain/Registry/DelegationScope.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * i permessi operativi concedibili tramite una delega.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Registry,
 * e identifica in modo tipizzato gli ambiti funzionali
 * entro cui un delegato può operare per conto di un paziente.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata gli scope supportati dal sistema.
 * - Consentire i controlli di autorizzazione delegata nei servizi applicativi.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza dello scope, evitando dipendenze dall'ordine implicito
 * dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Registry;

public enum DelegationScope
{
    // Permette la sola consultazione in lettura delle informazioni autorizzate.
    ReadOnly = 0,

    // Permette al delegato di gestire le operazioni relative agli appuntamenti.
    ManageAppointments = 1,

    // Permette al delegato di gestire le operazioni relative ai pagamenti.
    ManagePayments = 2
}

