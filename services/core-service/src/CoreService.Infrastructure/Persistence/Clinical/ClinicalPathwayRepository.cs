/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Clinical/ClinicalPathwayRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * delle entità coinvolte nel percorso clinico del bounded context Clinical.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IClinicalPathwayRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Clinical.
 *
 * Responsabilità principali
 * -------------------------
 * - Gestire la persistenza degli encounter clinici.
 * - Gestire la persistenza di anamnesi, parametri vitali, ordini ed esecuzioni.
 * - Gestire la persistenza e il recupero dei referti clinici.
 * - Recuperare i report pubblicati di un paziente insieme ai relativi encounter.
 *
 * Interazioni principali
 * ----------------------
 * - ClinicalDbContext
 * - IClinicalPathwayRepository
 * - Entità ClinicalEncounter del dominio Clinical
 * - Entità AnamnesisRecord del dominio Clinical
 * - Entità VitalSign del dominio Clinical
 * - Entità ClinicalOrder del dominio Clinical
 * - Entità ProcedureExecution del dominio Clinical
 * - Entità ClinicalReport del dominio Clinical
 *
 * Note
 * ----
 * Le operazioni di lettura utilizzano AsNoTracking() quando il chiamante
 * richiede semplice consultazione e non è necessario il tracking EF Core.
 * Le operazioni di scrittura persistono immediatamente le modifiche sul database.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Clinical.Repositories;
