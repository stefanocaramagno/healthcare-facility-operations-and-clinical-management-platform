/*
 * File: services/core-service/src/CoreService.Application/Scheduling/Services/PatientSchedulingService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi del dominio Scheduling
 * relativi alla consultazione della disponibilità e alla gestione
 * degli appuntamenti dal punto di vista del paziente autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Scheduling
 * e coordina i workflow che consentono al paziente di:
 * - consultare gli slot disponibili;
 * - consultare i propri appuntamenti;
 * - prenotare un appuntamento;
 * - annullare un appuntamento;
 * - ripianificare un appuntamento.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare gli input applicativi relativi a date e richieste operative.
 * - Coordinare repository di scheduling, catalogo, consensi e anagrafica clinici.
 * - Applicare le regole di business sulle prenotazioni lato paziente.
 * - Pianificare le notifiche collegate agli eventi di scheduling.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - ISchedulingRepository
 * - IServiceCatalogRepository
 * - IConsentRepository
 * - IUserRepository
 * - IClinicianProfileRepository
 * - NotificationSchedulingService
 * - Entità dei domini Scheduling e Registry
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati ai repository dedicati.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Common;
using CoreService.Application.Clinical.Repositories;
using CoreService.Application.Events.Services;
using CoreService.Application.Registry.Repositories;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Registry;
using CoreService.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Application.Scheduling.Services
{
    public sealed class PatientSchedulingService
    {
        // Repository e servizi collaboratori necessari ai workflow
        // di prenotazione, consultazione e gestione appuntamenti lato paziente.
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly IServiceCatalogRepository _serviceCatalogRepository;
        private readonly IConsentRepository _consentRepository;
        private readonly IUserRepository _userRepository;
        private readonly IClinicianProfileRepository _clinicianProfileRepository;
        private readonly NotificationSchedulingService _notificationSchedulingService;

        /*
         * Inizializza il servizio applicativo di scheduling lato paziente
         * con tutte le dipendenze necessarie ai relativi casi d'uso.
         */
        public PatientSchedulingService(
            ISchedulingRepository schedulingRepository,
            IServiceCatalogRepository serviceCatalogRepository,
            IConsentRepository consentRepository,
            IUserRepository userRepository,
            IClinicianProfileRepository clinicianProfileRepository,
            NotificationSchedulingService notificationSchedulingService)
        {
            _schedulingRepository = schedulingRepository
                ?? throw new ArgumentNullException(nameof(schedulingRepository));
            _serviceCatalogRepository = serviceCatalogRepository
                ?? throw new ArgumentNullException(nameof(serviceCatalogRepository));
            _consentRepository = consentRepository
                ?? throw new ArgumentNullException(nameof(consentRepository));
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _clinicianProfileRepository = clinicianProfileRepository
                ?? throw new ArgumentNullException(nameof(clinicianProfileRepository));
            _notificationSchedulingService = notificationSchedulingService
                ?? throw new ArgumentNullException(nameof(notificationSchedulingService));
        }

        /*
         * Recupera la disponibilità prenotabile dei clinici nel range temporale richiesto,
         * arricchendo gli slot con le informazioni pubbliche essenziali del clinico associato.
         */
        public async Task<OperationResult<IReadOnlyList<AvailabilitySlotDto>>> GetAvailabilityAsync(
            Guid? clinicianUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken)
        {
            var nowUtc = DateTime.UtcNow;

            // Normalizza gli estremi temporali opzionali imponendo una semantica UTC esplicita.
            if (!UtcDateTimeInput.TryNormalizeOptional(fromUtc, "fromUtc", out var normalizedFromUtc, out var fromError))
            {
                return OperationResult<IReadOnlyList<AvailabilitySlotDto>>.BadRequest(
                    "invalid_datetime",
                    fromError!);
            }

            if (!UtcDateTimeInput.TryNormalizeOptional(toUtc, "toUtc", out var normalizedToUtc, out var toError))
            {
                return OperationResult<IReadOnlyList<AvailabilitySlotDto>>.BadRequest(
                    "invalid_datetime",
                    toError!);
            }

            // Definisce il range temporale effettivo di ricerca,
            // applicando un intervallo di default quando i valori non sono specificati.
            var effectiveFrom = normalizedFromUtc ?? nowUtc;
            var effectiveTo = normalizedToUtc ?? effectiveFrom.AddDays(30);

            // Verifica la coerenza dell'intervallo richiesto.
            if (effectiveFrom >= effectiveTo)
            {
                return OperationResult<IReadOnlyList<AvailabilitySlotDto>>.Failure(
                    400,
                    "invalid_date_range",
                    "Il parametro 'fromUtc' deve essere precedente a 'toUtc'.");
            }

            // Recupera gli slot disponibili dal repository di scheduling.
            var slots = await _schedulingRepository
                .GetAvailableSlotsAsync(clinicianUserId, effectiveFrom, effectiveTo, cancellationToken)
                .ConfigureAwait(false);

            if (slots.Count == 0)
            {
                var empty = (IReadOnlyList<AvailabilitySlotDto>)Array.Empty<AvailabilitySlotDto>();
                return OperationResult<IReadOnlyList<AvailabilitySlotDto>>.Success(empty);
            }

            // Crea una cache dei calendari coinvolti per evitare letture ripetute.
            var calendarsById = new Dictionary<Guid, ClinicianCalendar>();

            foreach (var slot in slots)
            {
                if (calendarsById.ContainsKey(slot.CalendarId))
                {
                    continue;
                }

                var calendar = await _schedulingRepository
                    .GetCalendarByIdAsync(slot.CalendarId, cancellationToken)
                    .ConfigureAwait(false);

                if (calendar != null)
                {
                    calendarsById[calendar.Id] = calendar;
                }
            }

            // Estrae gli identificativi dei clinici per caricare le informazioni pubbliche associate.
            var clinicianIds = calendarsById.Values
                .Select(c => c.ClinicianUserId)
                .Where(id => id != Guid.Empty)
                .Distinct()
                .ToArray();

            var clinicianInfo = await LoadClinicianPublicInfoAsync(clinicianIds, cancellationToken)
                .ConfigureAwait(false);

            var result = new List<AvailabilitySlotDto>(slots.Count);

            // Mappa ogni slot disponibile nel relativo DTO di output.
            foreach (var slot in slots)
            {
                calendarsById.TryGetValue(slot.CalendarId, out var calendar);
                var clinicianId = calendar?.ClinicianUserId ?? Guid.Empty;

                clinicianInfo.TryGetValue(clinicianId, out var info);

                result.Add(new AvailabilitySlotDto(
                    slot.Id,
                    slot.CalendarId,
                    clinicianId,
                    info?.Email,
                    info?.Specialty,
                    slot.StartUtc,
                    slot.EndUtc));
            }

            return OperationResult<IReadOnlyList<AvailabilitySlotDto>>.Success(result);
        }

        /*
         * Recupera gli appuntamenti del paziente autenticato nel range temporale richiesto,
         * includendo le informazioni temporali derivate dallo slot associato.
         */
        public async Task<OperationResult<IReadOnlyList<PatientAppointmentDto>>> GetMyAppointmentsAsync(
            Guid patientUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken)
        {
            var nowUtc = DateTime.UtcNow;

            // Normalizza gli estremi temporali opzionali imponendo una semantica UTC esplicita.
            if (!UtcDateTimeInput.TryNormalizeOptional(fromUtc, "fromUtc", out var normalizedFromUtc, out var fromError))
            {
                return OperationResult<IReadOnlyList<PatientAppointmentDto>>.BadRequest(
                    "invalid_datetime",
                    fromError!);
            }

            if (!UtcDateTimeInput.TryNormalizeOptional(toUtc, "toUtc", out var normalizedToUtc, out var toError))
            {
                return OperationResult<IReadOnlyList<PatientAppointmentDto>>.BadRequest(
                    "invalid_datetime",
                    toError!);
            }

            // Definisce il range temporale effettivo di ricerca con una finestra più ampia
            // utile a comprendere appuntamenti recenti e prossimi.
            var effectiveFrom = normalizedFromUtc ?? nowUtc.AddDays(-30);
            var effectiveTo = normalizedToUtc ?? nowUtc.AddDays(60);

            if (effectiveFrom >= effectiveTo)
            {
                return OperationResult<IReadOnlyList<PatientAppointmentDto>>.Failure(
                    400,
                    "invalid_date_range",
                    "Il parametro 'fromUtc' deve essere precedente a 'toUtc'.");
            }

            // Recupera gli appuntamenti del paziente insieme ai relativi slot.
            var items = await _schedulingRepository
                .GetAppointmentsForPatientWithSlotsAsync(patientUserId, effectiveFrom, effectiveTo, cancellationToken)
                .ConfigureAwait(false);

            if (items.Count == 0)
            {
                var empty = (IReadOnlyList<PatientAppointmentDto>)Array.Empty<PatientAppointmentDto>();
                return OperationResult<IReadOnlyList<PatientAppointmentDto>>.Success(empty);
            }

            var result = new List<PatientAppointmentDto>(items.Count);

            // Mappa ogni appuntamento nel DTO di output combinando i dati dell'appuntamento
            // con quelli temporali provenienti dallo slot associato.
            foreach (var item in items)
            {
                var appointment = item.appointment;
                var slot = item.slot;

                result.Add(new PatientAppointmentDto(
                    appointment.Id,
                    appointment.SlotId,
                    appointment.ClinicianUserId,
                    appointment.ServiceId,
                    appointment.ServiceCode,
                    appointment.QuotedPriceCents,
                    appointment.Currency,
                    appointment.Status.ToString(),
                    slot.StartUtc,
                    slot.EndUtc,
                    appointment.Notes));
            }

            return OperationResult<IReadOnlyList<PatientAppointmentDto>>.Success(result);
        }

        /*
         * Prenota un nuovo appuntamento per il paziente autenticato,
         * verificando esistenza della prestazione, validità dello slot e presenza dei consensi obbligatori.
         */
        public async Task<OperationResult<PatientAppointmentDto>> BookAppointmentAsync(
            Guid patientUserId,
            BookAppointmentRequest request,
            CancellationToken cancellationToken)
        {
            // Verifica l'esistenza della prestazione richiesta.
            var service = await _serviceCatalogRepository
                .GetByIdAsync(request.ServiceId, cancellationToken)
                .ConfigureAwait(false);

            if (service == null)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    404,
                    "service_not_found",
                    "La prestazione richiesta non esiste.");
            }

            // Verifica l'esistenza dello slot selezionato.
            var slot = await _schedulingRepository
                .GetSlotByIdAsync(request.SlotId, cancellationToken)
                .ConfigureAwait(false);

            if (slot == null)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    404,
                    "slot_not_found",
                    "Lo slot di disponibilità richiesto non esiste.");
            }

            // Recupera i consensi obbligatori del paziente.
            var treatmentConsent = await _consentRepository
                .GetByPatientAndTypeAsync(patientUserId, ConsentType.Treatment, cancellationToken)
                .ConfigureAwait(false);

            var dataProcessingConsent = await _consentRepository
                .GetByPatientAndTypeAsync(patientUserId, ConsentType.DataProcessing, cancellationToken)
                .ConfigureAwait(false);

            // Senza i consensi richiesti la prenotazione non può essere completata.
            if (!IsConsentGranted(treatmentConsent) || !IsConsentGranted(dataProcessingConsent))
            {
                return OperationResult<PatientAppointmentDto>.Forbidden(
                    "missing_required_consents",
                    "Per prenotare un appuntamento è necessario aver concesso i consensi obbligatori al trattamento sanitario e al trattamento dei dati personali.");
            }

            var nowUtc = DateTime.UtcNow;

            // Non consente prenotazioni su slot già nel passato.
            if (slot.StartUtc <= nowUtc)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    400,
                    "slot_in_past",
                    "Non è possibile prenotare uno slot nel passato.");
            }

            // Lo slot deve risultare esplicitamente disponibile.
            if (slot.Status != SlotStatus.Available)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    409,
                    "slot_not_available",
                    "Lo slot selezionato non è più disponibile.");
            }

            // Verifica l'assenza di un altro appuntamento attivo già associato allo slot.
            var hasActiveAppointment = await _schedulingRepository
                .ExistsActiveAppointmentForSlotAsync(slot.Id, cancellationToken)
                .ConfigureAwait(false);

            if (hasActiveAppointment)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    409,
                    "slot_already_booked",
                    "Lo slot selezionato risulta già prenotato.");
            }

            // Recupera il calendario per risalire al clinico associato allo slot.
            var calendar = await _schedulingRepository
                .GetCalendarByIdAsync(slot.CalendarId, cancellationToken)
                .ConfigureAwait(false);

            if (calendar == null)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    500,
                    "calendar_not_found",
                    "La configurazione di agenda associata allo slot non è valida.");
            }

            // Costruisce la nuova entità Appointment con i dati economici e clinici derivati
            // dalla prestazione e dal calendario associato.
            var appointment = new Appointment
            {
                Id = Guid.NewGuid(),
                SlotId = slot.Id,
                PatientUserId = patientUserId,
                ClinicianUserId = calendar.ClinicianUserId,
                ServiceId = request.ServiceId,
                ServiceCode = service.Code,
                QuotedPriceCents = service.BasePriceCents,
                Currency = service.Currency,
                Status = AppointmentStatus.Booked,
                Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
                CreatedAtUtc = nowUtc,
                UpdatedAtUtc = nowUtc
            };

            try
            {
                await _schedulingRepository
                    .AddAppointmentAsync(appointment, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (DbUpdateException)
            {
                // Gestisce eventuali race condition concorrenti sulla prenotazione dello stesso slot.
                return OperationResult<PatientAppointmentDto>.Failure(
                    409,
                    "slot_already_booked",
                    "Lo slot selezionato risulta già prenotato.");
            }

            // Pianifica le notifiche di conferma prenotazione.
            await _notificationSchedulingService
                .ScheduleAppointmentBookedNotificationsAsync(
                    appointment,
                    slot.StartUtc,
                    slot.EndUtc,
                    cancellationToken)
                .ConfigureAwait(false);

            var dto = new PatientAppointmentDto(
                appointment.Id,
                appointment.SlotId,
                appointment.ClinicianUserId,
                appointment.ServiceId,
                appointment.ServiceCode,
                appointment.QuotedPriceCents,
                appointment.Currency,
                appointment.Status.ToString(),
                slot.StartUtc,
                slot.EndUtc,
                appointment.Notes);

            return OperationResult<PatientAppointmentDto>.Success(dto);
        }

        /*
         * Annulla un appuntamento del paziente autenticato,
         * purché l'appuntamento esista, appartenga al paziente e sia ancora annullabile.
         */
        public async Task<OperationResult<PatientAppointmentDto>> CancelAppointmentAsync(
            Guid patientUserId,
            Guid appointmentId,
            CancelAppointmentRequest request,
            CancellationToken cancellationToken)
        {
            // Recupera l'appuntamento da annullare.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment == null)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    404,
                    "appointment_not_found",
                    "L'appuntamento specificato non esiste.");
            }

            // L'utente può operare soltanto sui propri appuntamenti.
            if (appointment.PatientUserId != patientUserId)
            {
                return OperationResult<PatientAppointmentDto>.Forbidden(
                    "appointment_access_forbidden",
                    "L'appuntamento specificato non appartiene all'utente corrente.");
            }

            // Solo gli appuntamenti attualmente prenotati possono essere annullati.
            if (appointment.Status != AppointmentStatus.Booked)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    400,
                    "invalid_status_transition",
                    "Solo gli appuntamenti in stato 'Booked' possono essere annullati.");
            }

            // Recupera lo slot associato per applicare il vincolo temporale di annullamento.
            var slot = await _schedulingRepository
                .GetSlotByIdAsync(appointment.SlotId, cancellationToken)
                .ConfigureAwait(false);

            if (slot == null)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    500,
                    "slot_not_found",
                    "Lo slot associato all'appuntamento non è più presente.");
            }

            var nowUtc = DateTime.UtcNow;

            // Dopo l'inizio dello slot l'annullamento non è più consentito.
            if (slot.StartUtc <= nowUtc)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    400,
                    "too_late_to_cancel",
                    "Non è più possibile annullare l'appuntamento perché l'orario è già stato raggiunto.");
            }

            var previousStatus = appointment.Status;
            appointment.Status = AppointmentStatus.Canceled;
            appointment.UpdatedAtUtc = nowUtc;

            await _schedulingRepository
                .UpdateAppointmentAsync(appointment, cancellationToken)
                .ConfigureAwait(false);

            // Registra il cambio di stato nel relativo storico.
            var statusChange = new AppointmentStatusChange
            {
                Id = Guid.NewGuid(),
                AppointmentId = appointment.Id,
                FromStatus = previousStatus,
                ToStatus = AppointmentStatus.Canceled,
                ChangedAtUtc = nowUtc,
                ChangedByUserId = patientUserId,
                Reason = request?.Reason
            };

            await _schedulingRepository
                .AddStatusChangeAsync(statusChange, cancellationToken)
                .ConfigureAwait(false);

            // Pianifica la notifica di annullamento.
            await _notificationSchedulingService
                .ScheduleAppointmentCanceledNotificationAsync(
                    appointment,
                    slot.StartUtc,
                    request?.Reason,
                    cancellationToken)
                .ConfigureAwait(false);

            var dto = new PatientAppointmentDto(
                appointment.Id,
                appointment.SlotId,
                appointment.ClinicianUserId,
                appointment.ServiceId,
                appointment.ServiceCode,
                appointment.QuotedPriceCents,
                appointment.Currency,
                appointment.Status.ToString(),
                slot.StartUtc,
                slot.EndUtc,
                appointment.Notes);

            return OperationResult<PatientAppointmentDto>.Success(dto);
        }

        /*
         * Ripianifica un appuntamento esistente del paziente verso un nuovo slot disponibile,
         * mantenendo la prenotazione attiva ma aggiornandone i riferimenti temporali e clinici.
         */
        public async Task<OperationResult<PatientAppointmentDto>> RescheduleAppointmentAsync(
            Guid patientUserId,
            Guid appointmentId,
            RescheduleAppointmentRequest request,
            CancellationToken cancellationToken)
        {
            // Recupera l'appuntamento da ripianificare.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment == null)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    404,
                    "appointment_not_found",
                    "L'appuntamento specificato non esiste.");
            }

            // L'utente può operare soltanto sui propri appuntamenti.
            if (appointment.PatientUserId != patientUserId)
            {
                return OperationResult<PatientAppointmentDto>.Forbidden(
                    "appointment_access_forbidden",
                    "L'appuntamento specificato non appartiene all'utente corrente.");
            }

            // Solo gli appuntamenti attualmente prenotati possono essere ripianificati.
            if (appointment.Status != AppointmentStatus.Booked)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    400,
                    "invalid_status_transition",
                    "Solo gli appuntamenti in stato 'Booked' possono essere ripianificati.");
            }

            // La ripianificazione deve puntare a uno slot effettivamente diverso da quello corrente.
            if (appointment.SlotId == request.NewSlotId)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    400,
                    "slot_unchanged",
                    "Lo slot selezionato coincide con quello attuale.");
            }

            // Recupera lo slot corrente e il nuovo slot richiesto.
            var currentSlot = await _schedulingRepository
                .GetSlotByIdAsync(appointment.SlotId, cancellationToken)
                .ConfigureAwait(false);

            if (currentSlot == null)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    500,
                    "slot_not_found",
                    "Lo slot corrente associato all'appuntamento non è più presente.");
            }

            var newSlot = await _schedulingRepository
                .GetSlotByIdAsync(request.NewSlotId, cancellationToken)
                .ConfigureAwait(false);

            if (newSlot == null)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    404,
                    "slot_not_found",
                    "Il nuovo slot selezionato non esiste.");
            }

            var nowUtc = DateTime.UtcNow;

            // Non consente ripianificazioni verso slot già nel passato.
            if (newSlot.StartUtc <= nowUtc)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    400,
                    "slot_in_past",
                    "Non è possibile ripianificare su uno slot nel passato.");
            }

            // Il nuovo slot deve risultare disponibile.
            if (newSlot.Status != SlotStatus.Available)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    409,
                    "slot_not_available",
                    "Il nuovo slot selezionato non è più disponibile.");
            }

            // Verifica l'assenza di altri appuntamenti attivi sul nuovo slot.
            var hasActiveAppointment = await _schedulingRepository
                .ExistsActiveAppointmentForSlotAsync(newSlot.Id, cancellationToken)
                .ConfigureAwait(false);

            if (hasActiveAppointment)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    409,
                    "slot_already_booked",
                    "Il nuovo slot selezionato risulta già prenotato.");
            }

            // Recupera il calendario del nuovo slot per aggiornare il clinico associato.
            var newCalendar = await _schedulingRepository
                .GetCalendarByIdAsync(newSlot.CalendarId, cancellationToken)
                .ConfigureAwait(false);

            if (newCalendar == null)
            {
                return OperationResult<PatientAppointmentDto>.Failure(
                    500,
                    "calendar_not_found",
                    "La configurazione di agenda associata al nuovo slot non è valida.");
            }

            var previousStatus = appointment.Status;

            // Aggiorna i riferimenti dell'appuntamento mantenendo invariato lo stato logico.
            appointment.SlotId = newSlot.Id;
            appointment.ClinicianUserId = newCalendar.ClinicianUserId;
            appointment.UpdatedAtUtc = nowUtc;

            if (!string.IsNullOrWhiteSpace(request.Notes))
            {
                appointment.Notes = request.Notes.Trim();
            }

            await _schedulingRepository
                .UpdateAppointmentAsync(appointment, cancellationToken)
                .ConfigureAwait(false);

            // Registra il cambio di stato/contesto nel relativo storico.
            var statusChange = new AppointmentStatusChange
            {
                Id = Guid.NewGuid(),
                AppointmentId = appointment.Id,
                FromStatus = previousStatus,
                ToStatus = appointment.Status,
                ChangedAtUtc = nowUtc,
                ChangedByUserId = patientUserId,
                Reason = request.Reason
            };

            await _schedulingRepository
                .AddStatusChangeAsync(statusChange, cancellationToken)
                .ConfigureAwait(false);

            // Pianifica la notifica di ripianificazione.
            await _notificationSchedulingService
                .ScheduleAppointmentRescheduledNotificationAsync(
                    appointment,
                    currentSlot.StartUtc,
                    newSlot.StartUtc,
                    newSlot.EndUtc,
                    request.Reason,
                    cancellationToken)
                .ConfigureAwait(false);

            var dto = new PatientAppointmentDto(
                appointment.Id,
                appointment.SlotId,
                appointment.ClinicianUserId,
                appointment.ServiceId,
                appointment.ServiceCode,
                appointment.QuotedPriceCents,
                appointment.Currency,
                appointment.Status.ToString(),
                newSlot.StartUtc,
                newSlot.EndUtc,
                appointment.Notes);

            return OperationResult<PatientAppointmentDto>.Success(dto);
        }

        /*
         * Record interno usato per rappresentare le informazioni pubbliche minime
         * del clinico da esporre insieme agli slot disponibili.
         */
        private sealed record ClinicianPublicInfo(string? Email, string? Specialty);

        /*
         * Carica in batch le informazioni pubbliche dei clinici richiesti,
         * aggregando e-mail utente e specializzazione del profilo clinico.
         */
        private async Task<Dictionary<Guid, ClinicianPublicInfo>> LoadClinicianPublicInfoAsync(
            IReadOnlyCollection<Guid> clinicianUserIds,
            CancellationToken cancellationToken)
        {
            var ids = clinicianUserIds
                .Where(id => id != Guid.Empty)
                .Distinct()
                .ToArray();

            var map = new Dictionary<Guid, ClinicianPublicInfo>(ids.Length);

            if (ids.Length == 0)
            {
                return map;
            }

            // Carica in parallelo i dati pubblici necessari per ciascun clinico.
            var tasks = ids.Select(async id =>
            {
                var user = await _userRepository.GetByIdAsync(id, cancellationToken).ConfigureAwait(false);
                var profile = await _clinicianProfileRepository.GetByUserIdAsync(id, cancellationToken).ConfigureAwait(false);

                return (Id: id, Email: user?.Email, Specialty: profile?.Specialty);
            });

            var results = await Task.WhenAll(tasks).ConfigureAwait(false);

            foreach (var r in results)
            {
                map[r.Id] = new ClinicianPublicInfo(r.Email, r.Specialty);
            }

            return map;
        }

        /*
         * Determina se un consenso può essere considerato effettivamente concesso
         * e non successivamente revocato.
         */
        private static bool IsConsentGranted(Consent? consent)
        {
            return consent != null && consent.Granted && !consent.RevokedAtUtc.HasValue;
        }
    }
}
