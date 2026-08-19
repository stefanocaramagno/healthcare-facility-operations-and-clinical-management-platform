/*
 * File: services/core-service/src/CoreService.Api/Controllers/Registry/PatientProfileController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint riservati al ruolo Patient per la gestione del proprio profilo,
 * delle proprie deleghe e dei propri consensi.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * self-service del paziente autenticato sul dominio Registry.
 * Tutte le operazioni sono limitate all'utente corrente ricavato dal token JWT.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare e aggiornare il profilo del paziente autenticato.
 * - Recuperare le deleghe associate al paziente.
 * - Aggiornare i permessi di una delega appartenente al paziente.
 * - Recuperare e aggiornare i consensi del paziente.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - PatientProfileService
 * - DelegationAccessService
 * - AdminRegistryService
 * - ClaimsPrincipal / JWT claims
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller non contiene logica di business del dominio:
 * ricava l'identità del paziente dal contesto autenticato e delega
 * tutte le regole applicative ai servizi specializzati.
 */

using System;
using System.Collections.Generic;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Registry.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace CoreService.Api.Controllers.Registry
{
    [ApiController]
    [Route("registry/patients/me")]
    [Authorize(Roles = "Patient")]
    public sealed class PatientProfileController : ControllerBase
    {
        // Servizi applicativi usati per gestire profilo, deleghe e consensi
        // del paziente autenticato.
        private readonly PatientProfileService _patientProfileService;
        private readonly DelegationAccessService _delegationAccessService;
        private readonly AdminRegistryService _adminRegistryService;

        /*
         * Inizializza il controller del profilo paziente con i servizi necessari
         * alla gestione delle operazioni self-service del ruolo Patient.
         */
        public PatientProfileController(
            PatientProfileService patientProfileService,
            DelegationAccessService delegationAccessService,
            AdminRegistryService adminRegistryService)
        {
            _patientProfileService = patientProfileService
                ?? throw new ArgumentNullException(nameof(patientProfileService));
            _delegationAccessService = delegationAccessService
                ?? throw new ArgumentNullException(nameof(delegationAccessService));
            _adminRegistryService = adminRegistryService
                ?? throw new ArgumentNullException(nameof(adminRegistryService));
        }

        /*
         * Recupera il profilo del paziente autenticato.
         */
        [HttpGet("profile")]
        public async Task<IActionResult> Get(CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var patientUserId = currentUserResult.Value;

            // Delega al servizio profilo il recupero del profilo del paziente corrente.
            var result = await _patientProfileService
                .GetMyProfileAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, propaga status code e payload coerenti.
            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            // Protezione difensiva contro un esito di successo privo di payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il recupero del profilo paziente."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea o aggiorna il profilo del paziente autenticato.
         */
        [HttpPut("profile")]
        public async Task<IActionResult> Upsert(
            [FromBody] UpsertPatientProfileRequest request,
            CancellationToken cancellationToken)
        {
            // Il body della richiesta è obbligatorio per il salvataggio del profilo.
            if (request is null)
            {
                return BadRequest(new
                {
                    code = "invalid_request",
                    message = "Il corpo della richiesta non può essere nullo."
                });
            }

            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var patientUserId = currentUserResult.Value;

            // Delega al servizio profilo il salvataggio del profilo del paziente corrente.
            var result = await _patientProfileService
                .UpsertMyProfileAsync(patientUserId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            // Protezione difensiva contro un esito di successo privo di payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il salvataggio del profilo paziente."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Recupera l'elenco delle deleghe associate al paziente autenticato.
         */
        [HttpGet("delegations")]
        public async Task<ActionResult<IReadOnlyList<DelegationDto>>> GetMyDelegations(
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var patientUserId = currentUserResult.Value;

            // Delega al servizio dedicato il recupero delle deleghe del paziente.
            var result = await _delegationAccessService
                .GetDelegationsForPatientAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            // Protezione difensiva contro un esito di successo privo di payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il recupero delle deleghe del paziente."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Aggiorna i permessi di una delega appartenente al paziente autenticato.
         */
        [HttpPatch("delegations/{delegationId:guid}/permissions")]
        public async Task<ActionResult<DelegationDto>> UpdateMyDelegationPermissions(
            Guid delegationId,
            [FromBody] UpdateDelegationPermissionsRequest request,
            CancellationToken cancellationToken)
        {
            // Il body della richiesta è obbligatorio per aggiornare i permessi.
            if (request is null)
            {
                return BadRequest(new
                {
                    code = "invalid_request",
                    message = "Il corpo della richiesta non può essere nullo."
                });
            }

            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var patientUserId = currentUserResult.Value;

            // Delega al servizio registry l'aggiornamento dei permessi della delega,
            // limitandolo al perimetro del paziente corrente.
            var result = await _adminRegistryService
                .UpdateMyDelegationPermissionsAsync(patientUserId, delegationId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            // Protezione difensiva contro un esito di successo privo di payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante l'aggiornamento dei permessi della delega."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Recupera l'insieme dei consensi associati al paziente autenticato.
         */
        [HttpGet("consents")]
        public async Task<ActionResult<IReadOnlyList<ConsentDto>>> GetMyConsents(
            CancellationToken cancellationToken)
        {
            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var patientUserId = currentUserResult.Value;

            // Delega al servizio registry il recupero dei consensi del paziente.
            var result = await _adminRegistryService
                .GetPatientConsentsAsync(patientUserId, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            // Protezione difensiva contro un esito di successo privo di payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il recupero dei consensi del paziente."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea o aggiorna l'insieme dei consensi del paziente autenticato.
         */
        [HttpPut("consents")]
        public async Task<ActionResult<IReadOnlyList<ConsentDto>>> UpsertMyConsents(
            [FromBody] UpsertPatientConsentsRequest request,
            CancellationToken cancellationToken)
        {
            // Il body della richiesta è obbligatorio per il salvataggio dei consensi.
            if (request is null)
            {
                return BadRequest(new
                {
                    code = "invalid_request",
                    message = "Il corpo della richiesta non può essere nullo."
                });
            }

            // Ricava l'identificativo del paziente dal contesto autenticato.
            var currentUserResult = GetCurrentUserId();
            if (currentUserResult.Result is not null)
            {
                return currentUserResult.Result;
            }

            var patientUserId = currentUserResult.Value;

            // Delega al servizio registry il salvataggio dei consensi del paziente.
            var result = await _adminRegistryService
                .UpsertPatientConsentsAsync(patientUserId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(result.StatusCode, new
                {
                    code = result.ErrorCode,
                    message = result.ErrorMessage
                });
            }

            // Protezione difensiva contro un esito di successo privo di payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il salvataggio dei consensi del paziente."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Ricava l'identificativo Guid dell'utente corrente dal contesto autenticato
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

            // Estrae il subject dal claim NameIdentifier, che nel sistema
            // rappresenta l'identificativo applicativo dell'utente.
            var subject = user.FindFirstValue(ClaimTypes.NameIdentifier);

            // Se il token non contiene un Guid valido, la richiesta viene rifiutata.
            if (string.IsNullOrWhiteSpace(subject) || !Guid.TryParse(subject, out var userId))
            {
                return (Guid.Empty, Unauthorized(new
                {
                    code = "invalid_token",
                    message = "Token di autenticazione non valido."
                }));
            }

            return (userId, null);
        }
    }
}