using CoreService.Domain.Clinical;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Clinical
{
    public sealed class ClinicalPathwayRepository : IClinicalPathwayRepository
    {
        // DbContext del bounded context Clinical usato
        // per eseguire query e operazioni di persistenza sul percorso clinico.
        private readonly ClinicalDbContext _context;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Clinical.
         */
        public ClinicalPathwayRepository(ClinicalDbContext context)
        {
            _context = context
                ?? throw new ArgumentNullException(nameof(context));
        }

        /*
         * Recupera un encounter clinico tramite il suo identificativo univoco.
         */
        public async Task<ClinicalEncounter?> GetEncounterByIdAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _context.Encounters
                .AsNoTracking()
                .SingleOrDefaultAsync(e => e.Id == encounterId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera l'encounter clinico associato a un determinato appuntamento.
         */
        public async Task<ClinicalEncounter?> GetEncounterForAppointmentAsync(
            Guid appointmentId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _context.Encounters
                .AsNoTracking()
                .SingleOrDefaultAsync(e => e.AppointmentId == appointmentId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo encounter clinico nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddEncounterAsync(
            ClinicalEncounter encounter,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (encounter is null)
            {
                throw new ArgumentNullException(nameof(encounter));
            }

            // Inserisce la nuova entità nel DbContext.
            await _context.Encounters
                .AddAsync(encounter, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _context.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna un encounter clinico esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateEncounterAsync(
            ClinicalEncounter encounter,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (encounter is null)
            {
                throw new ArgumentNullException(nameof(encounter));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _context.Encounters.Update(encounter);

            // Salva immediatamente le modifiche sul database.
            await _context.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera gli encounter clinici di un determinato clinico
         * all'interno di un intervallo temporale.
         */
        public async Task<IReadOnlyList<ClinicalEncounter>> GetEncountersForClinicianAsync(
            Guid clinicianUserId,
            DateTime fromUtc,
            DateTime toUtc,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            return await _context.Encounters
                .AsNoTracking()
                .Where(e => e.ClinicianUserId == clinicianUserId &&
                            e.StartedAtUtc >= fromUtc &&
                            e.StartedAtUtc <= toUtc)
                .OrderByDescending(e => e.StartedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo record anamnestico nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAnamnesisAsync(
            AnamnesisRecord anamnesis,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (anamnesis is null)
            {
                throw new ArgumentNullException(nameof(anamnesis));
            }

            // Inserisce la nuova entità nel DbContext.
            await _context.Anamneses
                .AddAsync(anamnesis, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _context.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera tutti i record anamnestici associati a un encounter,
         * ordinati cronologicamente.
         */
        public async Task<IReadOnlyList<AnamnesisRecord>> GetAnamnesesForEncounterAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            return await _context.Anamneses
                .AsNoTracking()
                .Where(a => a.EncounterId == encounterId)
                .OrderBy(a => a.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo parametro vitale nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddVitalSignAsync(
            VitalSign vitalSign,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (vitalSign is null)
            {
                throw new ArgumentNullException(nameof(vitalSign));
            }

            // Inserisce la nuova entità nel DbContext.
            await _context.VitalSigns
                .AddAsync(vitalSign, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _context.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera tutti i parametri vitali associati a un encounter,
         * ordinati cronologicamente per momento di misurazione.
         */
        public async Task<IReadOnlyList<VitalSign>> GetVitalSignsForEncounterAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            return await _context.VitalSigns
                .AsNoTracking()
                .Where(v => v.EncounterId == encounterId)
                .OrderBy(v => v.MeasuredAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo ordine clinico nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddOrderAsync(
            ClinicalOrder order,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (order is null)
            {
                throw new ArgumentNullException(nameof(order));
            }

            // Inserisce la nuova entità nel DbContext.
            await _context.Orders
                .AddAsync(order, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _context.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna un ordine clinico esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateOrderAsync(
            ClinicalOrder order,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (order is null)
            {
                throw new ArgumentNullException(nameof(order));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _context.Orders.Update(order);

            // Salva immediatamente le modifiche sul database.
            await _context.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera un ordine clinico tramite il suo identificativo univoco.
         */
        public async Task<ClinicalOrder?> GetOrderByIdAsync(
            Guid orderId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _context.Orders
                .AsNoTracking()
                .SingleOrDefaultAsync(o => o.Id == orderId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera tutti gli ordini clinici associati a un encounter,
         * ordinati cronologicamente.
         */
        public async Task<IReadOnlyList<ClinicalOrder>> GetOrdersForEncounterAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            return await _context.Orders
                .AsNoTracking()
                .Where(o => o.EncounterId == encounterId)
                .OrderBy(o => o.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste una nuova esecuzione procedurale nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddExecutionAsync(
            ProcedureExecution execution,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (execution is null)
            {
                throw new ArgumentNullException(nameof(execution));
            }

            // Inserisce la nuova entità nel DbContext.
            await _context.Executions
                .AddAsync(execution, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _context.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera tutte le esecuzioni associate a un ordine clinico,
         * ordinate cronologicamente.
         */
        public async Task<IReadOnlyList<ProcedureExecution>> GetExecutionsForOrderAsync(
            Guid orderId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice consultazione della collezione.
            return await _context.Executions
                .AsNoTracking()
                .Where(e => e.OrderId == orderId)
                .OrderBy(e => e.PerformedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera il referto clinico associato a un determinato encounter.
         */
        public async Task<ClinicalReport?> GetReportByEncounterIdAsync(
            Guid encounterId,
            CancellationToken cancellationToken = default)
        {
            // Restituisce l'eventuale referto associato all'encounter richiesto.
            return await _context.Reports
                .SingleOrDefaultAsync(r => r.EncounterId == encounterId, cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Inserisce un nuovo referto clinico oppure aggiorna uno esistente,
         * in base alla presenza dell'identificativo nel database.
         */
        public async Task AddOrUpdateReportAsync(
            ClinicalReport report,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento o aggiornamento di un riferimento nullo.
            if (report is null)
            {
                throw new ArgumentNullException(nameof(report));
            }

            // Verifica se il referto esiste già nel database
            // per scegliere correttamente tra update e insert.
            var exists = await _context.Reports
                .AsNoTracking()
                .AnyAsync(r => r.Id == report.Id, cancellationToken)
                .ConfigureAwait(false);

            if (exists)
            {
                // Marca il referto come aggiornato nel DbContext.
                _context.Reports.Update(report);
            }
            else
            {
                // Inserisce il nuovo referto nel DbContext.
                await _context.Reports
                    .AddAsync(report, cancellationToken)
                    .ConfigureAwait(false);
            }

            // Salva immediatamente le modifiche sul database.
            await _context.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Recupera i referti pubblicati di un paziente
         * insieme ai relativi encounter,
         * con possibilità di filtrare l'intervallo temporale.
         */
        public async Task<IReadOnlyList<(ClinicalReport Report, ClinicalEncounter Encounter)>> GetPublishedReportsForPatientAsync(
            Guid patientUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken = default)
        {
            // Costruisce la query base unendo referti ed encounter
            // e limitando il risultato ai report pubblicati del paziente richiesto.
            var query =
                from report in _context.Reports.AsNoTracking()
                join encounter in _context.Encounters.AsNoTracking()
                    on report.EncounterId equals encounter.Id
                where encounter.PatientUserId == patientUserId
                      && report.Status == ClinicalReportStatus.Published
                select new { report, encounter };

            // Se presente un limite inferiore, applica il filtro sulla data di pubblicazione
            // quando disponibile, altrimenti usa la data di creazione come fallback.
            if (fromUtc.HasValue)
            {
                query = query.Where(x =>
                    x.report.PublishedAtUtc.HasValue
                        ? x.report.PublishedAtUtc.Value >= fromUtc.Value
                        : x.report.CreatedAtUtc >= fromUtc.Value);
            }

            // Se presente un limite superiore, applica il filtro sulla data di pubblicazione
            // quando disponibile, altrimenti usa la data di creazione come fallback.
            if (toUtc.HasValue)
            {
                query = query.Where(x =>
                    x.report.PublishedAtUtc.HasValue
                        ? x.report.PublishedAtUtc.Value <= toUtc.Value
                        : x.report.CreatedAtUtc <= toUtc.Value);
            }

            // Ordina i risultati dal più recente al meno recente
            // usando la data di pubblicazione quando valorizzata.
            var items = await query
                .OrderByDescending(x => x.report.PublishedAtUtc ?? x.report.CreatedAtUtc)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            // Proietta il risultato nella forma tuple attesa dal contratto repository.
            return items
                .Select(x => (x.report, x.encounter))
                .ToList();
        }
    }
}
