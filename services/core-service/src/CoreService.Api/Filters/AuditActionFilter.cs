/*
 * File: services/core-service/src/CoreService.Api/Filters/AuditActionFilter.cs
 *
 * Scopo
 * -----
 * Intercettare l'esecuzione delle action controller rilevanti e produrre,
 * in modo best effort, una registrazione di audit coerente con il dominio applicativo.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo filtro appartiene al livello API del Core Service e rappresenta
 * il punto in cui le operazioni HTTP significative vengono osservate
 * e trasformate in eventi di audit persistibili.
 *
 * Responsabilità principali
 * -------------------------
 * - Riconoscere le action che richiedono audit.
 * - Estrarre il contesto tecnico e applicativo della richiesta.
 * - Determinare esito, status code, attore, ruolo ed entità coinvolta.
 * - Serializzare metadati utili alla tracciabilità.
 * - Delegare la scrittura effettiva dell'audit all'AuditService.
 *
 * Interazioni principali
 * ----------------------
 * - AuditService
 * - MVC Action Filters
 * - ClaimsPrincipal
 * - IActionResult / ActionExecutedContext
 *
 * Note
 * ----
 * Il filtro adotta una logica best effort: l'obiettivo è tracciare le operazioni
 * senza compromettere il flusso principale della richiesta applicativa.
 */

using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;
using CoreService.Application.Events.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;

namespace CoreService.Api.Filters
{
    public sealed class AuditActionFilter : IAsyncActionFilter
    {
        // Opzioni JSON condivise per serializzare i metadati di audit
        // in un formato coerente con il profilo Web.
        private static readonly JsonSerializerOptions MetadataJsonOptions = new(JsonSerializerDefaults.Web);

        // Servizio applicativo incaricato della persistenza best effort del log di audit.
        private readonly AuditService _auditService;

        /*
         * Inizializza il filtro di audit con il servizio applicativo incaricato
         * della scrittura dei record di audit.
         */
        public AuditActionFilter(AuditService auditService)
        {
            // Il filtro dipende obbligatoriamente dal servizio di audit,
            // senza il quale non potrebbe registrare gli eventi osservati.
            _auditService = auditService
                ?? throw new ArgumentNullException(nameof(auditService));
        }

