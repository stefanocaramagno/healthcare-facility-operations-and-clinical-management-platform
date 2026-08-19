/*
 * File: services/core-service/src/CoreService.Application/Registry/Repositories/IDelegationRepository.cs
 *
 * Scopo
 * -----
 * Definire il contratto applicativo per l'accesso e la persistenza
 * delle deleghe del dominio Registry.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa interfaccia appartiene al layer Application del dominio Registry
 * e rappresenta l'astrazione tramite cui i servizi applicativi
 * possono recuperare, creare e aggiornare le deleghe tra pazienti e delegati
 * senza dipendere dai dettagli infrastrutturali di persistenza.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare una delega a partire dal suo identificativo.
 * - Recuperare una delega a partire dalla coppia paziente/delegato.
 * - Recuperare tutte le deleghe associate a un paziente.
 * - Recuperare tutte le deleghe associate a un delegato.
 * - Persistire una nuova delega.
 * - Aggiornare una delega esistente.
 *
 * Interazioni principali
 * ----------------------
 * - Servizi applicativi del dominio Registry
 * - Implementazioni infrastrutturali dei repository
 * - Entità Delegation del dominio
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
    public interface IDelegationRepository
    {
        /*
         * Recupera una delega a partire dal suo identificativo univoco.
         */
        Task<Delegation?> GetByIdAsync(
            Guid id,
            CancellationToken cancellationToken = default);

        /*
         * Recupera una delega a partire dalla specifica coppia
         * paziente/delegato a cui è associata.
         */
        Task<Delegation?> GetByPatientAndDelegateAsync(
            Guid patientUserId,
            Guid delegateUserId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutte le deleghe associate a un determinato paziente.
         */
        Task<IReadOnlyList<Delegation>> GetByPatientUserIdAsync(
            Guid patientUserId,
            CancellationToken cancellationToken = default);

        /*
         * Recupera tutte le deleghe associate a un determinato delegato.
         */
        Task<IReadOnlyList<Delegation>> GetByDelegateUserIdAsync(
            Guid delegateUserId,
            CancellationToken cancellationToken = default);

        /*
         * Persiste una nuova delega nel sistema.
         */
        Task AddAsync(
            Delegation delegation,
            CancellationToken cancellationToken = default);

        /*
         * Aggiorna lo stato persistito di una delega esistente.
         */
        Task UpdateAsync(
            Delegation delegation,
            CancellationToken cancellationToken = default);
    }
}

