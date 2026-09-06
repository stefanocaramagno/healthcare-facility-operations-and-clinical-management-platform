/*
 * File: services/core-service/src/CoreService.Domain/Registry/UserRole.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * i ruoli applicativi disponibili nel sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Registry,
 * e identifica in modo tipizzato i diversi profili utente
 * riconosciuti dalla piattaforma.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare i ruoli supportati dal sistema in forma tipizzata.
 * - Consentire controlli di autorizzazione e instradamento dei casi d'uso.
 * - Favorire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza del ruolo, evitando dipendenze dall'ordine implicito
 * dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Registry;

public enum UserRole
{
    // Utente con privilegi amministrativi globali sul sistema.
    Admin = 0,

    // Utente clinico abilitato alla gestione delle attività sanitarie e degli encounter.
    Clinician = 1,

    // Utente paziente titolare del percorso sanitario e dei relativi dati personali.
    Patient = 2,

    // Utente delegato autorizzato a operare per conto di un paziente entro i limiti della delega attiva.
    Delegate = 3
}