        /*
         * Esegue l'intercettazione dell'action MVC, ne osserva l'esito
         * e, se applicabile, registra un evento di audit con i metadati rilevanti.
         */
        public async Task OnActionExecutionAsync(
            ActionExecutingContext context,
            ActionExecutionDelegate next)
        {
            // Determina se la action corrente rientra tra quelle per cui
            // è stata definita una policy di audit.
            var definition = ResolveDefinition(context);
            if (definition is null)
            {
                // Se la action non è mappata per l'audit, il filtro non interviene
                // e lascia proseguire il normale flusso MVC.
                await next().ConfigureAwait(false);
                return;
            }

            // Esegue la action e attende il completamento del relativo pipeline step,
            // così da poter osservare l'esito finale dell'operazione.
            var executedContext = await next().ConfigureAwait(false);

            // Recupera l'identificativo dell'utente attore a partire dai claim di autenticazione.
            var actorUserId = TryGetCurrentUserId(context.HttpContext.User);
            if (!actorUserId.HasValue || actorUserId.Value == Guid.Empty)
            {
                // Se non è possibile determinare l'attore, l'audit viene omesso
                // perché perderebbe una delle sue informazioni essenziali.
                return;
            }

            // Determina il codice di stato finale della richiesta.
            var statusCode = ResolveStatusCode(executedContext);

            // Traduce status code ed eventuale eccezione in un outcome logico di audit.
            var outcome = ResolveOutcome(statusCode, executedContext.Exception);

            // Risolve l'identificativo dell'entità principale oggetto dell'operazione.
            var entityId = ResolveEntityId(context, executedContext, definition);

            // Recupera il request ID tecnico per correlazione tra log e chiamata HTTP.
            var requestId = ResolveRequestId(context.HttpContext);

            // Recupera il ruolo dell'utente corrente, utile a contestualizzare l'azione.
            var role = ResolveRole(context.HttpContext.User);

            // Costruisce il payload di metadati dell'audit.
            // Questo oggetto contiene informazioni tecniche e di dominio utili
            // per ricostruire il contesto della richiesta in fase di analisi successiva.
            var metadata = new
            {
                outcome,
                statusCode,
                role,
                method = context.HttpContext.Request.Method,
                path = context.HttpContext.Request.Path.Value,
                queryString = context.HttpContext.Request.QueryString.HasValue
                    ? context.HttpContext.Request.QueryString.Value
                    : null,
                controller = context.ActionDescriptor.RouteValues.TryGetValue("controller", out var controllerName)
                    ? controllerName
                    : null,
                action = context.ActionDescriptor.RouteValues.TryGetValue("action", out var actionName)
                    ? actionName
                    : null,
                routeValues = context.RouteData.Values.ToDictionary(
                    pair => pair.Key,
                    pair => pair.Value?.ToString()),
                targetPatientUserId = ResolveNamedGuid(context, "patientUserId"),
                appointmentId = ResolveNamedGuid(context, "appointmentId"),
                encounterId = ResolveNamedGuid(context, "encounterId"),
                orderId = ResolveNamedGuid(context, "orderId"),
                intentId = ResolveNamedGuid(context, "intentId"),
                slotId = ResolveNamedGuid(context, "slotId"),
                clinicianUserId = ResolveNamedGuid(context, "clinicianUserId")
            };

            // Serializza i metadati in JSON per conservarli come parte del record di audit.
            var metadataJson = JsonSerializer.Serialize(metadata, MetadataJsonOptions);

            // Delega al servizio di audit la scrittura best effort del record.
            // La scrittura viene fatta dopo l'esecuzione dell'action per registrare
            // anche l'esito effettivo dell'operazione.
            await _auditService
                .WriteBestEffortAsync(
                    new WriteAuditLogRequest(
                        actorUserId.Value,
                        definition.Action,
                        definition.EntityType,
                        entityId,
                        requestId,
                        metadataJson),
                    context.HttpContext.RequestAborted)
                .ConfigureAwait(false);
        }

