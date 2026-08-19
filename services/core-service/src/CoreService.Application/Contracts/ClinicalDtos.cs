/*
 * File: services/core-service/src/CoreService.Application/Contracts/ClinicalDtos.cs
 *
 * Scopo
 * -----
 * Definire i DTO e i contratti dati utilizzati dal dominio applicativo Clinical
 * per la gestione del catalogo prestazioni, degli encounter clinici,
 * delle osservazioni mediche, degli ordini, delle esecuzioni,
 * dei referti e del pre-triage.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file raccoglie le strutture dati scambiate tra controller,
 * service layer e client per tutte le operazioni del dominio Clinical.
 * I contratti descrivono sia payload di input sia payload di output
 * relativi al ciclo di vita delle attività cliniche.
 *
 * Responsabilità principali
 * -------------------------
 * - Definire i DTO del catalogo delle prestazioni.
 * - Definire i DTO relativi agli encounter clinici e al loro dettaglio.
 * - Definire i payload per anamnesi, parametri vitali, ordini ed esecuzioni.
 * - Definire i DTO dei referti clinici e del pre-triage.
 *
 * Interazioni principali
 * ----------------------
 * - Controller del dominio Clinical
 * - Service layer del dominio Clinical
 * - Client frontend e altri consumer applicativi
 *
 * Note
 * ----
 * Questi tipi non contengono logica di business:
 * rappresentano esclusivamente contratti dati del layer Application.
 */

using System;
using System.Collections.Generic;

namespace CoreService.Application.Contracts
{
    /*
     * DTO che rappresenta una prestazione del catalogo clinico.
     */
    public sealed record ServiceCatalogItemDto(
        Guid Id,
        string Code,
        string Name,
        string? Description,
        int BasePriceCents,
        string Currency,
        bool IsActive
    );

    /*
     * DTO di input usato per creare una nuova prestazione nel catalogo.
     */
    public sealed record CreateServiceCatalogItemRequest(
        string Code,
        string Name,
        string? Description,
        int BasePriceCents,
        string Currency
    );

    /*
     * DTO di input usato per aggiornare una prestazione esistente del catalogo.
     */
    public sealed record UpdateServiceCatalogItemRequest(
        string Name,
        string? Description,
        int BasePriceCents,
        string Currency,
        bool IsActive
    );

    /*
     * DTO che rappresenta la vista sintetica di un encounter clinico.
     */
    public sealed record ClinicalEncounterSummaryDto(
        Guid Id,
        Guid AppointmentId,
        Guid PatientUserId,
        Guid ClinicianUserId,
        DateTime StartedAtUtc,
        DateTime? EndedAtUtc,
        string? Notes
    );

    /*
     * DTO che rappresenta il dettaglio completo di un encounter clinico,
     * comprensivo di tutte le sue componenti informative.
     */
    public sealed record ClinicalEncounterDetailDto(
        ClinicalEncounterSummaryDto Encounter,
        IReadOnlyList<AnamnesisRecordDto> Anamneses,
        IReadOnlyList<VitalSignDto> VitalSigns,
        IReadOnlyList<ClinicalOrderDto> Orders,
        IReadOnlyList<ProcedureExecutionDto> Executions,
        ClinicalReportDto? Report
    );

    /*
     * DTO di input usato per avviare un nuovo encounter clinico.
     */
    public sealed record CreateEncounterRequest(
        Guid AppointmentId,
        string? Notes
    );

    /*
     * DTO che rappresenta una registrazione anamnestica associata a un encounter.
     */
    public sealed record AnamnesisRecordDto(
        Guid Id,
        Guid EncounterId,
        string Content,
        DateTime CreatedAtUtc,
        Guid CreatedByUserId
    );

    /*
     * DTO di input usato per aggiungere una nuova anamnesi a un encounter.
     */
    public sealed record CreateAnamnesisRequest(
        string Content
    );

    /*
     * DTO che rappresenta un parametro vitale registrato durante un encounter.
     */
    public sealed record VitalSignDto(
        Guid Id,
        Guid EncounterId,
        string Type,
        decimal Value,
        string Unit,
        DateTime MeasuredAtUtc,
        Guid MeasuredByUserId
    );

    /*
     * DTO di input usato per registrare un nuovo parametro vitale.
     */
    public sealed record RecordVitalSignRequest(
        string Type,
        decimal Value,
        string Unit,
        DateTime? MeasuredAtUtc
    );

    /*
     * DTO che rappresenta un ordine clinico associato a un encounter.
     */
    public sealed record ClinicalOrderDto(
        Guid Id,
        Guid EncounterId,
        Guid CatalogItemId,
        string Status,
        string? Notes,
        DateTime CreatedAtUtc
    );

    /*
     * DTO di input usato per creare un nuovo ordine clinico.
     */
    public sealed record CreateClinicalOrderRequest(
        Guid CatalogItemId,
        string? Notes
    );

    /*
     * DTO che rappresenta l'esecuzione di una procedura collegata a un ordine clinico.
     */
    public sealed record ProcedureExecutionDto(
        Guid Id,
        Guid OrderId,
        DateTime PerformedAtUtc,
        Guid PerformedByUserId,
        string Outcome,
        string? Notes
    );

    /*
     * DTO di input usato per registrare l'esecuzione di una procedura.
     */
    public sealed record RecordProcedureExecutionRequest(
        DateTime? PerformedAtUtc,
        string Outcome,
        string? Notes
    );

    /*
     * DTO che rappresenta un referto clinico associato a un encounter.
     */
    public sealed record ClinicalReportDto(
        Guid Id,
        Guid EncounterId,
        string Status,
        string Content,
        DateTime CreatedAtUtc,
        DateTime? SignedAtUtc,
        Guid? SignedByUserId,
        DateTime? PublishedAtUtc
    );

    /*
     * DTO di input usato per creare o aggiornare il contenuto di un referto clinico.
     */
    public sealed record UpsertClinicalReportRequest(
        string Content
    );

    /*
     * DTO di input usato per richiedere la firma di un referto clinico.
     */
    public sealed record SignClinicalReportRequest(
        bool Sign
    );

    /*
     * DTO di input usato per richiedere la pubblicazione di un referto clinico.
     */
    public sealed record PublishClinicalReportRequest(
        bool Publish
    );

    /*
     * DTO che rappresenta la vista paziente di un referto clinico pubblicato.
     */
    public sealed record PatientClinicalReportDto(
        Guid Id,
        Guid EncounterId,
        Guid ClinicianUserId,
        DateTime CreatedAtUtc,
        DateTime? PublishedAtUtc,
        string Content
    );

    /*
     * DTO che rappresenta il questionario di pre-triage associato a un appuntamento.
     */
    public sealed record PreTriageQuestionnaireDto(
        Guid AppointmentId,
        string Content,
        DateTime CreatedAtUtc,
        DateTime UpdatedAtUtc
    );

    /*
     * DTO di input usato per creare o aggiornare il questionario di pre-triage.
     */
    public sealed record UpsertPreTriageQuestionnaireRequest(
        string Content
    );
}
