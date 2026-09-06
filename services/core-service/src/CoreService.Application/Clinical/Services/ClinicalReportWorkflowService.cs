/*
 * File: services/core-service/src/CoreService.Application/Clinical/Services/ClinicalReportWorkflowService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi relativi al workflow del referto clinico,
 * comprendendo creazione/aggiornamento della bozza, firma e pubblicazione.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Clinical
 * e coordina il ciclo di vita del referto associato a un encounter,
 * garantendo che solo il clinico autorizzato possa:
 * - creare o aggiornare una bozza;
 * - firmare digitalmente in modo simulato il referto;
 * - pubblicare il referto già firmato.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare input e autorizzazioni del clinico corrente.
 * - Verificare lo stato dell'encounter e del referto.
 * - Gestire le transizioni di stato Draft -> Signed -> Published.
 * - Calcolare l'hash del contenuto del referto in fase di firma.
 * - Serializzare il payload della firma simulata.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IClinicalPathwayRepository
 * - Entità del dominio Clinical
 * - DTO del layer Application
 *
 * Note
 * ----
 * La firma implementata in questo servizio è simulata
 * e si basa sul calcolo di un hash SHA-256 del contenuto.
 * I dettagli della firma vengono salvati nel referto
 * come metadati serializzati in JSON.
 */

using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Clinical.Repositories;
using CoreService.Application.Common;
using CoreService.Application.Contracts;
using CoreService.Domain.Clinical;

namespace CoreService.Application.Clinical.Services
{
    public sealed class ClinicalReportWorkflowService
    {
        // Valore costante utilizzato per identificare il tipo di firma simulata
        // applicata al referto clinico.
        private const string SignatureTypeValue = "HASH_SHA256_SIMULATED";

        // Repository applicativo necessario al recupero e alla persistenza
        // del percorso clinico e dei referti associati.
        private readonly IClinicalPathwayRepository _clinicalRepository;

        /*
         * Inizializza il servizio con la dipendenza necessaria
         * ai workflow di gestione del referto clinico.
         */
        public ClinicalReportWorkflowService(IClinicalPathwayRepository clinicalRepository)
        {
            _clinicalRepository = clinicalRepository
                ?? throw new ArgumentNullException(nameof(clinicalRepository));
        }

        /*
         * Crea una nuova bozza di referto oppure aggiorna una bozza esistente,
         * purché il clinico corrente sia autorizzato e il referto non sia già stato firmato o pubblicato.
         */
        public async Task<OperationResult<ClinicalReportDto>> UpsertReportAsync(
            Guid clinicianUserId,
            Guid encounterId,
            UpsertClinicalReportRequest? request,
            CancellationToken cancellationToken)
        {
            // Il contenuto del referto è obbligatorio per poter creare o aggiornare la bozza.
            if (request is null || string.IsNullOrWhiteSpace(request.Content))
            {
                return OperationResult<ClinicalReportDto>.BadRequest(
                    "invalid_report_content",
                    "Il contenuto del referto non può essere vuoto.");
            }

            // Recupera l'encounter di riferimento.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<ClinicalReportDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

            // Solo il clinico assegnato all'encounter può operare sul referto.
            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<ClinicalReportDto>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato a modificare questo encounter.");
            }

            var normalizedContent = request.Content.Trim();

            // Recupera l'eventuale referto già associato all'encounter.
            var report = await _clinicalRepository
                .GetReportByEncounterIdAsync(encounter.Id, cancellationToken)
                .ConfigureAwait(false);

            var nowUtc = DateTime.UtcNow;

            if (report is null)
            {
                // Se il referto non esiste ancora, crea una nuova bozza iniziale.
                report = new ClinicalReport
                {
                    Id = Guid.NewGuid(),
                    EncounterId = encounter.Id,
                    Status = ClinicalReportStatus.Draft,
                    Content = normalizedContent,
                    ContentHash = null,
                    SignatureType = null,
                    SignaturePayload = null,
                    SignedAtUtc = null,
                    SignedByUserId = null,
                    PublishedAtUtc = null,
                    PublishedByUserId = null,
                    CreatedAtUtc = nowUtc
                };
            }
            else
            {
                // Un referto già firmato o pubblicato non può più essere modificato come bozza.
                if (report.Status != ClinicalReportStatus.Draft)
                {
                    return OperationResult<ClinicalReportDto>.Conflict(
                        "report_not_editable",
                        "È possibile modificare solo i referti in stato di bozza.");
                }

                // Aggiorna il contenuto della bozza e azzera tutti i metadati di firma/pubblicazione.
                report.Content = normalizedContent;
                report.ContentHash = null;
                report.SignatureType = null;
                report.SignaturePayload = null;
                report.SignedAtUtc = null;
                report.SignedByUserId = null;
                report.PublishedAtUtc = null;
                report.PublishedByUserId = null;
            }

            await _clinicalRepository
                .AddOrUpdateReportAsync(report, cancellationToken)
                .ConfigureAwait(false);

            return OperationResult<ClinicalReportDto>.Success(MapToDto(report));
        }

        /*
         * Firma il referto clinico in modo simulato,
         * calcolando l'hash del contenuto e salvando i metadati della firma.
         */
        public async Task<OperationResult<ClinicalReportDto>> SignReportAsync(
            Guid clinicianUserId,
            Guid encounterId,
            SignClinicalReportRequest? request,
            CancellationToken cancellationToken)
        {
            // La firma richiede una conferma esplicita dell'operazione.
            if (request is null || !request.Sign)
            {
                return OperationResult<ClinicalReportDto>.BadRequest(
                    "invalid_sign_request",
                    "Per firmare il referto è necessario confermare esplicitamente l'operazione.");
            }

            // Recupera l'encounter di riferimento.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<ClinicalReportDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

            // Solo il clinico assegnato all'encounter può firmare il referto.
            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<ClinicalReportDto>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato a modificare questo encounter.");
            }