        /*
         * Mappa la coppia controller/action corrente a una definizione di audit,
         * se la richiesta appartiene a un'operazione soggetta a tracciamento.
         */
        private static AuditDefinition? ResolveDefinition(ActionExecutingContext context)
        {
            // Ricava il nome del controller dalla route MVC corrente.
            var controller = context.ActionDescriptor.RouteValues.TryGetValue("controller", out var controllerValue)
                ? controllerValue
                : null;

            // Ricava il nome dell'action dalla route MVC corrente.
            var action = context.ActionDescriptor.RouteValues.TryGetValue("action", out var actionValue)
                ? actionValue
                : null;

            // Mappa coppie controller/action a definizioni di audit esplicite.
            // Ogni definizione specifica:
            // - azione logica di audit;
            // - tipo di entità coinvolta;
            // - nome del route value / argument da cui ricavare l'entità;
            // - eventuale fallback semantico.
            return (controller, action) switch
            {
                ("AdminScheduling", "CreateSlotsForClinician") => new AuditDefinition("ADMIN_CREATE_SLOTS", "AvailabilitySlotBatch", "clinicianUserId", "batch"),
                ("AdminScheduling", "UpdateSlotStatus") => new AuditDefinition("ADMIN_UPDATE_SLOT_STATUS", "AvailabilitySlot", "slotId"),
                ("AdminScheduling", "BookAppointmentForPatient") => new AuditDefinition("ADMIN_BOOK_APPOINTMENT", "Appointment", "slotId"),
                ("AdminScheduling", "CancelAppointment") => new AuditDefinition("ADMIN_CANCEL_APPOINTMENT", "Appointment", "appointmentId"),
                ("AdminScheduling", "RescheduleAppointment") => new AuditDefinition("ADMIN_RESCHEDULE_APPOINTMENT", "Appointment", "appointmentId"),
                ("AdminScheduling", "CheckInAppointment") => new AuditDefinition("ADMIN_CHECKIN_APPOINTMENT", "Appointment", "appointmentId"),

                ("PatientScheduling", "BookAppointment") => new AuditDefinition("PATIENT_BOOK_APPOINTMENT", "Appointment", "slotId"),
                ("PatientScheduling", "CancelAppointment") => new AuditDefinition("PATIENT_CANCEL_APPOINTMENT", "Appointment", "appointmentId"),
                ("PatientScheduling", "RescheduleAppointment") => new AuditDefinition("PATIENT_RESCHEDULE_APPOINTMENT", "Appointment", "appointmentId"),

                ("DelegateScheduling", "BookAppointmentForDelegatedPatient") => new AuditDefinition("DELEGATE_BOOK_APPOINTMENT", "Appointment", "slotId"),
                ("DelegateScheduling", "RescheduleAppointmentForDelegatedPatient") => new AuditDefinition("DELEGATE_RESCHEDULE_APPOINTMENT", "Appointment", "appointmentId"),
                ("DelegateScheduling", "CancelAppointmentForDelegatedPatient") => new AuditDefinition("DELEGATE_CANCEL_APPOINTMENT", "Appointment", "appointmentId"),

                ("PatientPreTriage", "UpsertForAppointment") => new AuditDefinition("PATIENT_UPSERT_PRETRIAGE", "PreTriageQuestionnaire", "appointmentId"),
                ("DelegatePreTriage", "UpsertForAppointment") => new AuditDefinition("DELEGATE_UPSERT_PRETRIAGE", "PreTriageQuestionnaire", "appointmentId"),

                ("ClinicianClinical", "GetEncounterDetails") => new AuditDefinition("CLINICIAN_VIEW_ENCOUNTER", "ClinicalEncounter", "encounterId"),
                ("ClinicianClinical", "StartEncounter") => new AuditDefinition("CLINICIAN_START_ENCOUNTER", "ClinicalEncounter", "appointmentId"),
                ("ClinicianClinical", "AddAnamnesis") => new AuditDefinition("CLINICIAN_ADD_ANAMNESIS", "AnamnesisRecord", "encounterId"),
                ("ClinicianClinical", "RecordVitalSign") => new AuditDefinition("CLINICIAN_RECORD_VITAL_SIGN", "VitalSign", "encounterId"),
                ("ClinicianClinical", "CreateOrder") => new AuditDefinition("CLINICIAN_CREATE_ORDER", "ClinicalOrder", "encounterId"),
                ("ClinicianClinical", "RecordExecution") => new AuditDefinition("CLINICIAN_RECORD_EXECUTION", "ProcedureExecution", "orderId"),
                ("ClinicianClinical", "UpsertReport") => new AuditDefinition("CLINICIAN_UPSERT_REPORT", "ClinicalReport", "encounterId"),
                ("ClinicianClinical", "SignReport") => new AuditDefinition("CLINICIAN_SIGN_REPORT", "ClinicalReport", "encounterId"),
                ("ClinicianClinical", "PublishReport") => new AuditDefinition("CLINICIAN_PUBLISH_REPORT", "ClinicalReport", "encounterId"),
                ("ClinicianClinical", "CompleteEncounter") => new AuditDefinition("CLINICIAN_COMPLETE_ENCOUNTER", "ClinicalEncounter", "encounterId"),

                ("PatientClinical", "GetMyReports") => new AuditDefinition("PATIENT_VIEW_REPORTS", "ClinicalReportCollection", "patientUserId", "self"),
                ("DelegateClinical", "GetReportsForDelegatedPatient") => new AuditDefinition("DELEGATE_VIEW_REPORTS", "ClinicalReportCollection", "patientUserId"),

                ("PatientPayments", "CreatePaymentIntentForAppointment") => new AuditDefinition("PATIENT_CREATE_PAYMENT_INTENT", "PaymentIntent", "appointmentId"),
                ("PatientPayments", "ProcessPayment") => new AuditDefinition("PATIENT_PROCESS_PAYMENT", "PaymentIntent", "intentId"),

                ("DelegatePayments", "CreatePaymentIntentForDelegatedPatientAppointment") => new AuditDefinition("DELEGATE_CREATE_PAYMENT_INTENT", "PaymentIntent", "appointmentId"),
                ("DelegatePayments", "ProcessPaymentForDelegatedPatient") => new AuditDefinition("DELEGATE_PROCESS_PAYMENT", "PaymentIntent", "intentId"),

                ("AdminPayments", "RegisterInPersonPayment") => new AuditDefinition("ADMIN_REGISTER_IN_PERSON_PAYMENT", "PaymentIntent", "appointmentId"),
                ("AdminPayments", "ReconcilePayment") => new AuditDefinition("ADMIN_RECONCILE_PAYMENT", "PaymentIntent", "intentId"),
                ("AdminPayments", "SimulateProviderOutcome") => new AuditDefinition("ADMIN_SIMULATE_PROVIDER_OUTCOME", "PaymentIntent", "intentId"),

                _ => null
            };
        }

