/*
 * File: services/core-service/src/CoreService.Api/Controllers/Clinical/DelegateClinicalController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Delegate per la consultazione
 * dei referti clinici pubblicati dei pazienti deleganti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del delegato sul dominio Clinical limitatamente alla consultazione dei referti.
 * Ogni operazione viene eseguita solo dopo la verifica dell'esistenza
 * di una delega attiva e del relativo perimetro autorizzativo.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare i referti pubblicati di un paziente delegato.
 * - Supportare sia l'endpoint corrente sia una rotta legacy compatibile.
 * - Verificare l'identità del delegato autenticato.
 * - Verificare la presenza di una delega attiva con scope compatibile.
 * - Validare i parametri temporali opzionali espressi in UTC con offset esplicito.
 * - Tradurre gli esiti del workflow in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientClinicalService
 * - DelegationAccessService
 * - UtcQueryTimeParser
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller non contiene logica di business del dominio:
 * ricava l'identità del delegato dal contesto autenticato,
 * verifica il perimetro di delega e delega tutte le operazioni
 * ai servizi applicativi specializzati.
 */

using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Clinical.Services;
using CoreService.Application.Registry.Services;
using CoreService.Api.Controllers.Shared;
using CoreService.Domain.Registry;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Clinical
{
    [ApiController]
    [Route("clinical/delegates")]
    [Authorize(Roles = "Delegate")]
    public sealed class DelegateClinicalController : ControllerBase
    {
        // Servizi applicativi usati per accedere ai referti del paziente delegato
        // e per verificare la validità della delega associata.
        private readonly PatientClinicalService _patientClinicalService;
        private readonly DelegationAccessService _delegationAccessService;

        /*
         * Inizializza il controller clinico del delegato
         * con i servizi applicativi necessari al controllo deleghe
         * e al recupero dei referti.
         */
        public DelegateClinicalController(
            PatientClinicalService patientClinicalService,
            DelegationAccessService delegationAccessService)
        {
            _patientClinicalService = patientClinicalService
                ?? throw new ArgumentNullException(nameof(patientClinicalService));
            _delegationAccessService = delegationAccessService
                ?? throw new ArgumentNullException(nameof(delegationAccessService));
        }

        /*
         * Recupera i referti pubblicati di un paziente delegato,
         * previa verifica di una delega attiva almeno in sola lettura.
         */
        [HttpGet("me/reports")]
        public async Task<ActionResult<IReadOnlyList<PatientClinicalReportDto>>> GetReportsForDelegatedPatient(
            [FromQuery] Guid patientUserId,
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del delegato dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            // Il paziente delegato deve essere sempre esplicitato nella richiesta.
            if (patientUserId == Guid.Empty)
            {
                return BadRequest(new
                {
                    code = "invalid_patient_id",
                    message = "Il parametro patientUserId è obbligatorio."
                });
            }

            var delegateUserId = currentUserResult.Value;

            // Verifica che esista una delega attiva che consenta almeno la lettura
            // delle informazioni cliniche del paziente delegato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(
                    patientUserId,
                    delegateUserId,
                    DelegationScope.ReadOnly,
                    cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(delegationResult.StatusCode, new
                {
                    code = delegationResult.ErrorCode,
                    message = delegationResult.ErrorMessage
                });
            }

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

            // Delega al service layer il recupero dei referti pubblicati
            // del paziente delegato nell'intervallo temporale richiesto.
            var reports = await _patientClinicalService
                .GetPublishedReportsForPatientAsync(
                    patientUserId,
                    parsedFromUtc,
                    parsedToUtc,
                    cancellationToken)
                .ConfigureAwait(false);

            return Ok(reports);
        }

        /*
         * Espone una rotta legacy compatibile che inoltra la richiesta
         * al metodo principale di recupero dei referti del paziente delegato.
         */
        [HttpGet("me/patients/{patientUserId:guid}/reports")]
        public Task<ActionResult<IReadOnlyList<PatientClinicalReportDto>>> GetReportsForDelegatedPatientLegacy(
            Guid patientUserId,
            [FromQuery] string? fromUtc,
            [FromQuery] string? toUtc,
            CancellationToken cancellationToken)
        {
            // Mantiene compatibilità con una rotta precedente
            // riutilizzando integralmente la logica del metodo principale.
            return GetReportsForDelegatedPatient(patientUserId, fromUtc, toUtc, cancellationToken);
        }

        /*
         * Ricava l'identificativo Guid del delegato corrente dal contesto autenticato
         * e restituisce una ActionResult di errore se il token non è valido.
         */
        private (Guid Value, ActionResult? Result) GetCurrentUserId()
        {
            var user = HttpContext.User;

            // Verifica che l'utente sia effettivamente autenticato.
            if (user?.Identity is not { IsAuthenticated: true })
            {
                return (Guid.Empty, Unauthorized(new
                {
                    code = "unauthorized",
                    message = "Utente non autenticato."
                }));
            }

            // Supporta sia NameIdentifier sia i claim JWT "sub"
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var subject =
                user.FindFirstValue(ClaimTypes.NameIdentifier) ??
                user.FindFirstValue(JwtRegisteredClaimNames.Sub) ??
                user.FindFirstValue("sub");

            // Se il token non contiene un identificativo utente valido,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(subject) || !Guid.TryParse(subject, out var userId))
            {
                return (Guid.Empty, Unauthorized(new
                {
                    code = "invalid_token",
                    message = "Token JWT privo di identificativo utente valido."
                }));
            }

            return (userId, null);
        }
    }
}
