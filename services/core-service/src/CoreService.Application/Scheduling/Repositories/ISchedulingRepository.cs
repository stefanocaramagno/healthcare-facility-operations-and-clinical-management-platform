/*
 * File: services/core-service/src/CoreService.Application/Scheduling/Repositories/ISchedulingRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * delle entità del dominio Scheduling.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Scheduling
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono interrogare e modificare disponibilità, calendari, appuntamenti
 * e storico delle transizioni di stato, senza dipendere dai dettagli
 * infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare slot disponibili e slot associati a clinici o calendari.
 * - Recuperare appuntamenti con i relativi slot associati.
 * - Recuperare singole entità di scheduling per identificativo.
 * - Creare e aggiornare calendari, slot, appuntamenti e cambi di stato.
 * - Verificare la presenza di appuntamenti attivi associati a uno slot.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Scheduling
 * - Implementazioni infrastrutturali dei repository
 * - Entità AvailabilitySlot, Appointment, ClinicianCalendar e AppointmentStatusChange
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
using CoreService.Domain.Scheduling;

namespace CoreService.Application.Scheduling.Repositories
{
    public interface ISchedulingRepository
    {
        /*
         * Recupera gli slot attualmente disponibili nel range temporale specificato,
         * eventualmente filtrando per clinico.
         */
        Task<IReadOnlyList<AvailabilitySlot>> GetAvailableSlotsAsync(
            Guid? clinicianUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default);

        /*
         * Recupera gli appuntamenti di un paziente insieme ai rispettivi slot associati
         * nel range temporale specificato.
         */
        Task<IReadOnlyList<(Appointment appointment, AvailabilitySlot slot)>> GetAppointmentsForPatientWithSlotsAsync(
            Guid patientUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default);

        /*
         * Recupera gli appuntamenti di un clinico insieme ai rispettivi slot associati
         * nel range temporale specificato.
         */
        Task<IReadOnlyList<(Appointment appointment, AvailabilitySlot slot)>> GetAppointmentsForClinicianWithSlotsAsync(
            Guid clinicianUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutti gli appuntamenti insieme ai rispettivi slot associati
         * nel range temporale specificato.
         */
        Task<IReadOnlyList<(Appointment appointment, AvailabilitySlot slot)>> GetAppointmentsWithSlotsAsync(
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un appuntamento a partire dal suo identificativo univoco.
         */
        Task<Appointment?> GetAppointmentByIdAsync(
            Guid appointmentId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera uno slot di disponibilità a partire dal suo identificativo univoco.
         */
        Task<AvailabilitySlot?> GetSlotByIdAsync(
            Guid slotId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un calendario clinico a partire dal suo identificativo univoco.
         */
        Task<ClinicianCalendar?> GetCalendarByIdAsync(
            Guid calendarId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera il calendario associato a uno specifico clinico.
         */
        Task<ClinicianCalendar?> GetCalendarByClinicianUserIdAsync(
            Guid clinicianUserId,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo calendario clinico nel sistema.
         */
        Task AddCalendarAsync(
            ClinicianCalendar calendar,
            CancellationToken cancellationToken = default);

        /*
         * Recupera gli slot associati a un clinico nel range temporale specificato.
         */
        Task<IReadOnlyList<AvailabilitySlot>> GetSlotsForClinicianAsync(
            Guid clinicianUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default);

        /*
         * Recupera gli slot associati a un calendario nel range temporale specificato.
         */
        Task<IReadOnlyList<AvailabilitySlot>> GetSlotsForCalendarAsync(
            Guid calendarId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default);

        /*
         * Recupera gli slot di un calendario che si sovrappongono al range temporale specificato.
         */
        Task<IReadOnlyList<AvailabilitySlot>> GetSlotsOverlappingRangeAsync(
            Guid calendarId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default);

        /*
         * Persiste in batch un insieme di nuovi slot di disponibilità.
         */
        Task AddSlotsAsync(
            IEnumerable<AvailabilitySlot> slots,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di uno slot di disponibilità esistente.
         */
        Task UpdateSlotAsync(
            AvailabilitySlot slot,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo appuntamento nel sistema.
         */
        Task AddAppointmentAsync(
            Appointment appointment,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un appuntamento esistente.
         */
        Task UpdateAppointmentAsync(
            Appointment appointment,
            CancellationToken cancellationToken = default);

        /*
         * Persiste una nuova transizione di stato associata a un appuntamento.
         */
        Task AddStatusChangeAsync(
            AppointmentStatusChange statusChange,
            CancellationToken cancellationToken = default);

        /*
         * Verifica se esiste almeno un appuntamento attivo associato allo slot specificato.
         */
        Task<bool> ExistsActiveAppointmentForSlotAsync(
            Guid slotId,
            CancellationToken cancellationToken = default);
    }
}