            // Recupera il referto da firmare.
            var report = await _clinicalRepository
                .GetReportByEncounterIdAsync(encounter.Id, cancellationToken)
                .ConfigureAwait(false);

            if (report is null)
            {
                return OperationResult<ClinicalReportDto>.BadRequest(
                    "report_missing",
                    "Per firmare il referto è necessario aver creato previamente una bozza.");
            }

            // Impedisce firme duplicate.
            if (report.Status == ClinicalReportStatus.Signed)
            {
                return OperationResult<ClinicalReportDto>.Conflict(
                    "report_already_signed",
                    "Il referto risulta già firmato.");
            }

            // Impedisce la firma di un referto già pubblicato.
            if (report.Status == ClinicalReportStatus.Published)
            {
                return OperationResult<ClinicalReportDto>.Conflict(
                    "report_already_published",
                    "Il referto risulta già pubblicato e non può essere rifirmato.");
            }

            // Per poter firmare, il contenuto del referto deve essere valorizzato.
            if (string.IsNullOrWhiteSpace(report.Content))
            {
                return OperationResult<ClinicalReportDto>.BadRequest(
                    "invalid_report_content",
                    "Non è possibile firmare un referto con contenuto vuoto.");
            }

            var normalizedContent = report.Content.Trim();
            var nowUtc = DateTime.UtcNow;

            // Calcola l'hash SHA-256 del contenuto come base della firma simulata.
            var contentHash = ComputeSha256(normalizedContent);

            // Costruisce il payload descrittivo della firma simulata.
            var signaturePayload = new
            {
                simulated = true,
                algorithm = "SHA-256",
                contentHash,
                signedAtUtc = nowUtc,
                signedByUserId = clinicianUserId
            };

            // Aggiorna il referto con tutti i metadati di firma.
            report.Content = normalizedContent;
            report.Status = ClinicalReportStatus.Signed;
            report.ContentHash = contentHash;
            report.SignatureType = SignatureTypeValue;
            report.SignaturePayload = JsonSerializer.Serialize(signaturePayload);
            report.SignedAtUtc = nowUtc;
            report.SignedByUserId = clinicianUserId;

            await _clinicalRepository
                .AddOrUpdateReportAsync(report, cancellationToken)
                .ConfigureAwait(false);

            return OperationResult<ClinicalReportDto>.Success(MapToDto(report));
        }

        /*
         * Pubblica un referto clinico già firmato,
         * registrando il timestamp e l'identificativo del clinico che ha effettuato la pubblicazione.
         */
        public async Task<OperationResult<ClinicalReportDto>> PublishReportAsync(
            Guid clinicianUserId,
            Guid encounterId,
            PublishClinicalReportRequest? request,
            CancellationToken cancellationToken)
        {
            // La pubblicazione richiede una conferma esplicita dell'operazione.
            if (request is null || !request.Publish)
            {
                return OperationResult<ClinicalReportDto>.BadRequest(
                    "invalid_publish_request",
                    "Per pubblicare il referto è necessario confermare esplicitamente l'operazione.");
            }

            // Recupera l'encounter di riferimento.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<ClinicalReportDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

            // Solo il clinico assegnato all'encounter può pubblicare il referto.
            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<ClinicalReportDto>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato a modificare questo encounter.");
            }

            // Recupera il referto da pubblicare.
            var report = await _clinicalRepository
                .GetReportByEncounterIdAsync(encounter.Id, cancellationToken)
                .ConfigureAwait(false);

            if (report is null)
            {
                return OperationResult<ClinicalReportDto>.BadRequest(
                    "report_missing",
                    "Per pubblicare un referto è necessario aver creato previamente una bozza.");
            }

            // Impedisce pubblicazioni duplicate.
            if (report.Status == ClinicalReportStatus.Published)
            {
                return OperationResult<ClinicalReportDto>.Conflict(
                    "report_already_published",
                    "Il referto è già stato pubblicato.");
            }

            // La pubblicazione è consentita soltanto a partire da un referto già firmato.
            if (report.Status != ClinicalReportStatus.Signed)
            {
                return OperationResult<ClinicalReportDto>.Conflict(
                    "report_not_signed",
                    "È possibile pubblicare solo referti già firmati.");
            }

            var nowUtc = DateTime.UtcNow;

            // Aggiorna lo stato finale del referto e i metadati di pubblicazione.
            report.Status = ClinicalReportStatus.Published;
            report.PublishedAtUtc = nowUtc;
            report.PublishedByUserId = clinicianUserId;

            await _clinicalRepository
                .AddOrUpdateReportAsync(report, cancellationToken)
                .ConfigureAwait(false);

            return OperationResult<ClinicalReportDto>.Success(MapToDto(report));
        }

        /*
         * Converte un'entità ClinicalReport del dominio
         * nel corrispondente DTO applicativo.
         */
        private static ClinicalReportDto MapToDto(ClinicalReport report)
        {
            return new ClinicalReportDto(
                report.Id,
                report.EncounterId,
                report.Status.ToString(),
                report.Content,
                report.CreatedAtUtc,
                report.SignedAtUtc,
                report.SignedByUserId,
                report.PublishedAtUtc
            );
        }

        /*
         * Calcola l'hash SHA-256 di una stringa
         * e lo restituisce in formato esadecimale minuscolo.
         */
        private static string ComputeSha256(string content)
        {
            var bytes = Encoding.UTF8.GetBytes(content);
            var hash = SHA256.HashData(bytes);
            return Convert.ToHexString(hash).ToLowerInvariant();
        }
    }
}
