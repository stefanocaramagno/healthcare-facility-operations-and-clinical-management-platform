/*
 * File: services/core-service/src/CoreService.Domain/Payments/PaymentStatus.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * i possibili stati del ciclo di vita di un pagamento.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Payments,
 * e identifica in modo tipizzato le principali fasi
 * attraversate da un Payment Intent o da una Payment Transaction
 * nel workflow di pagamento del sistema.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata gli stati supportati dal sistema.
 * - Consentire controlli applicativi coerenti sulle transizioni di stato dei pagamenti.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza dello stato, evitando dipendenze dall'ordine implicito
 * dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Payments;

public enum PaymentStatus
{
    // Il pagamento è stato creato ma non è ancora entrato nella fase di elaborazione.
    Created = 0,

    // Il pagamento è in corso di elaborazione e non ha ancora raggiunto un esito finale.
    Pending = 1,

    // Il pagamento è stato completato con esito positivo.
    Succeeded = 2,

    // Il pagamento non è andato a buon fine.
    Failed = 3,

    // Il pagamento è stato annullato e non deve più proseguire nel workflow.
    Canceled = 4
}

