/*
 * File: services/core-service/src/CoreService.Api/Controllers/Registry/AdminRegistryController.cs
 *
 * Scopo
 * -----
 * Esporre gli endpoint amministrativi relativi alla gestione delle anagrafiche
 * di pazienti, delegati, clinici, deleghe e consensi.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo controller rappresenta il punto di ingresso REST per le operazioni
 * del ruolo Admin sul dominio Registry. Consente ricerca, creazione,
 * consultazione e aggiornamento dei principali soggetti e delle relazioni
 * amministrative del sistema.
 *
 * Responsabilità principali
 * -------------------------
 * - Gestire la ricerca e creazione di Patient, Delegate e Clinician.
 * - Consentire il recupero e l'aggiornamento dei profili amministrativi.
 * - Gestire deleghe e relativi stati/permessi.
 * - Gestire i consensi associati ai pazienti.
 * - Tradurre gli esiti del service layer in risposte HTTP coerenti.
 *
 * Interazioni principali
 * ----------------------
 * - AdminRegistryService
 * - AdminDelegateRegistryService
 * - AdminDirectoryService
 * - AdminUserProvisioningService
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il controller è protetto dal ruolo Admin e non contiene logica di business:
 * delega tutte le regole applicative ai servizi specializzati del layer Application.
 */

