/*
 * File: services/core-service/src/CoreService.Application/Registry/Services/DelegationAccessService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi alla consultazione
 * e alla verifica delle deleghe tra pazienti e delegati.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Registry
 * e coordina i workflow che permettono di:
 * - recuperare le deleghe associate a un paziente;
 * - recuperare le deleghe associate a un delegato;
 * - verificare che una delega sia attiva, valida temporalmente
 *   e dotata dei permessi necessari per una specifica operazione.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare le deleghe di un paziente.
 * - Recuperare le deleghe di un delegato.
 * - Verificare l'esistenza e la validità di una delega specifica.
 * - Verificare che la delega includa i permessi richiesti.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IDelegationRepository
 * - IUserRepository
 * - Entità del dominio Registry
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
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;

namespace CoreService.Application.Registry.Services
{
    public sealed class DelegationAccessService
    {
        // Repository usato per accedere alle deleghe persistite.
        private readonly IDelegationRepository _delegationRepository;

        // Repository usato per recuperare gli utenti coinvolti nelle deleghe.
        private readonly IUserRepository _userRepository;

        /*
         * Inizializza il servizio con le dipendenze necessarie
         * alla consultazione e validazione delle deleghe.
         */
        public DelegationAccessService(
            IDelegationRepository delegationRepository,
            IUserRepository userRepository)
        {
            _delegationRepository = delegationRepository
                ?? throw new ArgumentNullException(nameof(delegationRepository));
            _userRepository = userRepository
                ?? throw new ArgumentNullException(nameof(userRepository));
        }

        /*
         * Recupera tutte le deleghe associate a un determinato paziente
         * e le converte nei corrispondenti DTO applicativi.
         */
        public async Task<OperationResult<IReadOnlyList<DelegationDto>>> GetDelegationsForPatientAsync(
            Guid patientUserId,
            CancellationToken cancellationToken = default)
        {
            // Recupera tutte le deleghe associate al paziente specificato.
            var delegations = await _delegationRepository
                .GetByPatientUserIdAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            // Converte le entità di dominio in DTO applicativi.
            var dto = delegations
                .Select(delegation => MapDelegationToDto(delegation))
                .ToArray();

            return OperationResult<IReadOnlyList<DelegationDto>>.Success(dto);
        }

        /*
         * Recupera tutte le deleghe associate a un determinato delegato
         * e arricchisce i DTO con un identificativo visualizzabile del paziente.
         */
        public async Task<OperationResult<IReadOnlyList<DelegationDto>>> GetDelegationsForDelegateAsync(
            Guid delegateUserId,
            CancellationToken cancellationToken = default)
        {
            // Recupera tutte le deleghe associate al delegato specificato.
            var delegations = await _delegationRepository
                .GetByDelegateUserIdAsync(delegateUserId, cancellationToken)
                .ConfigureAwait(false);

            var dto = new List<DelegationDto>(delegations.Count);

            // Per ciascuna delega recupera anche l'utente paziente
            // così da valorizzare un riferimento visualizzabile.
            foreach (var delegation in delegations)
            {
                var patientUser = await _userRepository
                    .GetByIdAsync(delegation.PatientUserId, cancellationToken)
                    .ConfigureAwait(false);

                var patientDisplayName = string.IsNullOrWhiteSpace(patientUser?.Email)
                    ? null
                    : patientUser!.Email.Trim();

                dto.Add(MapDelegationToDto(delegation, patientDisplayName));
            }

            return OperationResult<IReadOnlyList<DelegationDto>>.Success(dto);
        }

        /*
         * Verifica che esista una delega attiva e valida tra paziente e delegato
         * e che tale delega conceda almeno i permessi richiesti.
         */
        public async Task<OperationResult<DelegationDto>> EnsureActiveDelegationAsync(
            Guid patientUserId,
            Guid delegateUserId,
            DelegationScope requiredScope,
            CancellationToken cancellationToken = default)
        {
            // Recupera la delega specifica per la coppia paziente/delegato.
            var delegation = await _delegationRepository
                .GetByPatientAndDelegateAsync(patientUserId, delegateUserId, cancellationToken)
                .ConfigureAwait(false);

            // Se la delega non esiste, il delegato non è autorizzato a operare.
            if (delegation is null)
            {
                return OperationResult<DelegationDto>.Forbidden(
                    "delegation_not_found",
                    "Il delegato non risulta autorizzato ad operare per il paziente specificato.");
            }

            // La delega deve essere attiva.
            if (delegation.Status != DelegationStatus.Active)
            {
                return OperationResult<DelegationDto>.Forbidden(
                    "delegation_not_active",
                    "La delega non è attiva.");
            }

            var nowUtc = DateTime.UtcNow;

            // La delega deve essere valida nell'intervallo temporale corrente.
            if (nowUtc < delegation.StartsAtUtc || nowUtc > delegation.EndsAtUtc)
            {
                return OperationResult<DelegationDto>.Forbidden(
                    "delegation_out_of_validity",
                    "La delega non è valida in questo momento.");
            }

            // La delega deve includere almeno lo scope necessario
            // per l'operazione richiesta.
            if (!HasRequiredScope(delegation.Scope, requiredScope))
            {
                return OperationResult<DelegationDto>.Forbidden(
                    "delegation_scope_insufficient",
                    "La delega non concede i permessi necessari per questa operazione.");
            }

            // Recupera l'utente paziente per valorizzare un riferimento visualizzabile.
            var patientUser = await _userRepository
                .GetByIdAsync(delegation.PatientUserId, cancellationToken)
                .ConfigureAwait(false);

            var patientDisplayName = string.IsNullOrWhiteSpace(patientUser?.Email)
                ? null
                : patientUser!.Email.Trim();

            var dto = MapDelegationToDto(delegation, patientDisplayName);
            return OperationResult<DelegationDto>.Success(dto);
        }

        /*
         * Converte un'entità Delegation del dominio nel corrispondente DTO applicativo,
         * valorizzando opzionalmente il nome visualizzabile del paziente.
         */
        private static DelegationDto MapDelegationToDto(
            Delegation delegation,
            string? patientDisplayName = null)
        {
            return new DelegationDto(
                delegation.Id,
                delegation.PatientUserId,
                delegation.DelegateUserId,
                delegation.Scope.ToString(),
                delegation.Status.ToString(),
                delegation.StartsAtUtc,
                delegation.EndsAtUtc,
                delegation.CreatedAtUtc)
            {
                PatientDisplayName = string.IsNullOrWhiteSpace(patientDisplayName)
                    ? null
                    : patientDisplayName.Trim()
            };
        }

        /*
         * Verifica se lo scope effettivamente assegnato alla delega
         * soddisfa il livello di permesso richiesto dall'operazione.
         */
        private static bool HasRequiredScope(
            DelegationScope actualScope,
            DelegationScope requiredScope)
        {
            // Le operazioni di sola lettura sono consentite
            // anche dagli scope più permissivi.
            if (requiredScope == DelegationScope.ReadOnly)
            {
                return actualScope == DelegationScope.ReadOnly
                    || actualScope == DelegationScope.ManageAppointments
                    || actualScope == DelegationScope.ManagePayments;
            }

            // Le operazioni sugli appuntamenti richiedono lo scope specifico dedicato.
            if (requiredScope == DelegationScope.ManageAppointments)
            {
                return actualScope == DelegationScope.ManageAppointments;
            }

            // Le operazioni sui pagamenti richiedono lo scope specifico dedicato.
            if (requiredScope == DelegationScope.ManagePayments)
            {
                return actualScope == DelegationScope.ManagePayments;
            }

            return false;
        }
    }
}
