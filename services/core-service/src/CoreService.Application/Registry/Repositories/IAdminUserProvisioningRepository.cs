/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IAdminUserProvisioningRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per le operazioni di provisioning
 * amministrativo degli utenti del dominio Registry insieme ai rispettivi profili.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Registry
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono creare in modo coordinato utenti e profili associati
 * senza dipendere dai dettagli infrastrutturali di persistenza o transazione.
 *
 * Responsabilità principali
 * -------------------------
 * - Creare un utente Patient con il relativo profilo paziente.
 * - Creare un utente Delegate con il relativo profilo delegato.
 * - Creare un utente Clinician con il relativo profilo clinico.
 * - Esporre operazioni atomiche di provisioning composte da più entità.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Registry
 * - Implementazioni infrastrutturali dei repository
 * - Entità User, PatientProfile, DelegateProfile e ClinicianProfile del dominio
 *
 * Note
 * ----
 * L'interfaccia non contiene logica di business né dettagli tecnici
 * su database, transazioni o meccanismi di persistenza:
 * definisce esclusivamente il contratto che le implementazioni concrete
 * devono rispettare.
 */

using System.Threading;
using System.Threading.Tasks;
using CoreService.Domain.Registry;

namespace CoreService.Application.Registry.Repositories
{
    public interface IAdminUserProvisioningRepository
    {
        /*
         * Persiste in modo coordinato un nuovo utente Patient
         * insieme al relativo profilo paziente.
         */
        Task CreatePatientWithProfileAsync(
            User user,
            PatientProfile profile,
            CancellationToken cancellationToken = default);

        /*
         * Persiste in modo coordinato un nuovo utente Delegate
         * insieme al relativo profilo delegato.
         */
        Task CreateDelegateWithProfileAsync(
            User user,
            DelegateProfile profile,
            CancellationToken cancellationToken = default);

        /*
         * Persiste in modo coordinato un nuovo utente Clinician
         * insieme al relativo profilo clinico.
         */
        Task CreateClinicianWithProfileAsync(
            User user,
            ClinicianProfile profile,
            CancellationToken cancellationToken = default);
    }
}

