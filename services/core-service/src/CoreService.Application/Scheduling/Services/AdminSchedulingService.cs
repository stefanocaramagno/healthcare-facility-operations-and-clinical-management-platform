/*
 * File: services/core-service/src/CoreService.Application/Scheduling/Services/AdminSchedulingService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso amministrativi del dominio Scheduling
 * relativi alla consultazione della disponibilità, alla gestione degli slot,
 * alla consultazione delle agende e alla gestione completa del ciclo di vita
 * degli appuntamenti lato amministratore.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Scheduling
 * e coordina i workflow applicativi che consentono all'amministratore di:
 * - consultare disponibilità e slot dei clinici;
 * - creare e aggiornare slot di agenda;
 * - consultare agende e appuntamenti;
 * - prenotare appuntamenti per conto dei pazienti;
 * - annullare, ripianificare, accettare e marcare come assenti gli appuntamenti.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare gli input applicativi relativi a date, stati e payload.
 * - Coordinare repository di scheduling, catalogo, registry e notifiche.
 * - Applicare le regole di business amministrative sugli slot e sugli appuntamenti.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - ISchedulingRepository
 * - IServiceCatalogRepository
 * - IPatientProfileRepository
 * - IClinicianProfileRepository
 * - IConsentRepository
 * - IUserRepository
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
    public sealed class AdminSchedulingService
    {
        // Repository e servizi applicativi collaboratori necessari
        // ai workflow amministrativi del dominio Scheduling.
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly IServiceCatalogRepository _serviceCatalogRepository;
        private readonly IPatientProfileRepository _patientProfileRepository;
        private readonly IClinicianProfileRepository _clinicianProfileRepository;
        private readonly IConsentRepository _consentRepository;
        private readonly IUserRepository _userRepository;
        private readonly NotificationSchedulingService _notificationSchedulingService;

        /*
         * Inizializza il servizio amministrativo di scheduling
         * con tutte le dipendenze necessarie ai relativi workflow applicativi.
         */
        public AdminSchedulingService(
            ISchedulingRepository schedulingRepository,
            IServiceCatalogRepository serviceCatalogRepository,
            IPatientProfileRepository patientProfileRepository,
            IClinicianProfileRepository clinicianProfileRepository,
            IConsentRepository consentRepository,
            IUserRepository userRepository,
            NotificationSchedulingService notificationSchedulingService)
        {
            _schedulingRepository = schedulingRepository
                ?? throw new ArgumentNullException(nameof(schedulingRepository));
            _serviceCatalogRepository = serviceCatalogRepository
                ?? throw new ArgumentNullException(nameof(serviceCatalogRepository));
            _patientProfileRepository = patientProfileRepository
                ?? throw new ArgumentNullException(nameof(patientProfileRepository));
            _clinicianProfileRepository = clinicianProfileRepository
                ?? throw new ArgumentNullException(nameof(clinicianProfileRepository));
            _consentRepository = consentRepository
                ?? throw new ArgumentNullException(nameof(consentRepository));
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
            _notificationSchedulingService = notificationSchedulingService
                ?? throw new ArgumentNullException(nameof(notificationSchedulingService));
        }

        /*
         * Recupera la disponibilità prenotabile dei clinici nel range temporale richiesto,
         * arricchendo gli slot con informazioni pubbliche sul clinico associato.
         */
        public async Task<OperationResult<IReadOnlyList<AvailabilitySlotDto>>> GetAvailabilityAsync(
            Guid? clinicianUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken)
        {
            var nowUtc = DateTime.UtcNow;

            // Normalizza gli estremi temporali opzionali imponendo semantica UTC esplicita.
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

            // Definisce il range effettivo di ricerca con valori di default lato amministrativo.
            var effectiveFrom = normalizedFromUtc ?? nowUtc;
            var effectiveTo = normalizedToUtc ?? effectiveFrom.AddDays(30);

            // Verifica la coerenza dell'intervallo richiesto.
            if (effectiveFrom >= effectiveTo)
            {
                return OperationResult<IReadOnlyList<AvailabilitySlotDto>>.BadRequest(
                    "invalid_date_range",
                    "Il parametro 'fromUtc' deve essere precedente a 'toUtc'.");
            }

            // Recupera gli slot disponibili nel range richiesto.
            var slots = await _schedulingRepository
                .GetAvailableSlotsAsync(clinicianUserId, effectiveFrom, effectiveTo, cancellationToken)
                .ConfigureAwait(false);

            if (slots.Count == 0)
            {
                return OperationResult<IReadOnlyList<AvailabilitySlotDto>>
                    .Success(Array.Empty<AvailabilitySlotDto>());
            }

            // Costruisce una cache dei calendari coinvolti per evitare accessi ripetuti.
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

            // Estrae l'insieme dei clinici coinvolti per arricchire gli slot con dati pubblici.
            var clinicianIds = calendarsById.Values
                .Select(c => c.ClinicianUserId)
                .Where(id => id != Guid.Empty)
                .Distinct()
                .ToArray();

            var clinicianInfo = await LoadClinicianPublicInfoAsync(clinicianIds, cancellationToken)
                .ConfigureAwait(false);

            var result = new List<AvailabilitySlotDto>(slots.Count);

            // Mappa ciascuno slot nel DTO finale arricchito con email e specializzazione del clinico.
            foreach (var slot in slots)
            {
                calendarsById.TryGetValue(slot.CalendarId, out var calendar);
                var clinicianIdResolved = calendar?.ClinicianUserId ?? Guid.Empty;

                clinicianInfo.TryGetValue(clinicianIdResolved, out var info);

                result.Add(new AvailabilitySlotDto(
                    slot.Id,
                    slot.CalendarId,
                    clinicianIdResolved,
                    info?.Email,
                    info?.Specialty,
                    slot.StartUtc,
                    slot.EndUtc));
            }

            return OperationResult<IReadOnlyList<AvailabilitySlotDto>>.Success(result.AsReadOnly());
        }

        /*
         * Recupera tutti gli slot di un clinico nel range richiesto,
         * con eventuale filtro per stato.
         */
        public async Task<OperationResult<IReadOnlyList<AdminSlotDto>>> GetClinicianSlotsAsync(
            Guid clinicianUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            string? status,
            CancellationToken cancellationToken)
        {
            var nowUtc = DateTime.UtcNow;

            // Normalizza gli estremi temporali opzionali imponendo semantica UTC esplicita.
            if (!UtcDateTimeInput.TryNormalizeOptional(fromUtc, "fromUtc", out var normalizedFromUtc, out var fromError))
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                    "invalid_datetime",
                    fromError!);
            }

            if (!UtcDateTimeInput.TryNormalizeOptional(toUtc, "toUtc", out var normalizedToUtc, out var toError))
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                    "invalid_datetime",
                    toError!);
            }

            // Definisce il range effettivo di ricerca.
            var effectiveFrom = normalizedFromUtc ?? nowUtc;
            var effectiveTo = normalizedToUtc ?? effectiveFrom.AddDays(30);

            if (effectiveFrom >= effectiveTo)
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                    "invalid_date_range",
                    "Il parametro 'fromUtc' deve essere precedente a 'toUtc'.");
            }

            // Verifica l'esistenza del clinico.
            var clinicianProfile = await _clinicianProfileRepository
                .GetByUserIdAsync(clinicianUserId, cancellationToken)
                .ConfigureAwait(false);

            if (clinicianProfile == null)
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>.NotFound(
                    "clinician_not_found",
                    "Il clinico specificato non esiste.");
            }

            // Recupera il calendario del clinico.
            var calendar = await _schedulingRepository
                .GetCalendarByClinicianUserIdAsync(clinicianUserId, cancellationToken)
                .ConfigureAwait(false);

            if (calendar == null)
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>
                    .Success(Array.Empty<AdminSlotDto>());
            }

            // Recupera gli slot del calendario nel range richiesto.
            var slots = await _schedulingRepository
                .GetSlotsForCalendarAsync(calendar.Id, effectiveFrom, effectiveTo, cancellationToken)
                .ConfigureAwait(false);

            if (slots.Count == 0)
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>
                    .Success(Array.Empty<AdminSlotDto>());
            }

            // Applica opzionalmente il filtro per stato se richiesto.
            SlotStatus? statusFilter = null;
            if (!string.IsNullOrWhiteSpace(status) && !string.Equals(status, "ALL", StringComparison.OrdinalIgnoreCase))
            {
                if (!TryParseSlotStatus(status, out var parsed))
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                        "invalid_status",
                        "Il parametro 'status' non è valido. Valori ammessi: ALL, Available, Reserved, Unavailable.");
                }

                statusFilter = parsed;
            }

            var result = slots
                .Where(s => !statusFilter.HasValue || s.Status == statusFilter.Value)
                .OrderBy(s => s.StartUtc)
                .Select(s => new AdminSlotDto(
                    s.Id,
                    s.CalendarId,
                    clinicianUserId,
                    s.StartUtc,
                    s.EndUtc,
                    s.Status.ToString(),
                    s.CreatedAtUtc))
                .ToList();

            return OperationResult<IReadOnlyList<AdminSlotDto>>.Success(result.AsReadOnly());
        }

        /*
         * Crea in batch nuovi slot per un determinato clinico,
         * applicando tutte le validazioni su range temporali, conflitti e stato iniziale.
         */
        public async Task<OperationResult<IReadOnlyList<AdminSlotDto>>> CreateSlotsForClinicianAsync(
            Guid adminUserId,
            Guid clinicianUserId,
            CreateAvailabilitySlotsRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null)
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                    "invalid_request",
                    "Il body della richiesta non può essere nullo.");
            }

            if (request.Slots is null || request.Slots.Length == 0)
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                    "invalid_request",
                    "È necessario specificare almeno uno slot da creare.");
            }

            if (request.Slots.Length > 500)
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                    "too_many_slots",
                    "È possibile creare al massimo 500 slot per richiesta.");
            }

            // Verifica l'esistenza del clinico.
            var clinicianProfile = await _clinicianProfileRepository
                .GetByUserIdAsync(clinicianUserId, cancellationToken)
                .ConfigureAwait(false);

            if (clinicianProfile == null)
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>.NotFound(
                    "clinician_not_found",
                    "Il clinico specificato non esiste.");
            }

            // Determina lo stato iniziale desiderato degli slot da creare.
            var desiredStatus = SlotStatus.Available;
            if (!string.IsNullOrWhiteSpace(request.DefaultStatus))
            {
                if (!TryParseSlotStatus(request.DefaultStatus!, out var parsed))
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                        "invalid_status",
                        "Il campo 'defaultStatus' non è valido. Valori ammessi: Available, Unavailable.");
                }

                if (parsed == SlotStatus.Reserved)
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                        "invalid_status",
                        "Non è consentito creare slot direttamente in stato 'Reserved'.");
                }

                desiredStatus = parsed;
            }

            var nowUtc = DateTime.UtcNow;

            // Recupera o crea il calendario del clinico.
            var calendar = await _schedulingRepository
                .GetCalendarByClinicianUserIdAsync(clinicianUserId, cancellationToken)
                .ConfigureAwait(false);

            if (calendar == null)
            {
                calendar = new ClinicianCalendar
                {
                    Id = Guid.NewGuid(),
                    ClinicianUserId = clinicianUserId,
                    TimeZone = "Europe/Rome",
                    CreatedAtUtc = nowUtc
                };

                await _schedulingRepository
                    .AddCalendarAsync(calendar, cancellationToken)
                    .ConfigureAwait(false);
            }

            var normalized = new List<(DateTime startUtc, DateTime endUtc)>(request.Slots.Length);

            // Normalizza e valida ciascuno slot richiesto.
            for (var i = 0; i < request.Slots.Length; i++)
            {
                var item = request.Slots[i];

                if (!UtcDateTimeInput.TryNormalizeRequired(item.StartUtc, $"slots[{i}].startUtc", out var start, out var startError))
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                        "invalid_datetime",
                        startError!);
                }

                if (!UtcDateTimeInput.TryNormalizeRequired(item.EndUtc, $"slots[{i}].endUtc", out var end, out var endError))
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                        "invalid_datetime",
                        endError!);
                }

                if (start >= end)
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                        "invalid_slot_range",
                        "Ogni slot deve avere StartUtc precedente a EndUtc.");
                }

                if (start <= nowUtc)
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                        "slot_in_past",
                        "Non è possibile creare slot nel passato.");
                }

                var durationMinutes = (end - start).TotalMinutes;

                if (durationMinutes < 10)
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                        "slot_too_short",
                        "La durata minima di uno slot è 10 minuti.");
                }

                if (durationMinutes > 8 * 60)
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.BadRequest(
                        "slot_too_long",
                        "La durata massima di uno slot è 8 ore.");
                }

                normalized.Add((start, end));
            }

            var ordered = normalized
                .OrderBy(x => x.startUtc)
                .ToList();

            // Verifica l'assenza di sovrapposizioni interne alla richiesta batch.
            for (var i = 1; i < ordered.Count; i++)
            {
                var prev = ordered[i - 1];
                var cur = ordered[i];

                if (IntervalsOverlap(prev.startUtc, prev.endUtc, cur.startUtc, cur.endUtc))
                {
                    return OperationResult<IReadOnlyList<AdminSlotDto>>.Conflict(
                        "slot_overlap",
                        "La richiesta contiene slot sovrapposti tra loro.");
                }
            }

            var minStart = ordered.First().startUtc;
            var maxEnd = ordered.Last().endUtc;

            // Verifica l'assenza di conflitti con slot già presenti nel calendario.
            var existing = await _schedulingRepository
                .GetSlotsOverlappingRangeAsync(calendar.Id, minStart, maxEnd, cancellationToken)
                .ConfigureAwait(false);

            if (existing.Count > 0)
            {
                foreach (var ex in existing)
                {
                    foreach (var req in ordered)
                    {
                        if (IntervalsOverlap(ex.StartUtc, ex.EndUtc, req.startUtc, req.endUtc))
                        {
                            return OperationResult<IReadOnlyList<AdminSlotDto>>.Conflict(
                                "slot_overlap",
                                "Uno o più slot richiesti si sovrappongono a slot già presenti nel calendario del clinico.");
                        }
                    }
                }
            }

            // Costruisce le entità AvailabilitySlot da inserire.
            var toInsert = ordered.Select(r => new AvailabilitySlot
            {
                Id = Guid.NewGuid(),
                CalendarId = calendar.Id,
                StartUtc = r.startUtc,
                EndUtc = r.endUtc,
                Status = desiredStatus,
                CreatedAtUtc = nowUtc
            }).ToList();

            try
            {
                await _schedulingRepository
                    .AddSlotsAsync(toInsert, cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (DbUpdateException)
            {
                return OperationResult<IReadOnlyList<AdminSlotDto>>.Conflict(
                    "slot_conflict",
                    "Impossibile creare gli slot: uno o più elementi risultano già presenti o in conflitto.");
            }

            // Mappa gli slot creati nel DTO di output.
            var created = toInsert
                .OrderBy(s => s.StartUtc)
                .Select(s => new AdminSlotDto(
                    s.Id,
                    s.CalendarId,
                    clinicianUserId,
                    s.StartUtc,
                    s.EndUtc,
                    s.Status.ToString(),
                    s.CreatedAtUtc))
                .ToList();

            return OperationResult<IReadOnlyList<AdminSlotDto>>.Success(created.AsReadOnly());
        }

        /*
         * Aggiorna lo stato di uno slot esistente,
         * applicando i vincoli di coerenza con eventuali appuntamenti attivi.
         */
        public async Task<OperationResult<AdminSlotDto>> UpdateSlotStatusAsync(
            Guid adminUserId,
            Guid slotId,
            UpdateSlotStatusRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null)
            {
                return OperationResult<AdminSlotDto>.BadRequest(
                    "invalid_request",
                    "Il body della richiesta non può essere nullo.");
            }

            if (string.IsNullOrWhiteSpace(request.Status))
            {
                return OperationResult<AdminSlotDto>.BadRequest(
                    "invalid_status",
                    "Il campo 'status' è obbligatorio.");
            }

            // Valida il nuovo stato richiesto.
            if (!TryParseSlotStatus(request.Status, out var desiredStatus))
            {
                return OperationResult<AdminSlotDto>.BadRequest(
                    "invalid_status",
                    "Il campo 'status' non è valido. Valori ammessi: Available, Reserved, Unavailable.");
            }

            // Recupera lo slot da aggiornare.
            var slot = await _schedulingRepository
                .GetSlotByIdAsync(slotId, cancellationToken)
                .ConfigureAwait(false);

            if (slot == null)
            {
                return OperationResult<AdminSlotDto>.NotFound(
                    "slot_not_found",
                    "Lo slot specificato non esiste.");
            }

            // Non permette di rendere indisponibile uno slot con appuntamento attivo.
            if (desiredStatus == SlotStatus.Unavailable)
            {
                var hasActive = await _schedulingRepository
                    .ExistsActiveAppointmentForSlotAsync(slot.Id, cancellationToken)
                    .ConfigureAwait(false);

                if (hasActive)
                {
                    return OperationResult<AdminSlotDto>.Conflict(
                        "slot_has_active_appointment",
                        "Non è possibile rendere indisponibile lo slot perché risulta associato a un appuntamento attivo.");
                }
            }

            slot.Status = desiredStatus;

            await _schedulingRepository
                .UpdateSlotAsync(slot, cancellationToken)
                .ConfigureAwait(false);

            // Recupera il calendario per risalire al clinico associato.
            var calendar = await _schedulingRepository
                .GetCalendarByIdAsync(slot.CalendarId, cancellationToken)
                .ConfigureAwait(false);

            var clinicianUserId = calendar?.ClinicianUserId ?? Guid.Empty;

            var dto = new AdminSlotDto(
                slot.Id,
                slot.CalendarId,
                clinicianUserId,
                slot.StartUtc,
                slot.EndUtc,
                slot.Status.ToString(),
                slot.CreatedAtUtc);

            return OperationResult<AdminSlotDto>.Success(dto);
        }

        /*
         * Tenta di convertire una rappresentazione testuale
         * nel corrispondente valore dell'enum SlotStatus.
         */
        private static bool TryParseSlotStatus(
            string value,
            out SlotStatus status)
        {
            return Enum.TryParse(value, ignoreCase: true, out status);
        }

        /*
         * Verifica se due intervalli temporali risultano sovrapposti.
         */
        private static bool IntervalsOverlap(
            DateTime aStartUtc,
            DateTime aEndUtc,
            DateTime bStartUtc,
            DateTime bEndUtc)
        {
            return aStartUtc < bEndUtc && aEndUtc > bStartUtc;
        }

        /*
         * Recupera l'agenda di un clinico nel range temporale richiesto,
         * arricchendo ogni appuntamento con il nominativo del paziente.
         */
        public async Task<OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>> GetClinicianAgendaAsync(
            Guid clinicianUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken)
        {
            var nowUtc = DateTime.UtcNow;

            // Normalizza gli estremi temporali opzionali imponendo semantica UTC esplicita.
            if (!UtcDateTimeInput.TryNormalizeOptional(fromUtc, "fromUtc", out var normalizedFromUtc, out var fromError))
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.BadRequest(
                    "invalid_datetime",
                    fromError!);
            }

            if (!UtcDateTimeInput.TryNormalizeOptional(toUtc, "toUtc", out var normalizedToUtc, out var toError))
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.BadRequest(
                    "invalid_datetime",
                    toError!);
            }

            var effectiveFrom = normalizedFromUtc ?? nowUtc.AddDays(-7);
            var effectiveTo = normalizedToUtc ?? nowUtc.AddDays(30);

            if (effectiveFrom >= effectiveTo)
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.BadRequest(
                    "invalid_date_range",
                    "Il parametro 'fromUtc' deve essere precedente a 'toUtc'.");
            }

            // Recupera gli appuntamenti del clinico con i relativi slot.
            var items = await _schedulingRepository
                .GetAppointmentsForClinicianWithSlotsAsync(
                    clinicianUserId,
                    effectiveFrom,
                    effectiveTo,
                    cancellationToken)
                .ConfigureAwait(false);

            if (items.Count == 0)
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>
                    .Success(Array.Empty<ClinicianAgendaItemDto>());
            }

            // Cache locale dei profili paziente per evitare accessi ripetuti.
            var patientProfiles = new Dictionary<Guid, PatientProfile>();
            var result = new List<ClinicianAgendaItemDto>(items.Count);

            foreach (var item in items)
            {
                var appointment = item.appointment;
                var slot = item.slot;

                if (!patientProfiles.TryGetValue(appointment.PatientUserId, out var patientProfile))
                {
                    patientProfile = await _patientProfileRepository
                        .GetByUserIdAsync(appointment.PatientUserId, cancellationToken)
                        .ConfigureAwait(false);

                    if (patientProfile != null)
                    {
                        patientProfiles[appointment.PatientUserId] = patientProfile;
                    }
                }

                var patientDisplayName = patientProfile == null
                    ? string.Empty
                    : string.Concat(patientProfile.FirstName, " ", patientProfile.LastName);

                result.Add(new ClinicianAgendaItemDto(
                    appointment.Id,
                    appointment.SlotId,
                    appointment.PatientUserId,
                    patientDisplayName,
                    appointment.ServiceId,
                    appointment.ServiceCode,
                    appointment.Status.ToString(),
                    slot.StartUtc,
                    slot.EndUtc,
                    appointment.Notes));
            }

            return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.Success(result.AsReadOnly());
        }

        /*
         * Recupera l'elenco di tutti gli appuntamenti nel range richiesto,
         * arricchendo ogni elemento con il nominativo del paziente.
         */
        public async Task<OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>> GetAppointmentsAsync(
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken)
        {
            var nowUtc = DateTime.UtcNow;

            // Normalizza gli estremi temporali opzionali imponendo semantica UTC esplicita.
            if (!UtcDateTimeInput.TryNormalizeOptional(fromUtc, "fromUtc", out var normalizedFromUtc, out var fromError))
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.BadRequest(
                    "invalid_datetime",
                    fromError!);
            }

            if (!UtcDateTimeInput.TryNormalizeOptional(toUtc, "toUtc", out var normalizedToUtc, out var toError))
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.BadRequest(
                    "invalid_datetime",
                    toError!);
            }

            var effectiveFrom = normalizedFromUtc ?? nowUtc.AddDays(-1);
            var effectiveTo = normalizedToUtc ?? nowUtc.AddDays(1);

            if (effectiveFrom >= effectiveTo)
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.BadRequest(
                    "invalid_date_range",
                    "Il parametro 'fromUtc' deve essere precedente a 'toUtc'.");
            }

            // Recupera tutti gli appuntamenti nel range con i relativi slot.
            var items = await _schedulingRepository
                .GetAppointmentsWithSlotsAsync(effectiveFrom, effectiveTo, cancellationToken)
                .ConfigureAwait(false);

            if (items.Count == 0)
            {
                return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>
                    .Success(Array.Empty<ClinicianAgendaItemDto>());
            }

            // Cache locale dei profili paziente per evitare accessi ripetuti.
            var patientProfiles = new Dictionary<Guid, PatientProfile>();
            var result = new List<ClinicianAgendaItemDto>(items.Count);

            foreach (var item in items)
            {
                var appointment = item.appointment;
                var slot = item.slot;

                if (!patientProfiles.TryGetValue(appointment.PatientUserId, out var patientProfile))
                {
                    patientProfile = await _patientProfileRepository
                        .GetByUserIdAsync(appointment.PatientUserId, cancellationToken)
                        .ConfigureAwait(false);

                    if (patientProfile != null)
                    {
                        patientProfiles[appointment.PatientUserId] = patientProfile;
                    }
                }

                var patientDisplayName = patientProfile == null
                    ? string.Empty
                    : string.Concat(patientProfile.FirstName, " ", patientProfile.LastName);

                result.Add(new ClinicianAgendaItemDto(
                    appointment.Id,
                    appointment.SlotId,
                    appointment.PatientUserId,
                    patientDisplayName,
                    appointment.ServiceId,
                    appointment.ServiceCode,
                    appointment.Status.ToString(),
                    slot.StartUtc,
                    slot.EndUtc,
                    appointment.Notes));
            }

            return OperationResult<IReadOnlyList<ClinicianAgendaItemDto>>.Success(result.AsReadOnly());
        }

        /*
         * Prenota un appuntamento per conto di un paziente,
         * applicando i controlli su paziente, prestazione, slot e consensi obbligatori.
         */
        public async Task<OperationResult<PatientAppointmentDto>> BookAppointmentForPatientAsync(
            Guid adminUserId,
            AdminBookAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null)
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "invalid_request",
                    "Il body della richiesta non può essere nullo.");
            }

            // Verifica l'esistenza del paziente.
            var patientProfile = await _patientProfileRepository
                .GetByUserIdAsync(request.PatientUserId, cancellationToken)
                .ConfigureAwait(false);

            if (patientProfile == null)
            {
                return OperationResult<PatientAppointmentDto>.NotFound(
                    "patient_not_found",
                    "Il paziente specificato non esiste.");
            }

            // Verifica l'esistenza della prestazione richiesta.
            var service = await _serviceCatalogRepository
                .GetByIdAsync(request.ServiceId, cancellationToken)
                .ConfigureAwait(false);

            if (service == null)
            {
                return OperationResult<PatientAppointmentDto>.NotFound(
                    "service_not_found",
                    "La prestazione richiesta non esiste.");
            }

            // Verifica l'esistenza dello slot richiesto.
            var slot = await _schedulingRepository
                .GetSlotByIdAsync(request.SlotId, cancellationToken)
                .ConfigureAwait(false);

            if (slot == null)
            {
                return OperationResult<PatientAppointmentDto>.NotFound(
                    "slot_not_found",
                    "Lo slot di disponibilità richiesto non esiste.");
            }

            var nowUtc = DateTime.UtcNow;

            if (slot.StartUtc <= nowUtc)
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "slot_in_past",
                    "Non è possibile prenotare uno slot nel passato.");
            }

            if (slot.Status != SlotStatus.Available)
            {
                return OperationResult<PatientAppointmentDto>.Conflict(
                    "slot_not_available",
                    "Lo slot selezionato non è più disponibile.");
            }

            // Verifica che lo slot non sia già associato a un appuntamento attivo.
            var hasActiveAppointment = await _schedulingRepository
                .ExistsActiveAppointmentForSlotAsync(slot.Id, cancellationToken)
                .ConfigureAwait(false);

            if (hasActiveAppointment)
            {
                return OperationResult<PatientAppointmentDto>.Conflict(
                    "slot_already_booked",
                    "Lo slot selezionato risulta già prenotato.");
            }

            // Recupera il calendario per determinare il clinico associato allo slot.
            var calendar = await _schedulingRepository
                .GetCalendarByIdAsync(slot.CalendarId, cancellationToken)
                .ConfigureAwait(false);

            if (calendar == null)
            {
                return OperationResult<PatientAppointmentDto>.ServerError(
                    "calendar_not_found",
                    "La configurazione di agenda associata allo slot non è valida.");
            }

            // Verifica la presenza dei consensi obbligatori del paziente.
            var hasRequiredConsents = await HasMandatoryTreatmentAndDataProcessingConsentsAsync(
                request.PatientUserId,
                cancellationToken);

            if (!hasRequiredConsents)
            {
                return OperationResult<PatientAppointmentDto>.Forbidden(
                    "missing_required_consents",
                    "Il paziente non ha fornito i consensi obbligatori al trattamento sanitario e al trattamento dei dati personali.");
            }

            // Costruisce la nuova entità Appointment.
            var appointment = new Appointment
            {
                Id = Guid.NewGuid(),
                SlotId = slot.Id,
                PatientUserId = request.PatientUserId,
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
                return OperationResult<PatientAppointmentDto>.Conflict(
                    "slot_already_booked",
                    "Lo slot selezionato risulta già prenotato.");
            }

            // Registra lo status change iniziale legato alla creazione dell'appuntamento.
            var statusChange = new AppointmentStatusChange
            {
                Id = Guid.NewGuid(),
                AppointmentId = appointment.Id,
                FromStatus = AppointmentStatus.Booked,
                ToStatus = AppointmentStatus.Booked,
                ChangedAtUtc = nowUtc,
                ChangedByUserId = adminUserId,
                Reason = "Appointment created by admin on behalf of patient."
            };

            await _schedulingRepository
                .AddStatusChangeAsync(statusChange, cancellationToken)
                .ConfigureAwait(false);

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
         * Annulla un appuntamento esistente,
         * purché sia ancora in stato Booked e non sia già trascorso l'orario utile.
         */
        public async Task<OperationResult<PatientAppointmentDto>> CancelAppointmentAsync(
            Guid adminUserId,
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
                return OperationResult<PatientAppointmentDto>.NotFound(
                    "appointment_not_found",
                    "L'appuntamento specificato non esiste.");
            }

            if (appointment.Status != AppointmentStatus.Booked)
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "invalid_status_transition",
                    "Solo gli appuntamenti in stato 'Booked' possono essere annullati.");
            }

            // Recupera lo slot associato per verificare i vincoli temporali.
            var slot = await _schedulingRepository
                .GetSlotByIdAsync(appointment.SlotId, cancellationToken)
                .ConfigureAwait(false);

            if (slot == null)
            {
                return OperationResult<PatientAppointmentDto>.ServerError(
                    "slot_not_found",
                    "Lo slot associato all'appuntamento non è più presente.");
            }

            var nowUtc = DateTime.UtcNow;

            if (slot.StartUtc <= nowUtc)
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "too_late_to_cancel",
                    "Non è più possibile annullare l'appuntamento perché l'orario è già stato raggiunto.");
            }

            var previousStatus = appointment.Status;
            appointment.Status = AppointmentStatus.Canceled;
            appointment.UpdatedAtUtc = nowUtc;

            await _schedulingRepository
                .UpdateAppointmentAsync(appointment, cancellationToken)
                .ConfigureAwait(false);

            // Registra lo status change di annullamento.
            var statusChange = new AppointmentStatusChange
            {
                Id = Guid.NewGuid(),
                AppointmentId = appointment.Id,
                FromStatus = previousStatus,
                ToStatus = AppointmentStatus.Canceled,
                ChangedAtUtc = nowUtc,
                ChangedByUserId = adminUserId,
                Reason = request?.Reason
            };

            await _schedulingRepository
                .AddStatusChangeAsync(statusChange, cancellationToken)
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
         * Ripianifica un appuntamento esistente verso un nuovo slot disponibile,
         * mantenendo lo stato Booked ma aggiornando slot, clinico e notifiche.
         */
        public async Task<OperationResult<PatientAppointmentDto>> RescheduleAppointmentAsync(
            Guid adminUserId,
            Guid appointmentId,
            RescheduleAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null)
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "invalid_request",
                    "Il body della richiesta non può essere nullo.");
            }

            // Recupera l'appuntamento da ripianificare.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment == null)
            {
                return OperationResult<PatientAppointmentDto>.NotFound(
                    "appointment_not_found",
                    "L'appuntamento specificato non esiste.");
            }

            if (appointment.Status != AppointmentStatus.Booked)
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "invalid_status_transition",
                    "Solo gli appuntamenti in stato 'Booked' possono essere ripianificati.");
            }

            // Recupera lo slot originario e il nuovo slot richiesto.
            var oldSlot = await _schedulingRepository
                .GetSlotByIdAsync(appointment.SlotId, cancellationToken)
                .ConfigureAwait(false);

            if (oldSlot == null)
            {
                return OperationResult<PatientAppointmentDto>.ServerError(
                    "slot_not_found",
                    "Lo slot associato all'appuntamento non è più presente.");
            }

            var newSlot = await _schedulingRepository
                .GetSlotByIdAsync(request.NewSlotId, cancellationToken)
                .ConfigureAwait(false);

            if (newSlot == null)
            {
                return OperationResult<PatientAppointmentDto>.NotFound(
                    "slot_not_found",
                    "Lo slot richiesto per la ripianificazione non esiste.");
            }

            var nowUtc = DateTime.UtcNow;

            if (newSlot.StartUtc <= nowUtc)
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "slot_in_past",
                    "Non è possibile ripianificare su uno slot nel passato.");
            }

            if (newSlot.Status != SlotStatus.Available)
            {
                return OperationResult<PatientAppointmentDto>.Conflict(
                    "slot_not_available",
                    "Lo slot selezionato non è disponibile.");
            }

            // Verifica che il nuovo slot non sia già impegnato da un altro appuntamento attivo.
            var hasActiveAppointment = await _schedulingRepository
                .ExistsActiveAppointmentForSlotAsync(newSlot.Id, cancellationToken)
                .ConfigureAwait(false);

            if (hasActiveAppointment)
            {
                return OperationResult<PatientAppointmentDto>.Conflict(
                    "slot_already_booked",
                    "Lo slot selezionato risulta già prenotato.");
            }

            // Recupera il calendario del nuovo slot per determinare il clinico aggiornato.
            var calendar = await _schedulingRepository
                .GetCalendarByIdAsync(newSlot.CalendarId, cancellationToken)
                .ConfigureAwait(false);

            if (calendar == null)
            {
                return OperationResult<PatientAppointmentDto>.ServerError(
                    "calendar_not_found",
                    "La configurazione di agenda associata allo slot non è valida.");
            }

            // Aggiorna l'appuntamento mantenendo lo stato Booked.
            appointment.SlotId = newSlot.Id;
            appointment.ClinicianUserId = calendar.ClinicianUserId;
            appointment.Notes = string.IsNullOrWhiteSpace(request.Notes) ? appointment.Notes : request.Notes.Trim();
            appointment.UpdatedAtUtc = nowUtc;

            await _schedulingRepository
                .UpdateAppointmentAsync(appointment, cancellationToken)
                .ConfigureAwait(false);

            // Registra lo status change di ripianificazione.
            var statusChange = new AppointmentStatusChange
            {
                Id = Guid.NewGuid(),
                AppointmentId = appointment.Id,
                FromStatus = AppointmentStatus.Booked,
                ToStatus = AppointmentStatus.Booked,
                ChangedAtUtc = nowUtc,
                ChangedByUserId = adminUserId,
                Reason = request.Reason
            };

            await _schedulingRepository
                .AddStatusChangeAsync(statusChange, cancellationToken)
                .ConfigureAwait(false);

            // Pianifica la notifica di ripianificazione.
            await _notificationSchedulingService
                .ScheduleAppointmentRescheduledNotificationAsync(
                    appointment,
                    oldSlot.StartUtc,
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
         * Esegue il check-in amministrativo di un appuntamento,
         * verificando finestra temporale e presenza dei consensi obbligatori.
         */
        public async Task<OperationResult<PatientAppointmentDto>> CheckInAppointmentAsync(
            Guid adminUserId,
            Guid appointmentId,
            CheckInAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            // Recupera l'appuntamento da accettare.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment == null)
            {
                return OperationResult<PatientAppointmentDto>.NotFound(
                    "appointment_not_found",
                    "L'appuntamento specificato non esiste.");
            }

            if (appointment.Status != AppointmentStatus.Booked)
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "invalid_status_transition",
                    "Solo gli appuntamenti in stato 'Booked' possono essere accettati.");
            }

            // Recupera lo slot per applicare i vincoli temporali del check-in.
            var slot = await _schedulingRepository
                .GetSlotByIdAsync(appointment.SlotId, cancellationToken)
                .ConfigureAwait(false);

            if (slot == null)
            {
                return OperationResult<PatientAppointmentDto>.ServerError(
                    "slot_not_found",
                    "Lo slot associato all'appuntamento non è più presente.");
            }

            var nowUtc = DateTime.UtcNow;

            if (slot.StartUtc > nowUtc.AddMinutes(30))
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "too_early_to_checkin",
                    "Il check-in può essere effettuato solo a partire da 30 minuti prima dell'orario dell'appuntamento.");
            }

            if (slot.StartUtc < nowUtc.AddHours(-2))
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "too_late_to_checkin",
                    "Non è più possibile accettare l'appuntamento perché sono trascorse più di 2 ore dall'orario previsto.");
            }

            // Verifica la presenza dei consensi obbligatori del paziente.
            var hasRequiredConsents = await HasMandatoryTreatmentAndDataProcessingConsentsAsync(
                appointment.PatientUserId,
                cancellationToken)
                .ConfigureAwait(false);

            if (!hasRequiredConsents)
            {
                return OperationResult<PatientAppointmentDto>.Forbidden(
                    "missing_required_consents",
                    "Non è possibile completare il check-in amministrativo: il paziente non ha fornito i consensi obbligatori al trattamento sanitario e al trattamento dei dati personali.");
            }

            var reason = string.IsNullOrWhiteSpace(request?.Reason) ? "ADMIN_CHECKIN" : request!.Reason!.Trim();

            appointment.Status = AppointmentStatus.CheckedIn;
            appointment.UpdatedAtUtc = nowUtc;

            await _schedulingRepository
                .UpdateAppointmentAsync(appointment, cancellationToken)
                .ConfigureAwait(false);

            // Registra lo status change di check-in.
            var statusChange = new AppointmentStatusChange
            {
                Id = Guid.NewGuid(),
                AppointmentId = appointment.Id,
                FromStatus = AppointmentStatus.Booked,
                ToStatus = AppointmentStatus.CheckedIn,
                ChangedAtUtc = nowUtc,
                ChangedByUserId = adminUserId,
                Reason = reason
            };

            await _schedulingRepository
                .AddStatusChangeAsync(statusChange, cancellationToken)
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
         * Marca un appuntamento come NoShow,
         * purché siano trascorse almeno due ore dall'inizio dello slot.
         */
        public async Task<OperationResult<PatientAppointmentDto>> MarkNoShowAppointmentAsync(
            Guid adminUserId,
            Guid appointmentId,
            MarkNoShowAppointmentRequest? request,
            CancellationToken cancellationToken)
        {
            // Recupera l'appuntamento da marcare come assente.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(appointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment == null)
            {
                return OperationResult<PatientAppointmentDto>.NotFound(
                    "appointment_not_found",
                    "L'appuntamento specificato non esiste.");
            }

            if (appointment.Status != AppointmentStatus.Booked)
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "invalid_status_transition",
                    "Solo gli appuntamenti in stato 'Booked' possono essere marcati come assenti.");
            }

            // Recupera lo slot per applicare i vincoli temporali del no-show.
            var slot = await _schedulingRepository
                .GetSlotByIdAsync(appointment.SlotId, cancellationToken)
                .ConfigureAwait(false);

            if (slot == null)
            {
                return OperationResult<PatientAppointmentDto>.ServerError(
                    "slot_not_found",
                    "Lo slot associato all'appuntamento non è più presente.");
            }

            var nowUtc = DateTime.UtcNow;

            if (nowUtc < slot.StartUtc.AddHours(2))
            {
                return OperationResult<PatientAppointmentDto>.BadRequest(
                    "too_early_to_mark_no_show",
                    "È possibile marcare l'appuntamento come assente solo dopo 2 ore dall'inizio dello slot.");
            }

            appointment.Status = AppointmentStatus.NoShow;
            appointment.UpdatedAtUtc = nowUtc;

            await _schedulingRepository
                .UpdateAppointmentAsync(appointment, cancellationToken)
                .ConfigureAwait(false);

            // Registra lo status change di no-show.
            var statusChange = new AppointmentStatusChange
            {
                Id = Guid.NewGuid(),
                AppointmentId = appointment.Id,
                FromStatus = AppointmentStatus.Booked,
                ToStatus = AppointmentStatus.NoShow,
                ChangedAtUtc = nowUtc,
                ChangedByUserId = adminUserId,
                Reason = string.IsNullOrWhiteSpace(request?.Reason) ? "ADMIN_NO_SHOW" : request!.Reason!.Trim()
            };

            await _schedulingRepository
                .AddStatusChangeAsync(statusChange, cancellationToken)
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
         * Record interno che rappresenta le informazioni pubbliche minime
         * del clinico da mostrare insieme agli slot di disponibilità.
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
         * Verifica che il paziente abbia concesso entrambi i consensi obbligatori:
         * trattamento sanitario e trattamento dei dati personali.
         */
        private async Task<bool> HasMandatoryTreatmentAndDataProcessingConsentsAsync(
            Guid patientUserId,
            CancellationToken cancellationToken)
        {
            var treatmentConsent = await _consentRepository
                .GetByPatientAndTypeAsync(patientUserId, ConsentType.Treatment, cancellationToken)
                .ConfigureAwait(false);

            var dataProcessingConsent = await _consentRepository
                .GetByPatientAndTypeAsync(patientUserId, ConsentType.DataProcessing, cancellationToken)
                .ConfigureAwait(false);

            return IsConsentGranted(treatmentConsent) && IsConsentGranted(dataProcessingConsent);
        }

        /*
         * Determina se un consenso può essere considerato effettivamente concesso.
         */
        private static bool IsConsentGranted(Consent? consent)
        {
            return consent != null && consent.Granted && !consent.RevokedAtUtc.HasValue;
        }
    }
}