        /*
         * Determina lo status code finale della richiesta osservando eccezioni,
         * IActionResult espliciti e risposta HTTP corrente.
         */
        private static int ResolveStatusCode(ActionExecutedContext context)
        {
            // In presenza di un'eccezione non gestita si assume un esito server-side 500.
            if (context.Exception is not null)
            {
                return 500;
            }

            // Se il risultato MVC espone esplicitamente uno status code, viene privilegiato
            // perché rappresenta il valore più aderente alla risposta applicativa.
            if (context.Result is IStatusCodeActionResult statusCodeActionResult && statusCodeActionResult.StatusCode.HasValue)
            {
                return statusCodeActionResult.StatusCode.Value;
            }

            // In alternativa si usa lo status code già presente nella response HTTP.
            if (context.HttpContext.Response.StatusCode > 0)
            {
                return context.HttpContext.Response.StatusCode;
            }

            // Fallback ottimistico per i casi in cui non sia disponibile altra informazione.
            return 200;
        }

        /*
         * Traduce il risultato tecnico della richiesta in un outcome logico
         * di audit, distinguendo tra successo, rifiuto, diniego e fallimento.
         */
        private static string ResolveOutcome(
            int statusCode,
            Exception? exception)
        {
            // Le eccezioni o i codici 5xx vengono interpretati come fallimento dell'operazione.
            if (exception is not null || statusCode >= 500)
            {
                return "Failed";
            }

            // I codici di autorizzazione negata vengono distinti come "Denied"
            // per separare il problema di accesso da altri tipi di errore.
            if (statusCode == 401 || statusCode == 403)
            {
                return "Denied";
            }

            // Gli altri errori client-side 4xx vengono classificati come richieste rigettate.
            if (statusCode >= 400)
            {
                return "Rejected";
            }

            // In assenza di errori si considera l'operazione riuscita.
            return "Succeeded";
        }

        /*
         * Prova a ricavare l'identificativo dell'utente corrente
         * leggendo i claim di autenticazione più rilevanti.
         */
        private static Guid? TryGetCurrentUserId(ClaimsPrincipal user)
        {
            // Cerca prima il claim standard NameIdentifier e, in alternativa, il claim JWT "sub".
            var rawUserId =
                user.FindFirstValue(ClaimTypes.NameIdentifier) ??
                user.FindFirstValue("sub");

            return Guid.TryParse(rawUserId, out var userId) ? userId : null;
        }

        /*
         * Risolve il ruolo dell'utente corrente a partire dai claim
         * standard o personalizzati presenti nel principal.
         */
        private static string? ResolveRole(ClaimsPrincipal user)
        {
            // Risolve il ruolo supportando sia il claim .NET standard sia il claim "role".
            return user.FindFirstValue(ClaimTypes.Role) ?? user.FindFirstValue("role");
        }

