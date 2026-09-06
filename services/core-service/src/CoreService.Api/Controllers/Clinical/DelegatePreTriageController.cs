/*
 * File: services/core-service/src/CoreService.Api/Controllers/Clinical/DelegatePreTriageController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Delegate per la consultazione
 * e la compilazione del questionario di pre-triage associato agli appuntamenti
 * dei pazienti deleganti.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del delegato sul dominio Clinical limitatamente al pre-triage.
 * Ogni operazione viene eseguita solo dopo la verifica dell'esistenza
 * di una delega attiva e del relativo perimetro autorizzativo.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare il questionario di pre-triage di un appuntamento di un paziente delegato.
 * - Creare o aggiornare il questionario di pre-triage per un paziente delegato.
 * - Verificare l'identità del delegato autenticato.
 * - Verificare la presenza di una delega attiva con scope compatibile.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientPreTriageService
 * - DelegationAccessService
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
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Clinical.Services;
using CoreService.Application.Contracts;
using CoreService.Application.Registry.Services;
using CoreService.Domain.Registry;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Clinical
{
    [ApiController]
    [Route("clinical/delegates/me/pretriage")]
    [Authorize(Roles = "Delegate")]
    public sealed class DelegatePreTriageController : ControllerBase
    {
        // Servizi applicativi usati per operare sul pre-triage del paziente delegato
        // e per verificare la validità della delega associata.
        private readonly PatientPreTriageService _patientPreTriageService;
        private readonly DelegationAccessService _delegationAccessService;

        /*
         * Inizializza il controller del pre-triage del delegato
         * con i servizi applicativi necessari al controllo deleghe
         * e alla gestione del questionario.
         */
        public DelegatePreTriageController(
            PatientPreTriageService patientPreTriageService,
            DelegationAccessService delegationAccessService)
        {
            _patientPreTriageService = patientPreTriageService
                ?? throw new ArgumentNullException(nameof(patientPreTriageService));
            _delegationAccessService = delegationAccessService
                ?? throw new ArgumentNullException(nameof(delegationAccessService));
        }

        /*
         * Recupera il questionario di pre-triage associato a uno specifico appuntamento
         * di un paziente delegato, previa verifica di una delega attiva almeno in sola lettura.
         */
        [HttpGet("appointments/{appointmentId:guid}")]
        public async Task<IActionResult> GetForAppointment(
            Guid appointmentId,
            [FromQuery] Guid patientUserId,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del delegato dal contesto autenticato.
            var (delegateUserId, errorResult) = TryGetCurrentUserId();
            if (errorResult != null)
            {
                return errorResult;
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

            // Verifica che esista una delega attiva che consenta almeno la lettura
            // delle informazioni del paziente delegato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(
                    patientUserId,
                    delegateUserId,
                    DelegationScope.ReadOnly,
                    cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(
                    delegationResult.StatusCode,
                    new
                    {
                        code = delegationResult.ErrorCode,
                        message = delegationResult.ErrorMessage
                    });
            }

            // Delega al service layer il recupero del questionario di pre-triage
            // relativo all'appuntamento richiesto.
            var result = await _patientPreTriageService
                .GetForAppointmentAsync(patientUserId, appointmentId, cancellationToken)
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
         * Crea o aggiorna il questionario di pre-triage associato a uno specifico appuntamento
         * di un paziente delegato, previa verifica di una delega attiva con gestione appuntamenti.
         */
        [HttpPut("appointments/{appointmentId:guid}")]
        public async Task<IActionResult> UpsertForAppointment(
            Guid appointmentId,
            [FromQuery] Guid patientUserId,
            [FromBody] UpsertPreTriageQuestionnaireRequest request,
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del delegato dal contesto autenticato.
            var (delegateUserId, errorResult) = TryGetCurrentUserId();
            if (errorResult != null)
            {
                return errorResult;
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

            // Verifica che esista una delega attiva che consenta la gestione
            // degli appuntamenti del paziente delegato.
            var delegationResult = await _delegationAccessService
                .EnsureActiveDelegationAsync(
                    patientUserId,
                    delegateUserId,
                    DelegationScope.ManageAppointments,
                    cancellationToken)
                .ConfigureAwait(false);

            if (delegationResult.IsFailure)
            {
                return StatusCode(
                    delegationResult.StatusCode,
                    new
                    {
                        code = delegationResult.ErrorCode,
                        message = delegationResult.ErrorMessage
                    });
            }

            // Delega al service layer il salvataggio del questionario di pre-triage
            // relativo all'appuntamento richiesto.
            var result = await _patientPreTriageService
                .UpsertForAppointmentAsync(patientUserId, appointmentId, request, cancellationToken)
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
         * Ricava l'identificativo Guid del delegato corrente dal token JWT
         * e restituisce un IActionResult di errore se il contesto autenticato non è valido.
         */
        private (Guid userId, IActionResult? errorResult) TryGetCurrentUserId()
        {
            // Supporta sia il claim .NET NameIdentifier sia i claim JWT "sub",
            // per massimizzare la compatibilità con i token emessi dal sistema.
            var subClaim =
                User.FindFirst(ClaimTypes.NameIdentifier)?.Value ??
                User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ??
                User.FindFirst("sub")?.Value;

            // Se il token non contiene un identificativo utente valido,
            // la richiesta viene rifiutata come non autorizzata.
            if (string.IsNullOrWhiteSpace(subClaim) || !Guid.TryParse(subClaim, out var userId))
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
