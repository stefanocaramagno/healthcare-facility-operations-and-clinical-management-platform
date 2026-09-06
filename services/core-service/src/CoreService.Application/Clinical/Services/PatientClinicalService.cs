/*
 * File: services/core-service/src/CoreService.Application/Clinical/Services/PatientClinicalService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi alla consultazione
 * dei referti clinici pubblicati accessibili al paziente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Clinical
 * e coordina il workflow che consente al paziente autenticato
 * di recuperare i propri referti clinici pubblicati
 * in un determinato intervallo temporale.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare i referti clinici pubblicati relativi a un paziente.
 * - Normalizzare l'intervallo temporale di ricerca.
 * - Mappare i dati provenienti dal repository clinico nei DTO applicativi.
 *
 * Interazioni principali
 * ----------------------
 * - IClinicalPathwayRepository
 * - DTO del layer Application
 * - Dati aggregati del dominio Clinical
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati al repository dedicato.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Clinical.Repositories;

namespace CoreService.Application.Clinical.Services
{
    public sealed class PatientClinicalService
    {
        // Repository applicativo necessario al recupero dei referti clinici
        // pubblicati e delle relative informazioni di contesto.
        private readonly IClinicalPathwayRepository _clinicalRepository;

        /*
         * Inizializza il servizio con la dipendenza necessaria
         * ai workflow di consultazione dei referti lato paziente.
         */
        public PatientClinicalService(IClinicalPathwayRepository clinicalRepository)
        {
            _clinicalRepository = clinicalRepository
                ?? throw new ArgumentNullException(nameof(clinicalRepository));
        }

        /*
         * Recupera i referti clinici pubblicati per il paziente specificato
         * nell'intervallo temporale richiesto, applicando prima una normalizzazione del range.
         */
        public async Task<IReadOnlyList<PatientClinicalReportDto>> GetPublishedReportsForPatientAsync(
            Guid patientUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken)
        {
            // Determina l'intervallo temporale effettivo da utilizzare per la ricerca.
            var (effectiveFromUtc, effectiveToUtc) = NormalizeDateRange(fromUtc, toUtc);

            // Recupera dal repository i referti pubblicati insieme ai rispettivi encounter associati.
            var reportsWithEncounters = await _clinicalRepository
                .GetPublishedReportsForPatientAsync(
                    patientUserId,
                    effectiveFromUtc,
                    effectiveToUtc,
                    cancellationToken)
                .ConfigureAwait(false);

            // Mappa il risultato aggregato nel DTO esposto ai layer superiori.
            var result = reportsWithEncounters
                .Select(x => new PatientClinicalReportDto(
                    x.Report.Id,
                    x.Report.EncounterId,
                    x.Encounter.ClinicianUserId,
                    x.Report.CreatedAtUtc,
                    x.Report.PublishedAtUtc,
                    x.Report.Content))
                .ToList()
                .AsReadOnly();

            return result;
        }

        /*
         * Normalizza l'intervallo temporale di ricerca applicando valori di default
         * e correggendo automaticamente l'ordine degli estremi se invertiti.
         */
        private static (DateTime FromUtc, DateTime ToUtc) NormalizeDateRange(
            DateTime? fromUtc,
            DateTime? toUtc)
        {
            var nowUtc = DateTime.UtcNow;

            // In assenza di valori espliciti, considera come finestra standard
            // gli ultimi sei mesi fino al momento corrente.
            var effectiveFromUtc = fromUtc ?? nowUtc.AddMonths(-6);
            var effectiveToUtc = toUtc ?? nowUtc;

            // Se gli estremi risultano invertiti, li scambia per ottenere un intervallo valido.
            if (effectiveFromUtc > effectiveToUtc)
            {
                (effectiveFromUtc, effectiveToUtc) = (effectiveToUtc, effectiveFromUtc);
            }

            return (effectiveFromUtc, effectiveToUtc);
        }
    }
}