        /*
         * Determina il request ID tecnico della richiesta corrente,
         * privilegiando l'header esplicito quando disponibile.
         */
        private static string ResolveRequestId(Microsoft.AspNetCore.Http.HttpContext httpContext)
        {
            // Se il client o un middleware a monte ha già valorizzato l'header X-Request-ID,
            // questo viene privilegiato come identificatore tecnico della richiesta.
            var headerValue = httpContext.Request.Headers["X-Request-ID"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(headerValue))
            {
                return headerValue.Trim();
            }

            // In mancanza di un request ID esplicito, si usa il TraceIdentifier ASP.NET Core.
            return httpContext.TraceIdentifier;
        }

        /*
         * Determina l'identificativo dell'entità principale oggetto dell'audit,
         * usando risultato dell'action, parametri e fallback semantici.
         */
        private static string ResolveEntityId(
            ActionExecutingContext executingContext,
            ActionExecutedContext executedContext,
            AuditDefinition definition)
        {
            // Prima prova a ricavare un identificativo dall'oggetto restituito dall'action.
            // Questo è utile nei casi di creazione in cui l'ID effettivo nasce durante l'esecuzione.
            if (TryGetIdFromResult(executedContext.Result, out var resultId))
            {
                return resultId;
            }

            // Gestisce eventuali fallback semantici dichiarati nella definizione di audit.
            if (definition.FallbackLiteral is not null)
            {
                // Caso "self": l'entità paziente coincide con l'utente autenticato corrente.
                if (string.Equals(definition.RouteOrArgumentName, "patientUserId", StringComparison.OrdinalIgnoreCase) &&
                    definition.FallbackLiteral == "self")
                {
                    var selfId = TryGetCurrentUserId(executingContext.HttpContext.User);
                    if (selfId.HasValue)
                    {
                        return $"patient:{selfId.Value}";
                    }
                }

                // Caso "batch": l'operazione rappresenta un batch radicato su un identificativo noto.
                if (string.Equals(definition.FallbackLiteral, "batch", StringComparison.OrdinalIgnoreCase))
                {
                    var batchRoot = ResolveNamedGuid(executingContext, definition.RouteOrArgumentName);
                    if (batchRoot.HasValue)
                    {
                        return $"batch:{batchRoot.Value}";
                    }
                }
            }

            // Se il risultato non fornisce l'ID, prova a ricavarlo da route, query, argomenti o oggetti nested.
            var namedId = ResolveNamedGuid(executingContext, definition.RouteOrArgumentName);
            if (namedId.HasValue)
            {
                // Per patientUserId viene aggiunto un prefisso semantico
                // per rendere esplicita la natura dell'identificativo nel log.
                if (string.Equals(definition.RouteOrArgumentName, "patientUserId", StringComparison.OrdinalIgnoreCase))
                {
                    return $"patient:{namedId.Value}";
                }

                return namedId.Value.ToString();
            }

            // Fallback finale quando l'entità non è determinabile in modo affidabile.
            return "n/a";
        }

