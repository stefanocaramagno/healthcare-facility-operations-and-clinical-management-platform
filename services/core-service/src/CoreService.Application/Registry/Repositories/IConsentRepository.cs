/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IConsentRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * dei consensi del dominio Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Registry
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono recuperare, creare e aggiornare i consensi associati ai pazienti
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare tutti i consensi associati a un paziente.
 * - Recuperare un consenso specifico a partire da paziente e tipologia.
 * - Persistire un nuovo consenso.
 * - Aggiornare un consenso esistente.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Registry
 * - Implementazioni infrastrutturali dei repository
 * - Entità Consent del dominio
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
using CoreService.Domain.Registry;

namespace CoreService.Application.Registry.Repositories
{
    public interface IConsentRepository
    {
        /*
         * Recupera tutti i consensi associati a un determinato paziente.
         */
        Task<IReadOnlyList<Consent>> GetByPatientUserIdAsync(
            Guid patientUserId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera un consenso specifico a partire dal paziente
         * e dalla relativa tipologia.
         */
        Task<Consent?> GetByPatientAndTypeAsync(
            Guid patientUserId,
            ConsentType type,
            CancellationToken cancellationToken = default);

        /*
         * Persiste un nuovo consenso nel sistema.
         */
        Task AddAsync(
            Consent consent,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di un consenso esistente.
         */
        Task UpdateAsync(
            Consent consent,
            CancellationToken cancellationToken = default);
    }
}

