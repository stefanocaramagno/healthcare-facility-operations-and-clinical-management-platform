/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Clinical/PreTriageQuestionnaireRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale per la gestione persistente
 * dell'entità PreTriageQuestionnaire del bounded context Clinical.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IPreTriageQuestionnaireRepository del layer Application.
 * Il suo compito è tradurre le operazioni richieste dai servizi applicativi
 * in query e comandi Entity Framework Core verso il database Clinical.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare un questionario di pre-triage tramite AppointmentId.
 * - Persistire un nuovo questionario di pre-triage.
 * - Aggiornare un questionario di pre-triage esistente.
 *
 * Interazioni principali
 * ----------------------
 * - ClinicalDbContext
 * - IPreTriageQuestionnaireRepository
 * - Entità PreTriageQuestionnaire del dominio Clinical
 *
 * Note
 * ----
 * Le operazioni di lettura utilizzano AsNoTracking() per evitare
 * il tracking non necessario da parte di Entity Framework Core
 * nei casi di semplice consultazione.
 * Le operazioni di scrittura persistono immediatamente le modifiche sul database.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Clinical.Repositories;
using CoreService.Domain.Clinical;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Clinical
{
    public sealed class PreTriageQuestionnaireRepository : IPreTriageQuestionnaireRepository
    {
        // DbContext del bounded context Clinical usato
        // per eseguire query e operazioni di persistenza sui questionari di pre-triage.
        private readonly ClinicalDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Clinical.
         */
        public PreTriageQuestionnaireRepository(ClinicalDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Recupera un questionario di pre-triage tramite l'identificativo dell'appuntamento associato.
         */
        public async Task<PreTriageQuestionnaire?> GetByAppointmentIdAsync(
            Guid appointmentId,
            CancellationToken cancellationToken = default)
        {
            // La query viene eseguita in modalità no-tracking
            // poiché il chiamante richiede una semplice lettura dell'entità.
            return await _dbContext.PreTriageQuestionnaires
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    x => x.AppointmentId == appointmentId,
                    cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Persiste un nuovo questionario di pre-triage nel database
         * e conferma immediatamente la modifica.
         */
        public async Task AddAsync(
            PreTriageQuestionnaire questionnaire,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'inserimento di un riferimento nullo nel DbContext.
            if (questionnaire == null)
            {
                throw new ArgumentNullException(nameof(questionnaire));
            }

            // Inserisce la nuova entità nel DbContext.
            await _dbContext.PreTriageQuestionnaires
                .AddAsync(questionnaire, cancellationToken)
                .ConfigureAwait(false);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        /*
         * Aggiorna un questionario di pre-triage esistente nel database
         * e conferma immediatamente la modifica.
         */
        public async Task UpdateAsync(
            PreTriageQuestionnaire questionnaire,
            CancellationToken cancellationToken = default)
        {
            // Impedisce l'aggiornamento di un riferimento nullo.
            if (questionnaire == null)
            {
                throw new ArgumentNullException(nameof(questionnaire));
            }

            // Marca l'entità come aggiornata nel DbContext.
            _dbContext.PreTriageQuestionnaires.Update(questionnaire);

            // Salva immediatamente le modifiche sul database.
            await _dbContext.SaveChangesAsync(cancellationToken)
                .ConfigureAwait(false);
        }
    }
}
