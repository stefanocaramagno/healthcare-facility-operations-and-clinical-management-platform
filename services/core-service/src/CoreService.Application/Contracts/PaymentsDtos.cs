/*
 * File: services/core-service/src/CoreService.Application/Contracts/PaymentsDtos.cs
 *
 * Scopo
 * -----
 * Definire i DTO e i contratti dati utilizzati dal dominio applicativo Payments
 * per la gestione dei PaymentIntent, delle transazioni e delle richieste
 * di pagamento o simulazione provider.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file raccoglie le strutture dati scambiate tra controller,
 * service layer e client per tutte le operazioni del dominio Payments.
 * I contratti descrivono sia payload di input sia payload di output
 * relativi al ciclo di vita dei pagamenti.
 *
 * Responsabilità principali
 * -------------------------
 * - Definire i DTO dei PaymentIntent e delle relative transazioni.
 * - Definire i payload per creazione ed elaborazione dei pagamenti.
 * - Definire i payload per webhook simulati e simulazioni provider.
 * - Definire i DTO amministrativi per la consultazione avanzata dei pagamenti.
 *
 * Interazioni principali
 * ----------------------
 * - Controller del dominio Payments
 * - Service layer del dominio Payments
 * - Provider di pagamento simulato
 * - Client frontend e altri consumer applicativi
 *
 * Note
 * ----
 * Questi tipi non contengono logica di business:
 * rappresentano esclusivamente contratti dati del layer Application.
 */

using System;

namespace CoreService.Application.Contracts
{
    /*
     * DTO che rappresenta un PaymentIntent applicativo,
     * ossia l'entità che governa il ciclo di pagamento associato a un appuntamento.
     */
    public sealed record PaymentIntentDto(
        Guid Id,
        Guid AppointmentId,
        int AmountCents,
        string Currency,
        string Status,
        string Provider,
        string ProviderIntentId,
        string IdempotencyKey,
        DateTime CreatedAtUtc,
        DateTime UpdatedAtUtc
    );

    /*
     * DTO che rappresenta una singola transazione di pagamento
     * associata a un determinato PaymentIntent.
     */
    public sealed record PaymentTransactionDto(
        Guid Id,
        Guid IntentId,
        string ProviderTransactionId,
        string Status,
        int AmountCents,
        DateTime ProcessedAtUtc,
        string? RawResponseJson
    );

    /*
     * DTO di input usato per creare un nuovo PaymentIntent
     * per uno specifico appuntamento.
     */
    public sealed record CreatePaymentIntentForAppointmentRequest(
        int? AmountCents
    );

    /*
     * DTO di input usato per avviare l'elaborazione di un pagamento,
     * specificando opzionalmente il metodo scelto.
     */
    public sealed record ProcessPaymentRequest(
        string? Method
    );

    /*
     * DTO di input usato per rappresentare il payload di un webhook simulato
     * proveniente dal provider di pagamento.
     */
    public sealed record SimulatedPaymentWebhookRequest(
        string ProviderIntentId,
        string EventType,
        int? AmountCents,
        string? ProviderTransactionId,
        string? Method,
        string? FailureReason
    );

    /*
     * DTO di input usato per simulare dall'area amministrativa
     * l'esito di un provider di pagamento.
     */
    public sealed record SimulateProviderOutcomeRequest(
        string Outcome
    );

    /*
     * DTO di input usato per registrare un pagamento effettuato in presenza,
     * con importo e metodo opzionali.
     */
    public sealed record RegisterInPersonPaymentRequest(
        int? AmountCents,
        string? Method
    );

    /*
     * DTO di input usato per aggiornare amministrativamente
     * lo stato di un pagamento in fase di riconciliazione.
     */
    public sealed record ReconcilePaymentRequest(
        string NewStatus
    );

    /*
     * DTO amministrativo che rappresenta un PaymentIntent arricchito
     * con informazioni sintetiche sull'ultima transazione associata.
     */
    public sealed record AdminPaymentIntentDto(
        Guid Id,
        Guid AppointmentId,
        int AmountCents,
        string Currency,
        string Status,
        string Provider,
        string ProviderIntentId,
        string IdempotencyKey,
        DateTime CreatedAtUtc,
        DateTime UpdatedAtUtc,
        Guid? LastTransactionId,
        string? LastTransactionStatus,
        DateTime? LastTransactionProcessedAtUtc,
        int? LastTransactionAmountCents
    );
}
