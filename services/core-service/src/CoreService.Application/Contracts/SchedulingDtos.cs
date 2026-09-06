/*
 * File: services/core-service/src/CoreService.Application/Contracts/SchedulingDtos.cs
 *
 * Scopo
 * -----
 * Definire i DTO e i contratti dati utilizzati dal dominio applicativo Scheduling
 * per la gestione di disponibilità, slot e appuntamenti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file raccoglie le strutture dati scambiate tra controller,
 * service layer e client per tutte le operazioni del dominio Scheduling.
 * I contratti descrivono sia payload di input sia payload di output
 * relativi a slot di disponibilità, appuntamenti e agenda clinica.
 *
 * Responsabilità principali
 * -------------------------
 * - Definire i DTO delle disponibilità e degli slot di calendario.
 * - Definire i payload per prenotazione, annullamento e ripianificazione appuntamenti.
 * - Definire i DTO delle viste agenda e delle operazioni amministrative.
 * - Definire i payload necessari alla creazione massiva di slot.
 *
 * Interazioni principali
 * ----------------------
 * - Controller del dominio Scheduling
 * - Service layer del dominio Scheduling
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
     * DTO che rappresenta uno slot di disponibilità prenotabile
     * esposto ai consumer applicativi.
     */
    public sealed record AvailabilitySlotDto(
        Guid Id,
        Guid CalendarId,
        Guid ClinicianUserId,
        string? ClinicianEmail,
        string? ClinicianSpecialty,
        DateTime StartUtc,
        DateTime EndUtc
    );

    /*
     * DTO di input usato per prenotare un appuntamento
     * a partire da uno slot disponibile.
     */
    public sealed record BookAppointmentRequest(
        Guid SlotId,
        Guid ServiceId,
        string? Notes
    );

    /*
     * DTO che rappresenta un appuntamento dal punto di vista del paziente
     * o di altri attori autorizzati alla consultazione operativa.
     */
    public sealed record PatientAppointmentDto(
        Guid Id,
        Guid SlotId,
        Guid ClinicianUserId,
        Guid ServiceId,
        string ServiceCode,
        int QuotedPriceCents,
        string Currency,
        string Status,
        DateTime StartUtc,
        DateTime EndUtc,
        string? Notes
    );

    /*
     * DTO di input usato per annullare un appuntamento,
     * con eventuale motivazione associata.
     */
    public sealed record CancelAppointmentRequest(
        string? Reason
    );

    /*
     * DTO di input usato per ripianificare un appuntamento
     * verso un nuovo slot disponibile.
     */
    public sealed record RescheduleAppointmentRequest(
        Guid NewSlotId,
        string? Reason,
        string? Notes
    );

    /*
     * DTO di input usato dall'amministratore per prenotare un appuntamento
     * per conto di un paziente specifico.
     */
    public sealed record AdminBookAppointmentRequest(
        Guid PatientUserId,
        Guid SlotId,
        Guid ServiceId,
        string? Notes
    );

    /*
     * DTO di input usato per registrare il check-in di un appuntamento,
     * con eventuali note o motivazioni operative.
     */
    public sealed record CheckInAppointmentRequest(
        string? Reason,
        string? Notes
    );

    /*
     * DTO di input usato per marcare un appuntamento come no-show,
     * con eventuale motivazione associata.
     */
    public sealed record MarkNoShowAppointmentRequest(
        string? Reason
    );

    /*
     * DTO che rappresenta una voce dell'agenda del clinico,
     * arricchita con informazioni sul paziente e sul servizio.
     */
    public sealed record ClinicianAgendaItemDto(
        Guid AppointmentId,
        Guid SlotId,
        Guid PatientUserId,
        string PatientDisplayName,
        Guid ServiceId,
        string ServiceCode,
        string Status,
        DateTime StartUtc,
        DateTime EndUtc,
        string? Notes
    );

    /*
     * DTO amministrativo che rappresenta uno slot del calendario clinico
     * con metadati utili alla gestione operativa.
     */
    public sealed record AdminSlotDto(
        Guid Id,
        Guid CalendarId,
        Guid ClinicianUserId,
        DateTime StartUtc,
        DateTime EndUtc,
        string Status,
        DateTime CreatedAtUtc
    );

    /*
     * DTO di input che rappresenta un singolo slot da creare
     * all'interno di una richiesta batch di disponibilità.
     */
    public sealed record CreateAvailabilitySlotItemRequest(
        DateTime StartUtc,
        DateTime EndUtc
    );

    /*
     * DTO di input usato per creare in batch più slot di disponibilità,
     * con eventuale stato di default da applicare.
     */
    public sealed record CreateAvailabilitySlotsRequest(
        CreateAvailabilitySlotItemRequest[] Slots,
        string? DefaultStatus
    );

    /*
     * DTO di input usato per aggiornare lo stato di uno slot esistente,
     * con eventuale motivazione operativa.
     */
    public sealed record UpdateSlotStatusRequest(
        string Status,
        string? Reason
    );
}
