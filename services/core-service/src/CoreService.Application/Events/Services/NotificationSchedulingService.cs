/*
 * File: services/core-service/src/CoreService.Application/Events/Services/NotificationSchedulingService.cs
 *
 * Scopo
 * -----
 * Implementare il servizio applicativo deputato alla pianificazione
 * delle notifiche in-app generate dai principali workflow del sistema,
 * come prenotazioni, ripianificazioni, annullamenti e pagamenti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Events
 * e centralizza la logica di scheduling delle notifiche applicative,
 * traducendo eventi di business in record Notification persistiti
 * tramite il repository dedicato.
 *
 * Responsabilità principali
 * -------------------------
 * - Creare notifiche in-app immediate o differite.
 * - Normalizzare la data di pianificazione di una notifica.
 * - Pianificare notifiche di conferma e promemoria appuntamento.
 * - Pianificare notifiche di annullamento e ripianificazione appuntamento.
 * - Pianificare notifiche relative all'esito dei pagamenti.
 *
 * Interazioni principali
 * ----------------------
 * - INotificationsRepository
 * - Entità del dominio Events
 * - Entità dei domini Scheduling e Payments
 *
 * Note
 * ----
 * Questo servizio si occupa esclusivamente della creazione e persistenza
 * delle notifiche in-app. Non gestisce direttamente canali esterni come e-mail.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Events.Repositories;
using CoreService.Domain.Events;
using CoreService.Domain.Payments;
using CoreService.Domain.Scheduling;

namespace CoreService.Application.Events.Services
{
    public sealed class NotificationSchedulingService
    {
        // Repository applicativo utilizzato per persistere
        // le notifiche generate dai workflow del sistema.
        private readonly INotificationsRepository _notificationsRepository;

        /*
         * Inizializza il servizio con la dipendenza necessaria
         * alla persistenza delle notifiche pianificate.
         */
        public NotificationSchedulingService(INotificationsRepository notificationsRepository)
        {
            _notificationsRepository = notificationsRepository
                ?? throw new ArgumentNullException(nameof(notificationsRepository));
        }

        /*
         * Pianifica una notifica in-app generica per un destinatario specifico.
         *
         * Se la data di schedulazione risulta già trascorsa oltre una piccola soglia di tolleranza,
         * la notifica viene resa immediatamente disponibile.
         */
        public async Task ScheduleInAppNotificationAsync(
            Guid recipientUserId,
            string subject,
            string body,
            DateTime scheduledAtUtc,
            CancellationToken cancellationToken = default)
        {
            var nowUtc = DateTime.UtcNow;

            // Normalizza la data di schedulazione per evitare che notifiche troppo vecchie
            // rimangano incoerentemente nel passato.
            var effectiveScheduledAtUtc = NormalizeScheduledAt(nowUtc, scheduledAtUtc);

            // Se la schedulazione è già maturata, la notifica viene considerata inviata
            // e quindi immediatamente visibile lato applicazione.
            var status = effectiveScheduledAtUtc <= nowUtc
                ? NotificationStatus.Sent
                : NotificationStatus.Pending;

            var sentAtUtc = status == NotificationStatus.Sent
                ? nowUtc
                : (DateTime?)null;

            var notification = new Notification
            {
                Id = Guid.NewGuid(),
                RecipientUserId = recipientUserId,
                Channel = "IN_APP",
                Subject = subject,
                Body = body,
                Status = status,
                CreatedAtUtc = nowUtc,
                ScheduledAtUtc = effectiveScheduledAtUtc,
                SentAtUtc = sentAtUtc
            };

            await _notificationsRepository
                .AddAsync(notification, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Pianifica tutte le notifiche standard successive alla prenotazione di un appuntamento:
         * conferma immediata, promemoria a 24 ore e promemoria a 2 ore, se temporalmente applicabili.
         */
        public async Task ScheduleAppointmentBookedNotificationsAsync(
            Appointment appointment,
            DateTime slotStartUtc,
            DateTime slotEndUtc,
            CancellationToken cancellationToken = default)
        {
            var nowUtc = DateTime.UtcNow;

            // Notifica immediata di conferma della prenotazione.
            var subjectConfirmation = "Conferma prenotazione visita";
            var bodyConfirmation =
                $"La tua prenotazione per la prestazione \"{appointment.ServiceCode}\" " +
                $"è stata confermata per il {slotStartUtc:dd/MM/yyyy HH:mm} (UTC).";

            await ScheduleInAppNotificationAsync(
                appointment.PatientUserId,
                subjectConfirmation,
                bodyConfirmation,
                nowUtc,
                cancellationToken).ConfigureAwait(false);

            // Promemoria pianificato 24 ore prima dell'inizio dello slot,
            // soltanto se tale istante non è già trascorso.
            var reminder24h = slotStartUtc.AddHours(-24);
            if (reminder24h > nowUtc)
            {
                var subjectReminder24h = "Promemoria visita (24 ore prima)";
                var bodyReminder24h =
                    $"Promemoria: domani alle {slotStartUtc:HH:mm} (UTC) è prevista la visita " +
                    $"per la prestazione \"{appointment.ServiceCode}\".";

                await ScheduleInAppNotificationAsync(
                    appointment.PatientUserId,
                    subjectReminder24h,
                    bodyReminder24h,
                    reminder24h,
                    cancellationToken).ConfigureAwait(false);
            }

            // Promemoria pianificato 2 ore prima dell'inizio dello slot,
            // soltanto se tale istante non è già trascorso.
            var reminder2h = slotStartUtc.AddHours(-2);
            if (reminder2h > nowUtc)
            {
                var subjectReminder2h = "Promemoria visita (2 ore prima)";
                var bodyReminder2h =
                    $"Promemoria: tra circa 2 ore (alle {slotStartUtc:HH:mm} UTC) è prevista la visita " +
                    $"per la prestazione \"{appointment.ServiceCode}\".";

                await ScheduleInAppNotificationAsync(
                    appointment.PatientUserId,
                    subjectReminder2h,
                    bodyReminder2h,
                    reminder2h,
                    cancellationToken).ConfigureAwait(false);
            }
        }

        /*
         * Pianifica una notifica immediata di annullamento appuntamento,
         * includendo opzionalmente il motivo comunicato dal workflow chiamante.
         */
        public async Task ScheduleAppointmentCanceledNotificationAsync(
            Appointment appointment,
            DateTime slotStartUtc,
            string? reason,
            CancellationToken cancellationToken = default)
        {
            var nowUtc = DateTime.UtcNow;

            var subject = "Appuntamento annullato";

            // Se presente, aggiunge il motivo dell'annullamento al testo della notifica.
            var reasonText = string.IsNullOrWhiteSpace(reason)
                ? string.Empty
                : $" Motivo: {reason.Trim()}";

            var body =
                $"L'appuntamento per la prestazione \"{appointment.ServiceCode}\" " +
                $"previsto per il {slotStartUtc:dd/MM/yyyy HH:mm} (UTC) è stato annullato." +
                reasonText;

            await ScheduleInAppNotificationAsync(
                appointment.PatientUserId,
                subject,
                body,
                nowUtc,
                cancellationToken).ConfigureAwait(false);
        }

        /*
         * Pianifica una notifica immediata di ripianificazione appuntamento,
         * indicando la vecchia e la nuova data e includendo opzionalmente il motivo.
         */
        public async Task ScheduleAppointmentRescheduledNotificationAsync(
            Appointment appointment,
            DateTime oldSlotStartUtc,
            DateTime newSlotStartUtc,
            DateTime newSlotEndUtc,
            string? reason,
            CancellationToken cancellationToken = default)
        {
            var nowUtc = DateTime.UtcNow;

            var subject = "Appuntamento ripianificato";

            // Se presente, aggiunge il motivo della ripianificazione al testo della notifica.
            var reasonText = string.IsNullOrWhiteSpace(reason)
                ? string.Empty
                : $" Motivo: {reason.Trim()}";

            var body =
                $"Il tuo appuntamento per la prestazione \"{appointment.ServiceCode}\" " +
                $"è stato spostato da {oldSlotStartUtc:dd/MM/yyyy HH:mm} (UTC) " +
                $"a {newSlotStartUtc:dd/MM/yyyy HH:mm} (UTC)." +
                reasonText;

            await ScheduleInAppNotificationAsync(
                appointment.PatientUserId,
                subject,
                body,
                nowUtc,
                cancellationToken).ConfigureAwait(false);
        }

        /*
         * Pianifica una notifica immediata di pagamento completato con successo,
         * distinguendo semanticamente tra pagamento in sede e pagamento via app.
         */
        public async Task SchedulePaymentSucceededNotificationAsync(
            Appointment appointment,
            PaymentIntent intent,
            bool inPerson,
            CancellationToken cancellationToken = default)
        {
            var nowUtc = DateTime.UtcNow;

            var subject = "Pagamento completato";
            var channelDescription = inPerson ? "in sede" : "tramite app";

            var body =
                $"Il pagamento di {FormatAmount(intent.AmountCents, intent.Currency)} " +
                $"per l'appuntamento relativo alla prestazione \"{appointment.ServiceCode}\" " +
                $"è stato registrato con esito positivo {channelDescription}.";

            await ScheduleInAppNotificationAsync(
                appointment.PatientUserId,
                subject,
                body,
                nowUtc,
                cancellationToken).ConfigureAwait(false);
        }

        /*
         * Pianifica una notifica immediata di pagamento non riuscito,
         * distinguendo semanticamente tra pagamento in sede e pagamento via app.
         */
        public async Task SchedulePaymentFailedNotificationAsync(
            Appointment appointment,
            PaymentIntent intent,
            bool inPerson,
            CancellationToken cancellationToken = default)
        {
            var nowUtc = DateTime.UtcNow;

            var subject = "Pagamento non riuscito";
            var channelDescription = inPerson ? "in sede" : "tramite app";

            var body =
                $"Il tentativo di pagamento di {FormatAmount(intent.AmountCents, intent.Currency)} " +
                $"per l'appuntamento relativo alla prestazione \"{appointment.ServiceCode}\" " +
                $"non è andato a buon fine {channelDescription}. " +
                "Se il problema persiste, contatta la segreteria della struttura.";

            await ScheduleInAppNotificationAsync(
                appointment.PatientUserId,
                subject,
                body,
                nowUtc,
                cancellationToken).ConfigureAwait(false);
        }

        /*
         * Normalizza la data di schedulazione di una notifica.
         *
         * Se la data richiesta è eccessivamente nel passato rispetto all'istante corrente,
         * la riporta al presente per evitare schedulazioni incoerenti.
         */
        private static DateTime NormalizeScheduledAt(
            DateTime nowUtc,
            DateTime scheduledAtUtc)
        {
            var threshold = nowUtc.AddMinutes(-5);

            if (scheduledAtUtc < threshold)
            {
                return nowUtc;
            }

            return scheduledAtUtc;
        }

        /*
         * Converte un importo espresso in centesimi
         * in una stringa leggibile con due decimali e valuta.
         */
        private static string FormatAmount(
            int amountCents,
            string currency)
        {
            var amount = amountCents / 100.0m;
            return $"{amount:0.00} {currency}";
        }
    }
}
