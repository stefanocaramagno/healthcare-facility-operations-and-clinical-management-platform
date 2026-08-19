/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IAdminDirectoryRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per le ricerche amministrative
 * nelle directory del dominio Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Registry
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono eseguire ricerche amministrative su pazienti, delegati e clinici
 * senza dipendere dai dettagli infrastrutturali di persistenza o interrogazione.
 *
 * Responsabilità principali
 * -------------------------
 * - Ricercare pazienti nella directory amministrativa.
 * - Ricercare delegati nella directory amministrativa.
 * - Ricercare clinici nella directory amministrativa.
 * - Supportare filtri testuali, filtro di stato attivo e paginazione.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Registry
 * - Implementazioni infrastrutturali dei repository
 * - DTO del layer Application
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * sul database o sul meccanismo di query:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;

namespace CoreService.Application.Registry.Repositories
{
    public interface IAdminDirectoryRepository
    {
        /*
         * Esegue una ricerca amministrativa nella directory dei pazienti,
         * supportando filtro testuale, filtro di stato attivo e paginazione.
         */
        Task<IReadOnlyList<PatientDirectoryItemDto>> SearchPatientsAsync(
            string? query,
            bool? onlyActive,
            int skip,
            int take,
            CancellationToken cancellationToken = default);

        /*
         * Esegue una ricerca amministrativa nella directory dei delegati,
         * supportando filtro testuale, filtro di stato attivo e paginazione.
         */
        Task<IReadOnlyList<DelegateDirectoryItemDto>> SearchDelegatesAsync(
            string? query,
            bool? onlyActive,
            int skip,
            int take,
            CancellationToken cancellationToken = default);

        /*
         * Esegue una ricerca amministrativa nella directory dei clinici,
         * supportando filtro testuale, filtro di stato attivo e paginazione.
         */
        Task<IReadOnlyList<ClinicianDirectoryItemDto>> SearchCliniciansAsync(
            string? query,
            bool? onlyActive,
            int skip,
            int take,
            CancellationToken cancellationToken = default);
    }
}