using System;
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
    [Route("registry/admin")]
    [Authorize(Roles = "Admin")]
    public sealed class AdminRegistryController : ControllerBase
    {
        // Servizi applicativi specializzati per directory, profili, deleghe
        // e provisioning amministrativo degli utenti.
        private readonly AdminRegistryService _adminRegistryService;
        private readonly AdminDelegateRegistryService _adminDelegateRegistryService;
        private readonly AdminDirectoryService _adminDirectoryService;
        private readonly AdminUserProvisioningService _adminUserProvisioningService;

        /*
         * Inizializza il controller amministrativo del dominio Registry
         * con tutti i servizi applicativi necessari alle varie operazioni.
         */
        public AdminRegistryController(
            AdminRegistryService adminRegistryService,
            AdminDelegateRegistryService adminDelegateRegistryService,
            AdminDirectoryService adminDirectoryService,
            AdminUserProvisioningService adminUserProvisioningService)
        {
            _adminRegistryService = adminRegistryService
                ?? throw new ArgumentNullException(nameof(adminRegistryService));
            _adminDelegateRegistryService = adminDelegateRegistryService
                ?? throw new ArgumentNullException(nameof(adminDelegateRegistryService));
            _adminDirectoryService = adminDirectoryService
                ?? throw new ArgumentNullException(nameof(adminDirectoryService));
            _adminUserProvisioningService = adminUserProvisioningService
                ?? throw new ArgumentNullException(nameof(adminUserProvisioningService));
        }

        /*
         * Ricerca i pazienti secondo criteri opzionali di query testuale,
         * stato attivo e paginazione.
         */
        [HttpGet("patients")]
        public async Task<IActionResult> SearchPatients(
            [FromQuery] string? query,
            [FromQuery] bool? onlyActive,
            [FromQuery] int? skip,
            [FromQuery] int? take,
            CancellationToken cancellationToken)
        {
            // Delega al servizio directory la ricerca amministrativa dei pazienti.
            var result = await _adminDirectoryService
                .SearchPatientsAsync(query, onlyActive, skip, take, cancellationToken)
                .ConfigureAwait(false);

            // In caso di errore applicativo, restituisce status code e messaggio coerenti.
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

            // Protezione difensiva contro un esito di successo privo di payload.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante la ricerca dei pazienti."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea un nuovo utente Patient tramite provisioning amministrativo
         * e restituisce il riferimento alla risorsa creata.
         */
        [HttpPost("patients")]
        public async Task<IActionResult> CreatePatient(
            [FromBody] CreateAdminPatientRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio di provisioning la creazione amministrativa del paziente.
            var result = await _adminUserProvisioningService
                .CreatePatientAsync(request, cancellationToken)
                .ConfigureAwait(false);

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

            // Protezione difensiva contro un esito di successo senza entità creata.
            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante la creazione del paziente."
                });
            }

            // Restituisce 201 Created puntando all'endpoint di lettura del profilo paziente.
            return CreatedAtAction(
                nameof(GetPatientProfile),
                new { userId = result.Value.UserId },
                result.Value);
        }

        /*
         * Ricerca i delegati secondo criteri opzionali di query testuale,
         * stato attivo e paginazione.
         */
        [HttpGet("delegates")]
        public async Task<IActionResult> SearchDelegates(
            [FromQuery] string? query,
            [FromQuery] bool? onlyActive,
            [FromQuery] int? skip,
            [FromQuery] int? take,
            CancellationToken cancellationToken)
        {
            // Delega al servizio directory la ricerca amministrativa dei delegati.
            var result = await _adminDirectoryService
                .SearchDelegatesAsync(query, onlyActive, skip, take, cancellationToken)
                .ConfigureAwait(false);

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

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante la ricerca dei delegati."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea un nuovo utente Delegate tramite provisioning amministrativo
         * e restituisce il riferimento alla risorsa creata.
         */
        [HttpPost("delegates")]
        public async Task<IActionResult> CreateDelegate(
            [FromBody] CreateAdminDelegateRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio di provisioning la creazione amministrativa del delegato.
            var result = await _adminUserProvisioningService
                .CreateDelegateAsync(request, cancellationToken)
                .ConfigureAwait(false);

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

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante la creazione del delegato."
                });
            }

            // Restituisce 201 Created puntando all'endpoint di lettura del profilo delegato.
            return CreatedAtAction(
                nameof(GetDelegateProfile),
                new { userId = result.Value.UserId },
                result.Value);
        }

        /*
         * Ricerca i clinici secondo criteri opzionali di query testuale,
         * stato attivo e paginazione.
         */
        [HttpGet("clinicians")]
        public async Task<IActionResult> SearchClinicians(
            [FromQuery] string? query,
            [FromQuery] bool? onlyActive,
            [FromQuery] int? skip,
            [FromQuery] int? take,
            CancellationToken cancellationToken)
        {
            // Delega al servizio directory la ricerca amministrativa dei clinici.
            var result = await _adminDirectoryService
                .SearchCliniciansAsync(query, onlyActive, skip, take, cancellationToken)
                .ConfigureAwait(false);

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

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante la ricerca dei clinici."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea un nuovo utente Clinician tramite provisioning amministrativo
         * e restituisce il riferimento alla risorsa creata.
         */
        [HttpPost("clinicians")]
        public async Task<IActionResult> CreateClinician(
            [FromBody] CreateAdminClinicianRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio di provisioning la creazione amministrativa del clinico.
            var result = await _adminUserProvisioningService
                .CreateClinicianAsync(request, cancellationToken)
                .ConfigureAwait(false);

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

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante la creazione del clinico."
                });
            }

            // Restituisce 201 Created puntando all'endpoint di lettura del profilo clinico.
            return CreatedAtAction(
                nameof(GetClinicianProfile),
                new { userId = result.Value.UserId },
                result.Value);
        }

        /*
         * Recupera il profilo amministrativo completo di un paziente
         * identificato dal relativo userId.
         */
        [HttpGet("patients/{userId:guid}/profile")]
        public async Task<IActionResult> GetPatientProfile(
            Guid userId,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry il recupero del profilo paziente.
            var result = await _adminRegistryService
                .GetPatientProfileAsync(userId, cancellationToken)
                .ConfigureAwait(false);

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
         * Crea o aggiorna il profilo amministrativo di un paziente
         * e restituisce 201 oppure 200 in base all'esito del workflow.
         */
        [HttpPut("patients/{userId:guid}/profile")]
        public async Task<IActionResult> UpsertPatientProfile(
            Guid userId,
            [FromBody] UpsertPatientProfileRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry il salvataggio del profilo paziente.
            var result = await _adminRegistryService
                .UpsertPatientProfileAsync(userId, request, cancellationToken)
                .ConfigureAwait(false);

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

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il salvataggio del profilo paziente."
                });
            }

            var payload = result.Value;

            // Se il profilo è stato creato ex novo, restituisce 201 Created;
            // altrimenti restituisce 200 OK con il profilo aggiornato.
            if (payload.Created)
            {
                return CreatedAtAction(
                    nameof(GetPatientProfile),
                    new { userId },
                    payload.Profile);
            }

            return Ok(payload.Profile);
        }

        /*
         * Recupera il profilo amministrativo completo di un delegato
         * identificato dal relativo userId.
         */
        [HttpGet("delegates/{userId:guid}/profile")]
        public async Task<IActionResult> GetDelegateProfile(
            Guid userId,
            CancellationToken cancellationToken)
        {
            // Delega al servizio delegate registry il recupero del profilo delegato.
            var result = await _adminDelegateRegistryService
                .GetDelegateProfileAsync(userId, cancellationToken)
                .ConfigureAwait(false);

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

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il recupero del profilo delegato."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea o aggiorna il profilo amministrativo di un delegato
         * e restituisce 201 oppure 200 in base all'esito del workflow.
         */
        [HttpPut("delegates/{userId:guid}/profile")]
        public async Task<IActionResult> UpsertDelegateProfile(
            Guid userId,
            [FromBody] UpsertDelegateProfileRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio delegate registry il salvataggio del profilo delegato.
            var result = await _adminDelegateRegistryService
                .UpsertDelegateProfileAsync(userId, request, cancellationToken)
                .ConfigureAwait(false);

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

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il salvataggio del profilo delegato."
                });
            }

            var payload = result.Value;

            // Se il profilo è stato creato ex novo, restituisce 201 Created;
            // altrimenti restituisce 200 OK con il profilo aggiornato.
            if (payload.Created)
            {
                return CreatedAtAction(
                    nameof(GetDelegateProfile),
                    new { userId },
                    payload.Profile);
            }

            return Ok(payload.Profile);
        }

        /*
         * Recupera il profilo amministrativo completo di un clinico
         * identificato dal relativo userId.
         */
        [HttpGet("clinicians/{userId:guid}/profile")]
        public async Task<IActionResult> GetClinicianProfile(
            Guid userId,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry il recupero del profilo clinico.
            var result = await _adminRegistryService
                .GetClinicianProfileAsync(userId, cancellationToken)
                .ConfigureAwait(false);

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

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il recupero del profilo clinico."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Crea o aggiorna il profilo amministrativo di un clinico
         * e restituisce 201 oppure 200 in base all'esito del workflow.
         */
        [HttpPut("clinicians/{userId:guid}/profile")]
        public async Task<IActionResult> UpsertClinicianProfile(
            Guid userId,
            [FromBody] UpsertClinicianProfileRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry il salvataggio del profilo clinico.
            var result = await _adminRegistryService
                .UpsertClinicianProfileAsync(userId, request, cancellationToken)
                .ConfigureAwait(false);

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

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante il salvataggio del profilo clinico."
                });
            }

            var payload = result.Value;

            // Se il profilo è stato creato ex novo, restituisce 201 Created;
            // altrimenti restituisce 200 OK con il profilo aggiornato.
            if (payload.Created)
            {
                return CreatedAtAction(
                    nameof(GetClinicianProfile),
                    new { userId },
                    payload.Profile);
            }

            return Ok(payload.Profile);
        }

        /*
         * Recupera l'elenco delle deleghe associate a un paziente specifico.
         */
        [HttpGet("patients/{userId:guid}/delegations")]
        public async Task<IActionResult> GetPatientDelegations(
            Guid userId,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry il recupero delle deleghe del paziente.
            var result = await _adminRegistryService
                .GetPatientDelegationsAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new { code = result.ErrorCode, message = result.ErrorMessage });
            }

            // Se il servizio restituisce null, il controller preferisce una collezione vuota.
            return Ok(result.Value ?? Array.Empty<DelegationDto>());
        }

        /*
         * Crea una nuova delega per il paziente specificato.
         */
        [HttpPost("patients/{userId:guid}/delegations")]
        public async Task<IActionResult> CreateDelegation(
            Guid userId,
            [FromBody] CreateDelegationRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry la creazione della delega.
            var result = await _adminRegistryService
                .CreateDelegationAsync(userId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new { code = result.ErrorCode, message = result.ErrorMessage });
            }

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante la creazione della delega."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Recupera l'elenco delle deleghe associate a un delegato specifico.
         */
        [HttpGet("delegates/{userId:guid}/delegations")]
        public async Task<IActionResult> GetDelegateDelegations(
            Guid userId,
            CancellationToken cancellationToken)
        {
            // Delega al servizio delegate registry il recupero delle deleghe del delegato.
            var result = await _adminDelegateRegistryService
                .GetDelegateDelegationsAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new { code = result.ErrorCode, message = result.ErrorMessage });
            }

            return Ok(result.Value ?? Array.Empty<DelegationDto>());
        }

        /*
         * Aggiorna lo stato amministrativo di una delega esistente.
         */
        [HttpPatch("delegations/{delegationId:guid}/status")]
        public async Task<IActionResult> UpdateDelegationStatus(
            Guid delegationId,
            [FromBody] UpdateDelegationStatusRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry l'aggiornamento dello stato della delega.
            var result = await _adminRegistryService
                .UpdateDelegationStatusAsync(delegationId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new { code = result.ErrorCode, message = result.ErrorMessage });
            }

            if (result.Value is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    code = "unexpected_null_result",
                    message = "Si è verificato un errore inatteso durante l'aggiornamento della delega."
                });
            }

            return Ok(result.Value);
        }

        /*
         * Aggiorna i permessi associati a una delega esistente.
         */
        [HttpPatch("delegations/{delegationId:guid}/permissions")]
        public async Task<IActionResult> UpdateDelegationPermissions(
            Guid delegationId,
            [FromBody] UpdateDelegationPermissionsRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry l'aggiornamento dei permessi della delega.
            var result = await _adminRegistryService
                .UpdateDelegationPermissionsAsync(delegationId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new { code = result.ErrorCode, message = result.ErrorMessage });
            }

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
         * Recupera l'insieme dei consensi associati a un paziente specifico.
         */
        [HttpGet("patients/{userId:guid}/consents")]
        public async Task<IActionResult> GetPatientConsents(
            Guid userId,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry il recupero dei consensi del paziente.
            var result = await _adminRegistryService
                .GetPatientConsentsAsync(userId, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new { code = result.ErrorCode, message = result.ErrorMessage });
            }

            return Ok(result.Value ?? Array.Empty<ConsentDto>());
        }

        /*
         * Crea o aggiorna l'insieme dei consensi associati a un paziente specifico.
         */
        [HttpPut("patients/{userId:guid}/consents")]
        public async Task<IActionResult> UpsertPatientConsents(
            Guid userId,
            [FromBody] UpsertPatientConsentsRequest request,
            CancellationToken cancellationToken)
        {
            // Delega al servizio registry il salvataggio dei consensi del paziente.
            var result = await _adminRegistryService
                .UpsertPatientConsentsAsync(userId, request, cancellationToken)
                .ConfigureAwait(false);

            if (result.IsFailure)
            {
                return StatusCode(
                    result.StatusCode,
                    new { code = result.ErrorCode, message = result.ErrorMessage });
            }

            return Ok(result.Value ?? Array.Empty<ConsentDto>());
        }
    }
}
