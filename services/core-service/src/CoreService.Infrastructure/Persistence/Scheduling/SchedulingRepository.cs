/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Scheduling/SchedulingRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * delle entità del bounded context Scheduling.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia ISchedulingRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Scheduling.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare slot disponibili, slot di calendario e slot di un clinico.
 * - Recuperare appuntamenti corredati del relativo slot.
 * - Recuperare singole entità di scheduling tramite identificativo.
 * - Persistire calendari, slot, appuntamenti e cambi di stato.
 * - Verificare l'esistenza di appuntamenti attivi associati a uno slot.
 *
 * Interazioni principali
 * ----------------------
 * - SchedulingDbContext
 * - ISchedulingRepository
 * - Entità ClinicianCalendar del dominio Scheduling
 * - Entità AvailabilitySlot del dominio Scheduling
 * - Entità Appointment del dominio Scheduling
 * - Entità AppointmentStatusChange del dominio Scheduling
 *
 * Note
 * ----
 * Le operazioni di sola consultazione utilizzano AsNoTracking()
 * quando non è necessario il tracking da parte di Entity Framework Core.
 * Le operazioni di scrittura persistono immediatamente le modifiche sul database.
 * Il repository definisce inoltre l'insieme degli stati appuntamento
 * considerati "attivi" per i controlli di disponibilità degli slot.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Scheduling
{
    public sealed class SchedulingRepository : ISchedulingRepository
    {
        // DbContext del bounded context Scheduling usato
        // per eseguire query e operazioni di persistenza su calendari, slot e appuntamenti.
        private readonly SchedulingDbContext _dbContext;

        // Stati dell'appuntamento considerati attivi ai fini dei controlli
        // di occupazione effettiva di uno slot di disponibilità.
        private static readonly AppointmentStatus[] ActiveAppointmentStatuses = new[]
        {
            AppointmentStatus.Booked,
            AppointmentStatus.CheckedIn
        };

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Scheduling.
         */
        public SchedulingRepository(SchedulingDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Recupera gli slot disponibili in un intervallo temporale,
         * opzionalmente filtrati per clinico.
         */
        public async Task<IReadOnlyList<AvailabilitySlot>> GetAvailableSlotsAsync(
            Guid? clinicianUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default)
        {
            // Valida l'intervallo temporale richiesto prima di comporre la query.
            if (fromUtc >= toUtc)
            {
                throw new ArgumentException("fromUtc must be earlier than toUtc.", nameof(fromUtc));
            }

            // Costruisce la query base sugli slot che:
            // - ricadono interamente nell'intervallo richiesto;
            // - risultano marcati come Available.
            var slotsQuery = _dbContext.Slots
                .AsNoTracking()
                .Where(s => s.StartUtc >= fromUtc && s.EndUtc <= toUtc)
                .Where(s => s.Status == SlotStatus.Available);

            // Se è stato specificato un clinico, restringe la ricerca
            // ai soli slot appartenenti al suo calendario.
            if (clinicianUserId.HasValue)
            {
                var clinicianId = clinicianUserId.Value;

                slotsQuery =
                    from slot in slotsQuery
                    join calendar in _dbContext.Calendars.AsNoTracking()
                        on slot.CalendarId equals calendar.Id
                    where calendar.ClinicianUserId == clinicianId
                    select slot;
            }

            // Materializza gli slot candidati ordinandoli cronologicamente.
            var slots = await slotsQuery
                .OrderBy(s => s.StartUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            // Se non sono stati trovati slot disponibili a livello logico,
            // restituisce immediatamente il risultato vuoto.
            if (slots.Count == 0)
            {
                return slots;
            }

            // Estrae gli identificativi degli slot candidati
            // per verificare successivamente l'eventuale presenza di appuntamenti attivi.
            var slotIds = slots
                .Select(s => s.Id)
                .Distinct()
                .ToList();

            // Recupera gli slot che, pur essendo marcati come Available,
            // risultano già occupati da appuntamenti attivi.
            var busySlotIds = await _dbContext.Appointments
                .AsNoTracking()
                .Where(a => slotIds.Contains(a.SlotId))
                .Where(a => ActiveAppointmentStatuses.Contains(a.Status))
                .Select(a => a.SlotId)
                .Distinct()
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            // Se nessuno slot è occupato da appuntamenti attivi,
            // restituisce direttamente l'elenco iniziale.
            if (busySlotIds.Count == 0)
            {
                return slots;
            }

            // Filtra in memoria gli slot effettivamente liberi
            // escludendo quelli già impegnati da appuntamenti attivi.
            var busySet = new HashSet<Guid>(busySlotIds);
            return slots
                .Where(s => !busySet.Contains(s.Id))
                .ToList();
        }

        /*
         * Recupera gli appuntamenti di un paziente
         * insieme ai relativi slot, limitati a un intervallo temporale.
         */
        public async Task<IReadOnlyList<(Appointment appointment, AvailabilitySlot slot)>> GetAppointmentsForPatientWithSlotsAsync(
            Guid patientUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default)
        {
            // Valida l'intervallo temporale richiesto prima di comporre la query.
            if (fromUtc >= toUtc)
            {
                throw new ArgumentException("fromUtc must be earlier than toUtc.", nameof(fromUtc));
            }

            // Costruisce una join tra appuntamenti e slot
            // filtrando per paziente e per intervallo temporale dello slot.
            var query =
                from appointment in _dbContext.Appointments.AsNoTracking()
                join slot in _dbContext.Slots.AsNoTracking()
                    on appointment.SlotId equals slot.Id
                where appointment.PatientUserId == patientUserId
                      && slot.StartUtc >= fromUtc
                      && slot.EndUtc <= toUtc
                orderby slot.StartUtc
                select new { appointment, slot };

            // Materializza il risultato intermedio.
            var rows = await query
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            // Proietta il risultato nella forma tuple attesa dal contratto repository.
            return rows
                .Select(r => (r.appointment, r.slot))
                .ToList();
        }

        /*
         * Recupera gli appuntamenti di un clinico
         * insieme ai relativi slot, limitati a un intervallo temporale.
         */
        public async Task<IReadOnlyList<(Appointment appointment, AvailabilitySlot slot)>> GetAppointmentsForClinicianWithSlotsAsync(
            Guid clinicianUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default)
        {
            // Valida l'intervallo temporale richiesto prima di comporre la query.
            if (fromUtc >= toUtc)
            {
                throw new ArgumentException("fromUtc must be earlier than toUtc.", nameof(fromUtc));
            }

            // Costruisce una join tra appuntamenti e slot
            // filtrando per clinico e per intervallo temporale dello slot.
            var query =
                from appointment in _dbContext.Appointments.AsNoTracking()
                join slot in _dbContext.Slots.AsNoTracking()
                    on appointment.SlotId equals slot.Id
                where appointment.ClinicianUserId == clinicianUserId
                      && slot.StartUtc >= fromUtc
                      && slot.EndUtc <= toUtc
                orderby slot.StartUtc
                select new { appointment, slot };

            // Materializza il risultato intermedio.
            var rows = await query
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            // Proietta il risultato nella forma tuple attesa dal contratto repository.
            return rows
                .Select(r => (r.appointment, r.slot))
                .ToList();
        }

        /*
         * Recupera tutti gli appuntamenti del sistema
         * insieme ai relativi slot, limitati a un intervallo temporale.
         */
        public async Task<IReadOnlyList<(Appointment appointment, AvailabilitySlot slot)>> GetAppointmentsWithSlotsAsync(
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default)
        {
            // Valida l'intervallo temporale richiesto prima di comporre la query.
            if (fromUtc >= toUtc)
            {
                throw new ArgumentException("fromUtc must be earlier than toUtc.", nameof(fromUtc));
            }

            // Costruisce una join tra appuntamenti e slot
            // filtrando unicamente per intervallo temporale dello slot.
            var query =
                from appointment in _dbContext.Appointments.AsNoTracking()
                join slot in _dbContext.Slots.AsNoTracking()
                    on appointment.SlotId equals slot.Id
                where slot.StartUtc >= fromUtc
                      && slot.EndUtc <= toUtc
                orderby slot.StartUtc
                select new { appointment, slot };

            // Materializza il risultato intermedio.
            var rows = await query
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            // Proietta il risultato nella forma tuple attesa dal contratto repository.
            return rows
                .Select(r => (r.appointment, r.slot))
                .ToList();
        }

        /*
         * Recupera un appuntamento tramite il suo identificativo univoco.
         */
        public async Task<Appointment?> GetAppointmentByIdAsync(
            Guid appointmentId,
            CancellationToken cancellationToken = default)
        {
            // Restituisce l'eventuale appuntamento corrispondente all'identificativo richiesto.
            return await _dbContext.Appointments
                .FirstOrDefaultAsync(a => a.Id == appointmentId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera uno slot di disponibilità tramite il suo identificativo univoco.
         */
        public async Task<AvailabilitySlot?> GetSlotByIdAsync(
            Guid slotId,
            CancellationToken cancellationToken = default)
        {
            // Restituisce l'eventuale slot corrispondente all'identificativo richiesto.
            return await _dbContext.Slots
                .FirstOrDefaultAsync(s => s.Id == slotId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera un calendario clinico tramite il suo identificativo univoco.
         */
        public async Task<ClinicianCalendar?> GetCalendarByIdAsync(
            Guid calendarId,
            CancellationToken cancellationToken = default)
        {
            // Restituisce l'eventuale calendario corrispondente all'identificativo richiesto.
            return await _dbContext.Calendars
                .FirstOrDefaultAsync(c => c.Id == calendarId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera il calendario associato a un determinato clinico.
         */
        public async Task<ClinicianCalendar?> GetCalendarByClinicianUserIdAsync(
            Guid clinicianUserId,
            CancellationToken cancellationToken = default)
        {
            // Restituisce l'eventuale calendario associato al clinico richiesto.
            return await _dbContext.Calendars
                .FirstOrDefaultAsync(c => c.ClinicianUserId == clinicianUserId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo calendario clinico nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddCalendarAsync(
            ClinicianCalendar calendar,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (calendar == null)
            {
                throw new ArgumentNullException(nameof(calendar));
            }

            // Inserisce il nuovo calendario nel DbContext.
            await _dbContext.Calendars
                .AddAsync(calendar, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera tutti gli slot associati a un clinico
         * in un determinato intervallo temporale.
         */
        public async Task<IReadOnlyList<AvailabilitySlot>> GetSlotsForClinicianAsync(
            Guid clinicianUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default)
        {
            // Valida l'intervallo temporale richiesto prima di comporre la query.
            if (fromUtc >= toUtc)
            {
                throw new ArgumentException("fromUtc must be earlier than toUtc.", nameof(fromUtc));
            }

            // Costruisce la query unendo slot e calendari
            // e filtrando per clinico e per intervallo temporale.
            var query =
                from slot in _dbContext.Slots.AsNoTracking()
                join calendar in _dbContext.Calendars.AsNoTracking()
                    on slot.CalendarId equals calendar.Id
                where calendar.ClinicianUserId == clinicianUserId
                      && slot.StartUtc >= fromUtc
                      && slot.EndUtc <= toUtc
                orderby slot.StartUtc
                select slot;

            return await query
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera tutti gli slot associati a un calendario
         * in un determinato intervallo temporale.
         */
        public async Task<IReadOnlyList<AvailabilitySlot>> GetSlotsForCalendarAsync(
            Guid calendarId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default)
        {
            // Valida l'intervallo temporale richiesto prima di comporre la query.
            if (fromUtc >= toUtc)
            {
                throw new ArgumentException("fromUtc must be earlier than toUtc.", nameof(fromUtc));
            }

            // Recupera gli slot del calendario richiesto
            // ordinandoli cronologicamente.
            return await _dbContext.Slots
                .AsNoTracking()
                .Where(s => s.CalendarId == calendarId)
                .Where(s => s.StartUtc >= fromUtc && s.EndUtc <= toUtc)
                .OrderBy(s => s.StartUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera tutti gli slot di un calendario
         * che si sovrappongono a un intervallo temporale specificato.
         */
        public async Task<IReadOnlyList<AvailabilitySlot>> GetSlotsOverlappingRangeAsync(
            Guid calendarId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default)
        {
            // Valida l'intervallo temporale richiesto prima di comporre la query.
            if (fromUtc >= toUtc)
            {
                throw new ArgumentException("fromUtc must be earlier than toUtc.", nameof(fromUtc));
            }

            // Seleziona gli slot che hanno una reale intersezione temporale
            // con l'intervallo richiesto.
            return await _dbContext.Slots
                .AsNoTracking()
                .Where(s => s.CalendarId == calendarId)
                .Where(s => s.StartUtc < toUtc && s.EndUtc > fromUtc)
                .OrderBy(s => s.StartUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un insieme di nuovi slot di disponibilità nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddSlotsAsync(
            IEnumerable<AvailabilitySlot> slots,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo.
            if (slots == null)
            {
                throw new ArgumentNullException(nameof(slots));
            }

            // Materializza l'enumerazione una sola volta
            // per evitare multiple enumerazioni e verificare rapidamente se è vuota.
            var list = slots.ToList();
            if (list.Count == 0)
            {
                return;
            }

            // Inserisce tutti gli slot nel DbContext.
            await _dbContext.Slots
                .AddRangeAsync(list, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna uno slot di disponibilità esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateSlotAsync(
            AvailabilitySlot slot,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (slot == null)
            {
                throw new ArgumentNullException(nameof(slot));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.Slots.Update(slot);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo appuntamento nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAppointmentAsync(
            Appointment appointment,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (appointment == null)
            {
                throw new ArgumentNullException(nameof(appointment));
            }

            // Inserisce il nuovo appuntamento nel DbContext.
            await _dbContext.Appointments
                .AddAsync(appointment, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna un appuntamento esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAppointmentAsync(
            Appointment appointment,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (appointment == null)
            {
                throw new ArgumentNullException(nameof(appointment));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.Appointments.Update(appointment);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo record di cambio stato appuntamento nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddStatusChangeAsync(
            AppointmentStatusChange statusChange,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (statusChange == null)
            {
                throw new ArgumentNullException(nameof(statusChange));
            }

            // Inserisce il nuovo record di storico stato nel DbContext.
            await _dbContext.AppointmentStatusChanges
                .AddAsync(statusChange, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext
                .SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Verifica se esiste almeno un appuntamento attivo
         * associato allo slot specificato.
         */
        public async Task<bool> ExistsActiveAppointmentForSlotAsync(
            Guid slotId,
            CancellationToken cancellationToken = default)
        {
            // Esegue una semplice verifica di esistenza sugli appuntamenti
            // limitandosi agli stati considerati attivi dal repository.
            return await _dbContext.Appointments
                .AsNoTracking()
                .AnyAsync(
                    a => a.SlotId == slotId && ActiveAppointmentStatuses.Contains(a.Status),
                    cancellationToken)
                .ConfigureAwait(false);
        }
    }
}
