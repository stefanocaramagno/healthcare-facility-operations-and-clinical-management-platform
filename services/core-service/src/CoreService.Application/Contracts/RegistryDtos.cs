/*
 * File: services/core-service/src/CoreService.Application/Contracts/RegistryDtos.cs
 *
 * Scopo
 * -----
 * Definire i DTO e i contratti dati utilizzati dal dominio applicativo Registry
 * per la gestione di profili, directory amministrative, deleghe e consensi.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file raccoglie le strutture dati scambiate tra controller,
 * service layer e client per tutte le operazioni del dominio Registry.
 * I contratti descrivono sia payload di input sia payload di output
 * relativi a pazienti, delegati, clinici, deleghe e consensi informati.
 *
 * Responsabilità principali
 * -------------------------
 * - Definire i DTO dei profili utente del dominio Registry.
 * - Definire i DTO delle viste directory amministrative.
 * - Definire i payload per create/update/upsert di profili e deleghe.
 * - Definire i DTO dei consensi e delle relative richieste di aggiornamento.
 *
 * Interazioni principali
 * ----------------------
 * - Controller del dominio Registry
 * - Service layer del dominio Registry
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
     * DTO che rappresenta il profilo anagrafico completo di un paziente.
     */
    public sealed record PatientProfileDto(
        Guid Id,
        Guid UserId,
        string FirstName,
        string LastName,
        DateTime DateOfBirthUtc,
        string? Phone,
        string? Address
    );

    /*
     * DTO usato nelle viste directory amministrative per elencare i pazienti.
     */
    public sealed record PatientDirectoryItemDto(
        Guid UserId,
        string Email,
        bool IsActive,
        string FirstName,
        string LastName,
        DateTime DateOfBirthUtc,
        string? Phone,
        DateTime CreatedAtUtc,
        DateTime UpdatedAtUtc
    );

    /*
     * DTO di input usato dall'amministratore per creare un nuovo paziente.
     */
    public sealed record CreateAdminPatientRequest(
        string Email,
        string Password,
        string FirstName,
        string LastName,
        DateTime DateOfBirthUtc,
        string? Phone,
        string? Address
    );

    /*
     * DTO di output restituito dopo la creazione amministrativa di un paziente.
     */
    public sealed record CreatedAdminPatientDto(
        Guid UserId,
        string Email,
        bool IsActive,
        string Role,
        bool ActivationEmailSent,
        PatientProfileDto Profile
    );

    /*
     * DTO che rappresenta il profilo anagrafico completo di un delegato.
     */
    public sealed record DelegateProfileDto(
        Guid Id,
        Guid UserId,
        string FirstName,
        string LastName,
        string? Phone,
        string? Address
    );

    /*
     * DTO usato nelle viste directory amministrative per elencare i delegati.
     */
    public sealed record DelegateDirectoryItemDto(
        Guid UserId,
        string Email,
        bool IsActive,
        string FirstName,
        string LastName,
        string? Phone,
        string? Address,
        DateTime CreatedAtUtc,
        DateTime UpdatedAtUtc
    );

    /*
     * DTO di input usato dall'amministratore per creare un nuovo delegato.
     */
    public sealed record CreateAdminDelegateRequest(
        string Email,
        string Password,
        string FirstName,
        string LastName,
        string? Phone,
        string? Address
    );

    /*
     * DTO di output restituito dopo la creazione amministrativa di un delegato.
     */
    public sealed record CreatedAdminDelegateDto(
        Guid UserId,
        string Email,
        bool IsActive,
        string Role,
        bool ActivationEmailSent,
        DelegateProfileDto Profile
    );

    /*
     * DTO di input usato per creare o aggiornare il profilo di un delegato.
     */
    public sealed record UpsertDelegateProfileRequest(
        string FirstName,
        string LastName,
        string? Phone,
        string? Address
    );

    /*
     * DTO usato nelle viste directory amministrative per elencare i clinici.
     */
    public sealed record ClinicianDirectoryItemDto(
        Guid UserId,
        string Email,
        bool IsActive,
        string FirstName,
        string LastName,
        string? Phone,
        string Specialty,
        string LicenseNumber,
        string? OfficeLocation,
        DateTime CreatedAtUtc,
        DateTime UpdatedAtUtc
    );

    /*
     * DTO di input usato dall'amministratore per creare un nuovo clinico.
     */
    public sealed record CreateAdminClinicianRequest(
        string Email,
        string Password,
        string FirstName,
        string LastName,
        string? Phone,
        string Specialty,
        string LicenseNumber,
        string OfficeLocation
    );

    /*
     * DTO di output restituito dopo la creazione amministrativa di un clinico.
     */
    public sealed record CreatedAdminClinicianDto(
        Guid UserId,
        string Email,
        bool IsActive,
        string Role,
        ClinicianProfileDto Profile
    );

    /*
     * DTO di input usato per creare o aggiornare il profilo di un paziente.
     */
    public sealed record UpsertPatientProfileRequest(
        string FirstName,
        string LastName,
        DateTime DateOfBirthUtc,
        string? Phone,
        string? Address
    );

    /*
     * DTO che rappresenta il profilo professionale completo di un clinico.
     */
    public sealed record ClinicianProfileDto(
        Guid Id,
        Guid UserId,
        string FirstName,
        string LastName,
        string? Phone,
        string Specialty,
        string LicenseNumber,
        string OfficeLocation
    );

    /*
     * DTO di input usato per creare o aggiornare il profilo di un clinico.
     */
    public sealed record UpsertClinicianProfileRequest(
        string FirstName,
        string LastName,
        string? Phone,
        string Specialty,
        string LicenseNumber,
        string OfficeLocation
    );

    /*
     * DTO che rappresenta una delega tra paziente e delegato,
     * inclusi ambito, stato e finestra temporale di validità.
     */
    public sealed record DelegationDto(
        Guid Id,
        Guid PatientUserId,
        Guid DelegateUserId,
        string Scope,
        string Status,
        DateTime StartsAtUtc,
        DateTime EndsAtUtc,
        DateTime CreatedAtUtc
    )
    {
        // Nome visualizzabile del paziente, utile nelle viste applicative
        // in cui il delegato deve distinguere rapidamente gli assistiti.
        public string? PatientDisplayName { get; init; }
    };

    /*
     * DTO di input usato per creare una nuova delega.
     */
    public sealed record CreateDelegationRequest(
        Guid DelegateUserId,
        string Scope,
        DateTime StartsAtUtc,
        DateTime EndsAtUtc
    );

    /*
     * DTO di input usato per aggiornare lo stato di una delega.
     */
    public sealed record UpdateDelegationStatusRequest(
        string Status
    );

    /*
     * DTO di input usato per aggiornare l'ambito autorizzativo di una delega.
     */
    public sealed record UpdateDelegationPermissionsRequest(
        string Scope
    );

    /*
     * DTO che rappresenta un consenso associato a un paziente.
     */
    public sealed record ConsentDto(
        Guid Id,
        Guid PatientUserId,
        string Type,
        bool Granted,
        DateTime GrantedAtUtc,
        DateTime? RevokedAtUtc,
        string? Notes,
        DateTime CreatedAtUtc
    );

    /*
     * DTO di input usato per creare o aggiornare un singolo consenso.
     */
    public sealed record UpsertConsentRequest(
        string Type,
        bool Granted,
        string? Notes
    );

    /*
     * DTO di input usato per creare o aggiornare in blocco
     * l'insieme dei consensi di un paziente.
     */
    public sealed record UpsertPatientConsentsRequest(
        IReadOnlyList<UpsertConsentRequest> Consents
    );
}
