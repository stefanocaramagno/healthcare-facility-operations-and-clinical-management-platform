/*
 * File: services/core-service/src/CoreService.Api/Controllers/Clinical/ClinicianClinicalController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Clinician per la gestione completa
 * del workflow clinico relativo agli encounter di propria competenza.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del clinico sul dominio Clinical. Consente di consultare encounter,
 * aprirli, arricchirli con anamnesi e parametri vitali, creare ordini,
 * registrare esecuzioni, gestire il referto clinico e completare l'encounter.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare l'elenco degli encounter del clinico autenticato.
 * - Recuperare il dettaglio di un encounter specifico.
 * - Avviare un nuovo encounter.
 * - Registrare anamnesi, parametri vitali, ordini ed esecuzioni.
 * - Creare, firmare e pubblicare il referto clinico.
 * - Completare l'encounter.
 * - Ricavare in modo affidabile l'identità del clinico dal contesto autenticato.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - ClinicianClinicalService
 * - ClinicalReportWorkflowService
 * - UtcQueryTimeParser
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Clinician e non contiene logica di business:
 * delega tutte le regole applicative ai servizi specializzati del layer Application.
 */

using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Clinical.Services;
using CoreService.Api.Controllers.Shared;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Clinical
{
    [ApiController]
    [Route("clinical/clinicians/me")]
    [Authorize(Roles = "Clinician")]
    public sealed class ClinicianClinicalController : ControllerBase
    {
        // Servizi applicativi usati per la gestione del workflow clinico
        // e del ciclo di vita del referto associato all'encounter.
        private readonly ClinicianClinicalService _clinicianClinicalService;
        private readonly ClinicalReportWorkflowService _clinicalReportWorkflowService;

        /*
         * Inizializza il controller clinico del ruolo Clinician
         * con i servizi applicativi necessari alle operazioni richieste.
         */
        public ClinicianClinicalController(
            ClinicianClinicalService clinicianClinicalService,
            ClinicalReportWorkflowService clinicalReportWorkflowService)
        {
            _clinicianClinicalService = clinicianClinicalService
                ?? throw new ArgumentNullException(nameof(clinicianClinicalService));
            _clinicalReportWorkflowService = clinicalReportWorkflowService
                ?? throw new ArgumentNullException(nameof(clinicalReportWorkflowService));
        }

        /*
         * Recupera l'elenco degli encounter del clinico autenticato,
         * filtrando opzionalmente per intervallo temporale espresso in UTC.
         */
        [HttpGet("encounters")]
        public async Task<ActionResult<IReadOnlyList<ClinicalEncounterSummaryDto>>> GetMyEncounters(
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Valida e converte il parametro temporale iniziale,
            // richiedendo offset esplicito oppure suffisso UTC.
            if (!UtcQueryTimeParser.TryParseOptionalUtcQuery(fromUtc, "fromUtc", out var parsedFromUtc, out var fromError))
            {
                return fromError!;
            }

            // Valida e converte il parametro temporale finale,
            // richiedendo offset esplicito oppure suffisso UTC.
            if (!UtcQueryTimeParser.TryParseOptionalUtcQuery(toUtc, "toUtc", out var parsedToUtc, out var toError))
            {
                return toError!;
            }

            // Delega al service layer il recupero degli encounter
            // associati al clinico corrente.
            var result = await _clinicianClinicalService
                .GetClinicianEncountersAsync(clinicianUserId, parsedFromUtc, parsedToUtc, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            // Se il servizio non restituisce elementi, il controller preferisce
            // una collezione vuota invece di un valore nullo.
            var encounters = result.Value ?? Array.Empty<ClinicalEncounterSummaryDto>();

            return Ok(encounters);
        }

        /*
         * Recupera il dettaglio completo di uno specifico encounter
         * appartenente al clinico autenticato.
         */
        [HttpGet("encounters/{encounterId:guid}")]
        public async Task<ActionResult<ClinicalEncounterDetailDto>> GetEncounterDetails(
            Guid encounterId,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al service layer il recupero del dettaglio dell'encounter.
            var result = await _clinicianClinicalService
                .GetEncounterDetailsAsync(clinicianUserId, encounterId, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            // Se l'encounter non è stato trovato oppure non è accessibile,
            // restituisce un 404 esplicativo.
            if (result.Value is null)
            {
                return NotFound(new
                {
                    code = "encounter_not_found",
                    message = "L'encounter specificato non esiste."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Avvia un nuovo encounter per il clinico autenticato
         * e restituisce la risorsa clinica appena creata.
         */
        [HttpPost("encounters")]
        public async Task<ActionResult<ClinicalEncounterSummaryDto>> StartEncounter(
            [FromBody] CreateEncounterRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al service layer l'avvio del nuovo encounter.
            var result = await _clinicianClinicalService
                .StartEncounterAsync(clinicianUserId, request, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            var dto = result.Value!;

            // Restituisce 201 Created puntando alla risorsa encounter appena creata.
            return Created($"clinical/clinicians/me/encounters/{dto.Id}", dto);
        }

        /*
         * Registra una nuova anamnesi all'interno di uno specifico encounter
         * del clinico autenticato.
         */
        [HttpPost("encounters/{encounterId:guid}/anamneses")]
        public async Task<ActionResult<AnamnesisRecordDto>> AddAnamnesis(
            Guid encounterId,
            [FromBody] CreateAnamnesisRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al service layer la registrazione dell'anamnesi.
            var result = await _clinicianClinicalService
                .AddAnamnesisAsync(clinicianUserId, encounterId, request, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            var dto = result.Value!;

            // Restituisce 201 Created puntando alla risorsa anamnesi appena creata.
            return Created($"clinical/clinicians/me/encounters/{encounterId}/anamneses/{dto.Id}", dto);
        }

        /*
         * Registra un nuovo parametro vitale all'interno di uno specifico encounter
         * del clinico autenticato.
         */
        [HttpPost("encounters/{encounterId:guid}/vital-signs")]
        public async Task<ActionResult<VitalSignDto>> RecordVitalSign(
            Guid encounterId,
            [FromBody] RecordVitalSignRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al service layer la registrazione del parametro vitale.
            var result = await _clinicianClinicalService
                .RecordVitalSignAsync(clinicianUserId, encounterId, request, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            var dto = result.Value!;

            // Restituisce 201 Created puntando alla risorsa parametro vitale appena creata.
            return Created($"clinical/clinicians/me/encounters/{encounterId}/vital-signs/{dto.Id}", dto);
        }

        /*
         * Crea un nuovo ordine clinico all'interno di uno specifico encounter
         * del clinico autenticato.
         */
        [HttpPost("encounters/{encounterId:guid}/orders")]
        public async Task<ActionResult<ClinicalOrderDto>> CreateOrder(
            Guid encounterId,
            [FromBody] CreateClinicalOrderRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al service layer la creazione dell'ordine clinico.
            var result = await _clinicianClinicalService
                .CreateOrderAsync(clinicianUserId, encounterId, request, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            var dto = result.Value!;

            // Restituisce 201 Created puntando alla risorsa ordine appena creata.
            return Created($"clinical/clinicians/me/encounters/{encounterId}/orders/{dto.Id}", dto);
        }

        /*
         * Registra l'esecuzione di un ordine clinico esistente
         * del clinico autenticato.
         */
        [HttpPost("orders/{orderId:guid}/executions")]
        public async Task<ActionResult<ProcedureExecutionDto>> RecordExecution(
            Guid orderId,
            [FromBody] RecordProcedureExecutionRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al service layer la registrazione dell'esecuzione procedurale.
            var result = await _clinicianClinicalService
                .RecordExecutionAsync(clinicianUserId, orderId, request, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            var dto = result.Value!;

            // Restituisce 201 Created puntando alla risorsa esecuzione appena creata.
            return Created($"clinical/clinicians/me/orders/{orderId}/executions/{dto.Id}", dto);
        }

        /*
         * Crea o aggiorna il referto clinico associato a uno specifico encounter
         * del clinico autenticato.
         */
        [HttpPut("encounters/{encounterId:guid}/report")]
        public async Task<ActionResult<ClinicalReportDto>> UpsertReport(
            Guid encounterId,
            [FromBody] UpsertClinicalReportRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al workflow dedicato la creazione o l'aggiornamento del referto.
            var result = await _clinicalReportWorkflowService
                .UpsertReportAsync(clinicianUserId, encounterId, request, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            return Ok(result.Value);
        }

        /*
         * Firma il referto clinico associato a uno specifico encounter
         * del clinico autenticato.
         */
        [HttpPost("encounters/{encounterId:guid}/report/sign")]
        public async Task<ActionResult<ClinicalReportDto>> SignReport(
            Guid encounterId,
            [FromBody] SignClinicalReportRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al workflow dedicato la firma del referto clinico.
            var result = await _clinicalReportWorkflowService
                .SignReportAsync(clinicianUserId, encounterId, request, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            return Ok(result.Value);
        }

        /*
         * Pubblica il referto clinico associato a uno specifico encounter
         * del clinico autenticato.
         */
        [HttpPost("encounters/{encounterId:guid}/report/publish")]
        public async Task<ActionResult<ClinicalReportDto>> PublishReport(
            Guid encounterId,
            [FromBody] PublishClinicalReportRequest? request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al workflow dedicato la pubblicazione del referto clinico.
            var result = await _clinicalReportWorkflowService
                .PublishReportAsync(clinicianUserId, encounterId, request, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            return Ok(result.Value);
        }

        /*
         * Completa formalmente uno specifico encounter
         * del clinico autenticato.
         */
        [HttpPost("encounters/{encounterId:guid}/complete")]
        public async Task<IActionResult> CompleteEncounter(
            Guid encounterId,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del clinico dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var clinicianUserId = currentUserResult.Value;

            // Delega al service layer il completamento dell'encounter.
            var result = await _clinicianClinicalService
                .CompleteEncounterAsync(clinicianUserId, encounterId, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new
                    {
                        code = result.ErrorCode,
                        message = result.ErrorMessage
                    });
            }

            return NoContent();
        }

        /*
         * Ricava l'identificativo Guid del clinico corrente dal token JWT
         * e restituisce una ActionResult di errore se il contesto autenticato non è valido.
         */
        private (Guid Value, ActionResult? Result) GetCurrentUserId()
        {
            // Supporta sia il claim .NET NameIdentifier sia i claim JWT "sub",
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var userIdClaim =
                User.FindFirst(ClaimTypes.NameIdentifier)?.Value ??
                User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ??
                User.FindFirst("sub")?.Value;

            // Se il token non contiene un identificativo utente valido,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                var errorPayload = new
                {
                    code = "invalid_token",
                    message = "Token JWT privo di identificativo utente valido."
                };

                return (Guid.Empty, Unauthorized(errorPayload));
            }

            return (userId, null);
        }
    }
}
