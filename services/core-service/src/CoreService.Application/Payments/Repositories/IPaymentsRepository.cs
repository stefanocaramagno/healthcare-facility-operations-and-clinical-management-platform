/*
 * File: services/core-service/src/CoreService.Application/Payments/Repositories/IPaymentsRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * delle entità del dominio Payments.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Payments
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono interrogare e modificare Payment Intent e Payment Transaction
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare Payment Intent tramite identificativi applicativi o provider esterni.
 * - Recuperare Payment Intent associati a uno o più appuntamenti.
 * - Persistire e aggiornare Payment Intent.
 * - Persistire Payment Transaction.
 * - Recuperare le transazioni associate a un Payment Intent.
 * - Recuperare Payment Intent tramite filtri amministrativi.
 *
 * Interazioni principali
 * ----------------------
 * - PatientPaymentsService
 * - AdminPaymentsService
 * - PaymentCheckoutWorkflowService
 * - PaymentWebhookService
 * - Implementazioni infrastrutturali dei repository
 * - Entità PaymentIntent e PaymentTransaction del dominio
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * sul database o sul meccanismo di persistenza:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Domain.Payments;

namespace CoreService.Application.Payments.Repositories
{
    public interface IPaymentsRepository
    {
        /*
         * Recupera un Payment Intent a partire dal suo identificativo univoco interno.
         */
        Task<PaymentIntent?> GetIntentByIdAsync(
            Guid intentId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera il Payment Intent associato a uno specifico appuntamento.
         */
        Task<PaymentIntent?> GetIntentByAppointmentIdAsync(
            Guid appointmentId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un Payment Intent tramite provider di pagamento
         * e identificativo esterno del provider.
         */
        Task<PaymentIntent?> GetIntentByProviderAsync(
            string provider,
            string providerIntentId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutti i Payment Intent associati a un insieme di appuntamenti.
         */
        Task<IReadOnlyList<PaymentIntent>> GetIntentsByAppointmentIdsAsync(
            IReadOnlyCollection<Guid> appointmentIds,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo Payment Intent nel sistema.
         */
        Task AddIntentAsync(
            PaymentIntent intent,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un Payment Intent esistente.
         */
        Task UpdateIntentAsync(
            PaymentIntent intent,
            CancellationToken cancellationToken = default);

        /*
         * Persiste una nuova Payment Transaction associata a un Payment Intent.
         */
        Task AddTransactionAsync(
            PaymentTransaction transaction,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutte le transazioni associate a uno specifico Payment Intent.
         */
        Task<IReadOnlyList<PaymentTransaction>> GetTransactionsForIntentAsync(
            Guid intentId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera i Payment Intent filtrati per intervallo temporale,
         * stato di pagamento e provider.
         */
        Task<IReadOnlyList<PaymentIntent>> GetIntentsByFilterAsync(
            DateTime? fromUtc,
            DateTime? toUtc,
            PaymentStatus? status,
            string? provider,
            CancellationToken cancellationToken = default);
    }
}