        /*
         * Cerca un identificativo Guid associato a un nome logico
         * esplorando route values, query string, argomenti diretti e oggetti nested.
         */
        private static Guid? ResolveNamedGuid(
            ActionExecutingContext context,
            string name)
        {
            // Se il nome richiesto è assente o vuoto, non è possibile effettuare la risoluzione.
            if (string.IsNullOrWhiteSpace(name))
            {
                return null;
            }

            // Priorità 1: route values, tipici degli endpoint RESTful.
            if (context.RouteData.Values.TryGetValue(name, out var routeValue) &&
                TryParseGuid(routeValue, out var routeGuid))
            {
                return routeGuid;
            }

            // Priorità 2: query string, utile per endpoint che passano identificativi via query.
            if (context.HttpContext.Request.Query.TryGetValue(name, out var queryValue) &&
                Guid.TryParse(queryValue.FirstOrDefault(), out var queryGuid))
            {
                return queryGuid;
            }

            // Priorità 3: action arguments diretti, nel caso in cui il parametro sia già materializzato.
            if (context.ActionArguments.TryGetValue(name, out var directArgument) &&
                TryParseGuid(directArgument, out var directGuid))
            {
                return directGuid;
            }

            // Priorità 4: ricerca nested negli oggetti passati come argomento all'action,
            // utile per request DTO che contengono proprietà Id interne.
            foreach (var argument in context.ActionArguments.Values)
            {
                if (TryResolveGuidFromObject(argument, name, out var nestedGuid))
                {
                    return nestedGuid;
                }
            }

            return null;
        }

        /*
         * Prova a estrarre un identificativo dall'IActionResult restituito,
         * supportando sia oggetti singoli sia collezioni.
         */
        private static bool TryGetIdFromResult(
            IActionResult? result,
            out string id)
        {
            id = string.Empty;

            // Estrae il payload concreto da result MVC che incapsulano dati serializzabili.
            object? value = result switch
            {
                ObjectResult objectResult => objectResult.Value,
                JsonResult jsonResult => jsonResult.Value,
                _ => null
            };

            if (value is null)
            {
                return false;
            }

            // Caso più comune: il risultato espone direttamente una proprietà Id.
            if (TryResolveGuidFromObject(value, "Id", out var guidId))
            {
                id = guidId.ToString();
                return true;
            }

            // Se il risultato è una collezione, prova a ricavare l'Id dal primo elemento utile.
            if (value is IEnumerable enumerable && value is not string)
            {
                foreach (var item in enumerable)
                {
                    if (item is null)
                    {
                        continue;
                    }

                    if (TryResolveGuidFromObject(item, "Id", out guidId))
                    {
                        id = guidId.ToString();
                        return true;
                    }
                }
            }

            return false;
        }

        /*
         * Prova a leggere una proprietà Guid da un oggetto, direttamente
         * o tramite reflection, usando il nome proprietà richiesto.
         */
        private static bool TryResolveGuidFromObject(
            object? value,
            string propertyName,
            out Guid guid)
        {
            guid = Guid.Empty;

            if (value is null)
            {
                return false;
            }

            // Se l'oggetto è già un Guid, il metodo restituisce subito il valore.
            if (value is Guid directGuid)
            {
                guid = directGuid;
                return guid != Guid.Empty;
            }

            // Usa reflection per cercare una proprietà pubblica con il nome richiesto,
            // ignorando le differenze di maiuscole/minuscole.
            var property = value
                .GetType()
                .GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);

            if (property is null)
            {
                return false;
            }

            // Estrae il valore della proprietà e lo delega al parser comune.
            var propertyValue = property.GetValue(value);
            return TryParseGuid(propertyValue, out guid);
        }

        /*
         * Converte un valore eterogeneo in Guid, supportando sia Guid
         * già tipizzati sia stringhe parseabili.
         */
        private static bool TryParseGuid(
            object? value,
            out Guid guid)
        {
            // Parser comune che supporta sia Guid già tipizzati
            // sia stringhe convertibili a Guid.
            switch (value)
            {
                case Guid parsedGuid when parsedGuid != Guid.Empty:
                    guid = parsedGuid;
                    return true;

                case string raw when Guid.TryParse(raw, out var guidFromString) && guidFromString != Guid.Empty:
                    guid = guidFromString;
                    return true;

                default:
                    guid = Guid.Empty;
                    return false;
            }
        }

        // Record interno che descrive la policy di audit associata a una action:
        // azione logica, tipo di entità, nome del parametro/argomento da cui ricavarla
        // ed eventuale fallback semantico.
        private sealed record AuditDefinition(
            string Action,
            string EntityType,
            string RouteOrArgumentName,
            string? FallbackLiteral = null);
    }
}
