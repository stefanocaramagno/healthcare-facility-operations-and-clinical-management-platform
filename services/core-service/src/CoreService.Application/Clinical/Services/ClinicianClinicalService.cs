/*
 * File: services/core-service/src/CoreService.Application/Clinical/Services/ClinicianClinicalService.cs
 *
 * Scopo
 * -----
 * Implementare i casi d'uso applicativi del dominio Clinical
 * relativi alla gestione del percorso clinico da parte del clinico autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Application del dominio Clinical
 * e coordina i workflow che consentono al clinico di:
 * - consultare i propri encounter;
 * - visualizzare il dettaglio completo di un encounter;
 * - avviare un encounter a partire da una prenotazione valida;
 * - registrare anamnesi, parametri vitali, ordini clinici ed esecuzioni;
 * - gestire il referto clinico;
 * - completare l'encounter e chiudere la prenotazione associata.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare input, stato delle entità e autorizzazioni del clinico corrente.
 * - Coordinare i repository clinici, di scheduling e dei consensi.
 * - Applicare le regole di business del workflow clinico.
 * - Restituire esiti uniformi tramite OperationResult.
 *
 * Interazioni principali
 * ----------------------
 * - IClinicalPathwayRepository
 * - ISchedulingRepository
 * - IConsentRepository
 * - Entità dei domini Clinical, Scheduling e Registry
 * - DTO del layer Application
 *
 * Note
 * ----
 * Il servizio contiene logica applicativa di orchestrazione
 * ma non dettagli infrastrutturali di persistenza,
 * che rimangono delegati ai repository dedicati.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Common;
using CoreService.Application.Clinical.Repositories;
using CoreService.Application.Registry.Repositories;
using CoreService.Application.Scheduling.Repositories;
using CoreService.Domain.Clinical;
using CoreService.Domain.Registry;
using CoreService.Domain.Scheduling;

namespace CoreService.Application.Clinical.Services
{
    public sealed class ClinicianClinicalService
    {
        // Repository principali necessari per il recupero e la modifica
        // del percorso clinico, dello stato delle prenotazioni e dei consensi.
        private readonly IClinicalPathwayRepository _clinicalRepository;
        private readonly ISchedulingRepository _schedulingRepository;
        private readonly IConsentRepository _consentRepository;

        /*
         * Inizializza il servizio con tutte le dipendenze necessarie
         * ai workflow clinici del medico.
         */
        public ClinicianClinicalService(
            IClinicalPathwayRepository clinicalRepository,
            ISchedulingRepository schedulingRepository,
            IConsentRepository consentRepository)
        {
            _clinicalRepository = clinicalRepository
                ?? throw new ArgumentNullException(nameof(clinicalRepository));
            _schedulingRepository = schedulingRepository
                ?? throw new ArgumentNullException(nameof(schedulingRepository));
            _consentRepository = consentRepository
                ?? throw new ArgumentNullException(nameof(consentRepository));
        }

        /*
         * Recupera l'elenco degli encounter del clinico corrente
         * nel range temporale richiesto.
         */
        public async Task<OperationResult<IReadOnlyList<ClinicalEncounterSummaryDto>>> GetClinicianEncountersAsync(
            Guid clinicianUserId,
            DateTime? fromUtc,
            DateTime? toUtc,
            CancellationToken cancellationToken)
        {
            // Normalizza il range temporale di ricerca applicando
            // i default previsti dal workflow clinico.
            var (effectiveFromUtc, effectiveToUtc) = NormalizeDateRange(fromUtc, toUtc);

            // Recupera tutti gli encounter del clinico nel periodo richiesto.
            var encounters = await _clinicalRepository
                .GetEncountersForClinicianAsync(
                    clinicianUserId,
                    effectiveFromUtc,
                    effectiveToUtc,
                    cancellationToken)
                .ConfigureAwait(false);

            // Mappa le entità cliniche nei rispettivi DTO di riepilogo.
            var result = encounters
                .Select(MapEncounterToSummaryDto)
                .ToList()
                .AsReadOnly();

            return OperationResult<IReadOnlyList<ClinicalEncounterSummaryDto>>.Success(result);
        }

        /*
         * Recupera il dettaglio completo di un encounter,
         * verificando che il clinico corrente sia autorizzato ad accedervi.
         */
        public async Task<OperationResult<ClinicalEncounterDetailDto>> GetEncounterDetailsAsync(
            Guid clinicianUserId,
            Guid encounterId,
            CancellationToken cancellationToken)
        {
            // Recupera l'encounter richiesto.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<ClinicalEncounterDetailDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

            // L'encounter può essere visualizzato solo dal clinico assegnato.
            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<ClinicalEncounterDetailDto>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato ad accedere a questo encounter.");
            }

            // Recupera tutte le componenti cliniche collegate all'encounter.
            var anamneses = await _clinicalRepository
                .GetAnamnesesForEncounterAsync(encounter.Id, cancellationToken)
                .ConfigureAwait(false);

            var vitalSigns = await _clinicalRepository
                .GetVitalSignsForEncounterAsync(encounter.Id, cancellationToken)
                .ConfigureAwait(false);

            var orders = await _clinicalRepository
                .GetOrdersForEncounterAsync(encounter.Id, cancellationToken)
                .ConfigureAwait(false);

            // Aggrega tutte le esecuzioni associate agli ordini dell'encounter.
            var executions = new List<ProcedureExecution>();

            foreach (var order in orders)
            {
                var orderExecutions = await _clinicalRepository
                    .GetExecutionsForOrderAsync(order.Id, cancellationToken)
                    .ConfigureAwait(false);

                executions.AddRange(orderExecutions);
            }

            // Recupera l'eventuale referto associato all'encounter.
            var report = await _clinicalRepository
                .GetReportByEncounterIdAsync(encounter.Id, cancellationToken)
                .ConfigureAwait(false);

            var dto = new ClinicalEncounterDetailDto(
                MapEncounterToSummaryDto(encounter),
                anamneses.Select(MapAnamnesisToDto).ToList(),
                vitalSigns.Select(MapVitalSignToDto).ToList(),
                orders.Select(MapOrderToDto).ToList(),
                executions.Select(MapExecutionToDto).ToList(),
                report is null ? null : MapReportToDto(report));

            return OperationResult<ClinicalEncounterDetailDto>.Success(dto);
        }

        /*
         * Avvia un nuovo encounter clinico a partire da una prenotazione valida
         * e correttamente presa in carico dal clinico corrente.
         */
        public async Task<OperationResult<ClinicalEncounterSummaryDto>> StartEncounterAsync(
            Guid clinicianUserId,
            CreateEncounterRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null)
            {
                return OperationResult<ClinicalEncounterSummaryDto>.BadRequest(
                    "invalid_request",
                    "Il corpo della richiesta non può essere nullo.");
            }

            if (request.AppointmentId == Guid.Empty)
            {
                return OperationResult<ClinicalEncounterSummaryDto>.BadRequest(
                    "invalid_appointment_id",
                    "È necessario specificare un identificativo di prenotazione valido.");
            }

            // Recupera la prenotazione da cui avviare l'encounter.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(request.AppointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment is null)
            {
                return OperationResult<ClinicalEncounterSummaryDto>.NotFound(
                    "appointment_not_found",
                    "La prenotazione indicata non esiste.");
            }

            // La prenotazione deve appartenere al clinico corrente.
            if (appointment.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<ClinicalEncounterSummaryDto>.Forbidden(
                    "appointment_forbidden",
                    "Il clinico corrente non è autorizzato a gestire questa prenotazione.");
            }

            // L'encounter può essere aperto solo dopo il check-in amministrativo.
            if (appointment.Status != AppointmentStatus.CheckedIn)
            {
                return OperationResult<ClinicalEncounterSummaryDto>.BadRequest(
                    "appointment_not_checked_in",
                    "È possibile aprire un encounter solo per prenotazioni in stato di check-in completato.");
            }

            // Verifica la presenza dei consensi obbligatori del paziente.
            var hasRequiredConsents = await HasMandatoryTreatmentAndDataProcessingConsentsAsync(
                appointment.PatientUserId,
                cancellationToken);

            if (!hasRequiredConsents)
            {
                return OperationResult<ClinicalEncounterSummaryDto>.Forbidden(
                    "missing_required_consents",
                    "Non è possibile avviare l'encounter clinico: il paziente non ha fornito i consensi obbligatori al trattamento sanitario e al trattamento dei dati personali.");
            }

            // Impedisce la creazione duplicata di encounter per la stessa prenotazione.
            var existingEncounter = await _clinicalRepository
                .GetEncounterForAppointmentAsync(appointment.Id, cancellationToken)
                .ConfigureAwait(false);

            if (existingEncounter is not null)
            {
                return OperationResult<ClinicalEncounterSummaryDto>.Conflict(
                    "encounter_already_exists",
                    "Per questa prenotazione è già presente un encounter clinico.");
            }

            var nowUtc = DateTime.UtcNow;

            var encounter = new ClinicalEncounter
            {
                Id = Guid.NewGuid(),
                AppointmentId = appointment.Id,
                PatientUserId = appointment.PatientUserId,
                ClinicianUserId = appointment.ClinicianUserId,
                StartedAtUtc = nowUtc,
                EndedAtUtc = null,
                Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
                CreatedAtUtc = nowUtc
            };

            await _clinicalRepository
                .AddEncounterAsync(encounter, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapEncounterToSummaryDto(encounter);
            return OperationResult<ClinicalEncounterSummaryDto>.Success(dto);
        }

        /*
         * Aggiunge una nuova anamnesi a un encounter aperto
         * gestito dal clinico corrente.
         */
        public async Task<OperationResult<AnamnesisRecordDto>> AddAnamnesisAsync(
            Guid clinicianUserId,
            Guid encounterId,
            CreateAnamnesisRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null || string.IsNullOrWhiteSpace(request.Content))
            {
                return OperationResult<AnamnesisRecordDto>.BadRequest(
                    "invalid_anamnesis",
                    "Il contenuto dell'anamnesi non può essere vuoto.");
            }

            // Recupera e valida l'encounter oggetto della modifica.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<AnamnesisRecordDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<AnamnesisRecordDto>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato a modificare questo encounter.");
            }

            if (encounter.EndedAtUtc.HasValue)
            {
                return OperationResult<AnamnesisRecordDto>.BadRequest(
                    "encounter_completed",
                    "Non è possibile modificare un encounter già concluso.");
            }

            var nowUtc = DateTime.UtcNow;

            var anamnesis = new AnamnesisRecord
            {
                Id = Guid.NewGuid(),
                EncounterId = encounter.Id,
                Content = request.Content.Trim(),
                CreatedAtUtc = nowUtc,
                CreatedByUserId = clinicianUserId
            };

            await _clinicalRepository
                .AddAnamnesisAsync(anamnesis, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapAnamnesisToDto(anamnesis);
            return OperationResult<AnamnesisRecordDto>.Success(dto);
        }

        /*
         * Registra un nuovo parametro vitale per un encounter aperto
         * gestito dal clinico corrente.
         */
        public async Task<OperationResult<VitalSignDto>> RecordVitalSignAsync(
            Guid clinicianUserId,
            Guid encounterId,
            RecordVitalSignRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null)
            {
                return OperationResult<VitalSignDto>.BadRequest(
                    "invalid_request",
                    "Il corpo della richiesta non può essere nullo.");
            }

            if (string.IsNullOrWhiteSpace(request.Type))
            {
                return OperationResult<VitalSignDto>.BadRequest(
                    "invalid_vital_sign_type",
                    "È necessario specificare il tipo di parametro vitale.");
            }

            if (request.Value <= 0)
            {
                return OperationResult<VitalSignDto>.BadRequest(
                    "invalid_vital_sign_value",
                    "Il valore del parametro vitale deve essere positivo.");
            }

            // Converte il tipo testuale nel corrispondente enum di dominio.
            if (!Enum.TryParse<VitalSignType>(request.Type, ignoreCase: true, out var vitalSignType))
            {
                return OperationResult<VitalSignDto>.BadRequest(
                    "unknown_vital_sign_type",
                    "Il tipo di parametro vitale specificato non è valido.");
            }

            // Recupera e valida l'encounter su cui registrare il parametro vitale.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<VitalSignDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<VitalSignDto>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato a modificare questo encounter.");
            }

            if (encounter.EndedAtUtc.HasValue)
            {
                return OperationResult<VitalSignDto>.BadRequest(
                    "encounter_completed",
                    "Non è possibile modificare un encounter già concluso.");
            }

            // Normalizza l'istante di misurazione, utilizzando l'orario corrente in assenza di input.
            if (!UtcDateTimeInput.TryNormalizeOptional(request.MeasuredAtUtc, "measuredAtUtc", out var normalizedMeasuredAtUtc, out var measuredAtError))
            {
                return OperationResult<VitalSignDto>.BadRequest(
                    "invalid_datetime",
                    measuredAtError!);
            }

            var measuredAtUtc = normalizedMeasuredAtUtc ?? DateTime.UtcNow;

            var vitalSign = new VitalSign
            {
                Id = Guid.NewGuid(),
                EncounterId = encounter.Id,
                Type = vitalSignType,
                Value = request.Value,
                Unit = string.IsNullOrWhiteSpace(request.Unit) ? string.Empty : request.Unit.Trim(),
                MeasuredAtUtc = measuredAtUtc,
                MeasuredByUserId = clinicianUserId
            };

            await _clinicalRepository
                .AddVitalSignAsync(vitalSign, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapVitalSignToDto(vitalSign);
            return OperationResult<VitalSignDto>.Success(dto);
        }

        /*
         * Crea un nuovo ordine clinico associato a un encounter aperto
         * gestito dal clinico corrente.
         */
        public async Task<OperationResult<ClinicalOrderDto>> CreateOrderAsync(
            Guid clinicianUserId,
            Guid encounterId,
            CreateClinicalOrderRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null)
            {
                return OperationResult<ClinicalOrderDto>.BadRequest(
                    "invalid_request",
                    "Il corpo della richiesta non può essere nullo.");
            }

            if (request.CatalogItemId == Guid.Empty)
            {
                return OperationResult<ClinicalOrderDto>.BadRequest(
                    "invalid_catalog_item_id",
                    "È necessario specificare un identificativo di prestazione valido.");
            }

            // Recupera e valida l'encounter destinatario dell'ordine clinico.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<ClinicalOrderDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<ClinicalOrderDto>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato a modificare questo encounter.");
            }

            if (encounter.EndedAtUtc.HasValue)
            {
                return OperationResult<ClinicalOrderDto>.BadRequest(
                    "encounter_completed",
                    "Non è possibile modificare un encounter già concluso.");
            }

            var nowUtc = DateTime.UtcNow;

            var order = new ClinicalOrder
            {
                Id = Guid.NewGuid(),
                EncounterId = encounter.Id,
                CatalogItemId = request.CatalogItemId,
                Status = OrderStatus.Created,
                Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
                CreatedAtUtc = nowUtc
            };

            await _clinicalRepository
                .AddOrderAsync(order, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapOrderToDto(order);
            return OperationResult<ClinicalOrderDto>.Success(dto);
        }

        /*
         * Registra l'esecuzione di una procedura clinica associata a un ordine
         * e marca l'ordine come completato.
         */
        public async Task<OperationResult<ProcedureExecutionDto>> RecordExecutionAsync(
            Guid clinicianUserId,
            Guid orderId,
            RecordProcedureExecutionRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null)
            {
                return OperationResult<ProcedureExecutionDto>.BadRequest(
                    "invalid_request",
                    "Il corpo della richiesta non può essere nullo.");
            }

            if (string.IsNullOrWhiteSpace(request.Outcome))
            {
                return OperationResult<ProcedureExecutionDto>.BadRequest(
                    "invalid_execution_outcome",
                    "È necessario specificare l'esito della procedura.");
            }

            // Recupera l'ordine clinico oggetto dell'esecuzione.
            var order = await _clinicalRepository
                .GetOrderByIdAsync(orderId, cancellationToken)
                .ConfigureAwait(false);

            if (order is null)
            {
                return OperationResult<ProcedureExecutionDto>.NotFound(
                    "order_not_found",
                    "L'ordine clinico specificato non esiste.");
            }

            // Recupera l'encounter associato all'ordine per validare autorizzazione e stato.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(order.EncounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<ProcedureExecutionDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter associato all'ordine non esiste.");
            }

            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<ProcedureExecutionDto>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato a modificare questo encounter.");
            }

            if (encounter.EndedAtUtc.HasValue)
            {
                return OperationResult<ProcedureExecutionDto>.BadRequest(
                    "encounter_completed",
                    "Non è possibile modificare un encounter già concluso.");
            }

            // Normalizza la data di esecuzione, utilizzando l'orario corrente in assenza di input.
            if (!UtcDateTimeInput.TryNormalizeOptional(request.PerformedAtUtc, "performedAtUtc", out var normalizedPerformedAtUtc, out var performedAtError))
            {
                return OperationResult<ProcedureExecutionDto>.BadRequest(
                    "invalid_datetime",
                    performedAtError!);
            }

            var performedAtUtc = normalizedPerformedAtUtc ?? DateTime.UtcNow;

            var execution = new ProcedureExecution
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                PerformedAtUtc = performedAtUtc,
                PerformedByUserId = clinicianUserId,
                Outcome = request.Outcome.Trim(),
                Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim()
            };

            await _clinicalRepository
                .AddExecutionAsync(execution, cancellationToken)
                .ConfigureAwait(false);

            // Dopo la registrazione dell'esecuzione l'ordine viene marcato come completato.
            order.Status = OrderStatus.Completed;

            await _clinicalRepository
                .UpdateOrderAsync(order, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapExecutionToDto(execution);
            return OperationResult<ProcedureExecutionDto>.Success(dto);
        }

        /*
         * Crea o aggiorna il referto clinico di un encounter,
         * purché il referto sia assente oppure ancora in bozza.
         */
        public async Task<OperationResult<ClinicalReportDto>> UpsertReportAsync(
            Guid clinicianUserId,
            Guid encounterId,
            UpsertClinicalReportRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null || string.IsNullOrWhiteSpace(request.Content))
            {
                return OperationResult<ClinicalReportDto>.BadRequest(
                    "invalid_report_content",
                    "Il contenuto del referto non può essere vuoto.");
            }

            // Recupera e valida l'encounter destinatario del referto.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<ClinicalReportDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<ClinicalReportDto>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato a modificare questo encounter.");
            }

            // Recupera l'eventuale referto già associato all'encounter.
            var report = await _clinicalRepository
                .GetReportByEncounterIdAsync(encounter.Id, cancellationToken)
                .ConfigureAwait(false);

            var nowUtc = DateTime.UtcNow;

            if (report is null)
            {
                // Se non esiste alcun referto, crea una nuova bozza.
                report = new ClinicalReport
                {
                    Id = Guid.NewGuid(),
                    EncounterId = encounter.Id,
                    Status = ClinicalReportStatus.Draft,
                    Content = request.Content.Trim(),
                    CreatedAtUtc = nowUtc,
                    SignedAtUtc = null,
                    SignedByUserId = null,
                    PublishedAtUtc = null
                };
            }
            else
            {
                // I referti già firmati o pubblicati non sono più modificabili.
                if (report.Status != ClinicalReportStatus.Draft)
                {
                    return OperationResult<ClinicalReportDto>.Conflict(
                        "report_not_editable",
                        "È possibile modificare solo i referti in stato di bozza.");
                }

                report.Content = request.Content.Trim();
            }

            await _clinicalRepository
                .AddOrUpdateReportAsync(report, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapReportToDto(report);
            return OperationResult<ClinicalReportDto>.Success(dto);
        }

        /*
         * Pubblica il referto clinico di un encounter,
         * firmandolo implicitamente se necessario.
         */
        public async Task<OperationResult<ClinicalReportDto>> PublishReportAsync(
            Guid clinicianUserId,
            Guid encounterId,
            PublishClinicalReportRequest? request,
            CancellationToken cancellationToken)
        {
            if (request is null || !request.Publish)
            {
                return OperationResult<ClinicalReportDto>.BadRequest(
                    "invalid_publish_request",
                    "Per pubblicare il referto è necessario confermare esplicitamente l'operazione.");
            }

            // Recupera e valida l'encounter a cui appartiene il referto.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<ClinicalReportDto>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

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

            if (report.Status == ClinicalReportStatus.Published)
            {
                return OperationResult<ClinicalReportDto>.Conflict(
                    "report_already_published",
                    "Il referto è già stato pubblicato.");
            }

            var nowUtc = DateTime.UtcNow;

            // Porta il referto nello stato Published e valorizza firma e pubblicazione.
            report.Status = ClinicalReportStatus.Published;
            report.SignedAtUtc ??= nowUtc;
            report.SignedByUserId ??= clinicianUserId;
            report.PublishedAtUtc = nowUtc;

            await _clinicalRepository
                .AddOrUpdateReportAsync(report, cancellationToken)
                .ConfigureAwait(false);

            var dto = MapReportToDto(report);
            return OperationResult<ClinicalReportDto>.Success(dto);
        }

        /*
         * Completa un encounter aperto
         * e chiude contestualmente la prenotazione associata.
         */
        public async Task<OperationResult<bool>> CompleteEncounterAsync(
            Guid clinicianUserId,
            Guid encounterId,
            CancellationToken cancellationToken)
        {
            // Recupera e valida l'encounter da completare.
            var encounter = await _clinicalRepository
                .GetEncounterByIdAsync(encounterId, cancellationToken)
                .ConfigureAwait(false);

            if (encounter is null)
            {
                return OperationResult<bool>.NotFound(
                    "encounter_not_found",
                    "L'encounter specificato non esiste.");
            }

            if (encounter.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<bool>.Forbidden(
                    "encounter_forbidden",
                    "Il clinico corrente non è autorizzato a modificare questo encounter.");
            }

            if (encounter.EndedAtUtc.HasValue)
            {
                return OperationResult<bool>.BadRequest(
                    "encounter_already_completed",
                    "L'encounter risulta già concluso.");
            }

            // Recupera e valida la prenotazione associata all'encounter.
            var appointment = await _schedulingRepository
                .GetAppointmentByIdAsync(encounter.AppointmentId, cancellationToken)
                .ConfigureAwait(false);

            if (appointment is null)
            {
                return OperationResult<bool>.NotFound(
                    "appointment_not_found",
                    "La prenotazione associata all'encounter non esiste.");
            }

            if (appointment.ClinicianUserId != clinicianUserId)
            {
                return OperationResult<bool>.Forbidden(
                    "appointment_forbidden",
                    "Il clinico corrente non è autorizzato a completare la prenotazione associata a questo encounter.");
            }

            // La prenotazione deve trovarsi in stato CheckedIn per poter essere completata.
            if (appointment.Status != AppointmentStatus.CheckedIn)
            {
                return OperationResult<bool>.Conflict(
                    "invalid_appointment_status_for_completion",
                    "È possibile completare l'appuntamento solo se si trova in stato 'CheckedIn'.");
            }

            var nowUtc = DateTime.UtcNow;

            // Chiude l'encounter impostando l'orario di fine.
            encounter.EndedAtUtc = nowUtc;

            await _clinicalRepository
                .UpdateEncounterAsync(encounter, cancellationToken)
                .ConfigureAwait(false);

            // Aggiorna la prenotazione nello stato finale Completed.
            appointment.Status = AppointmentStatus.Completed;
            appointment.UpdatedAtUtc = nowUtc;

            await _schedulingRepository
                .UpdateAppointmentAsync(appointment, cancellationToken)
                .ConfigureAwait(false);

            // Registra la transizione di stato della prenotazione.
            var statusChange = new AppointmentStatusChange
            {
                Id = Guid.NewGuid(),
                AppointmentId = appointment.Id,
                FromStatus = AppointmentStatus.CheckedIn,
                ToStatus = AppointmentStatus.Completed,
                ChangedByUserId = clinicianUserId,
                ChangedAtUtc = nowUtc,
                Reason = "ENCOUNTER_COMPLETED"
            };

            await _schedulingRepository
                .AddStatusChangeAsync(statusChange, cancellationToken)
                .ConfigureAwait(false);

            return OperationResult<bool>.Success(true);
        }

        /*
         * Verifica che il paziente abbia fornito entrambi i consensi obbligatori:
         * trattamento sanitario e trattamento dei dati personali.
         */
        private async Task<bool> HasMandatoryTreatmentAndDataProcessingConsentsAsync(
            Guid patientUserId,
            CancellationToken cancellationToken)
        {
            var treatmentConsent = await _consentRepository
                .GetByPatientAndTypeAsync(patientUserId, ConsentType.Treatment, cancellationToken)
                .ConfigureAwait(false);

            var dataProcessingConsent = await _consentRepository
                .GetByPatientAndTypeAsync(patientUserId, ConsentType.DataProcessing, cancellationToken)
                .ConfigureAwait(false);

            return IsConsentGranted(treatmentConsent) && IsConsentGranted(dataProcessingConsent);
        }

        /*
         * Determina se un consenso può essere considerato effettivamente concesso
         * e non successivamente revocato.
         */
        private static bool IsConsentGranted(Consent? consent)
        {
            return consent != null && consent.Granted && !consent.RevokedAtUtc.HasValue;
        }

        /*
         * Normalizza l'intervallo temporale di ricerca degli encounter,
         * applicando valori di default e correggendo automaticamente eventuali estremi invertiti.
         */
        private static (DateTime FromUtc, DateTime ToUtc) NormalizeDateRange(
            DateTime? fromUtc,
            DateTime? toUtc)
        {
            var nowUtc = DateTime.UtcNow;

            var effectiveFromUtc = fromUtc ?? nowUtc.AddDays(-30);
            var effectiveToUtc = toUtc ?? nowUtc;

            if (effectiveFromUtc > effectiveToUtc)
            {
                (effectiveFromUtc, effectiveToUtc) = (effectiveToUtc, effectiveFromUtc);
            }

            return (effectiveFromUtc, effectiveToUtc);
        }

        /*
         * Converte un'entità ClinicalEncounter del dominio
         * nel corrispondente DTO di riepilogo.
         */
        private static ClinicalEncounterSummaryDto MapEncounterToSummaryDto(ClinicalEncounter encounter)
        {
            return new ClinicalEncounterSummaryDto(
                encounter.Id,
                encounter.AppointmentId,
                encounter.PatientUserId,
                encounter.ClinicianUserId,
                encounter.StartedAtUtc,
                encounter.EndedAtUtc,
                encounter.Notes
            );
        }

        /*
         * Converte un'entità AnamnesisRecord del dominio
         * nel corrispondente DTO applicativo.
         */
        private static AnamnesisRecordDto MapAnamnesisToDto(AnamnesisRecord anamnesis)
        {
            return new AnamnesisRecordDto(
                anamnesis.Id,
                anamnesis.EncounterId,
                anamnesis.Content,
                anamnesis.CreatedAtUtc,
                anamnesis.CreatedByUserId
            );
        }

        /*
         * Converte un'entità VitalSign del dominio
         * nel corrispondente DTO applicativo.
         */
        private static VitalSignDto MapVitalSignToDto(VitalSign vitalSign)
        {
            return new VitalSignDto(
                vitalSign.Id,
                vitalSign.EncounterId,
                vitalSign.Type.ToString(),
                vitalSign.Value,
                vitalSign.Unit,
                vitalSign.MeasuredAtUtc,
                vitalSign.MeasuredByUserId
            );
        }

        /*
         * Converte un'entità ClinicalOrder del dominio
         * nel corrispondente DTO applicativo.
         */
        private static ClinicalOrderDto MapOrderToDto(ClinicalOrder order)
        {
            return new ClinicalOrderDto(
                order.Id,
                order.EncounterId,
                order.CatalogItemId,
                order.Status.ToString(),
                order.Notes,
                order.CreatedAtUtc
            );
        }

        /*
         * Converte un'entità ProcedureExecution del dominio
         * nel corrispondente DTO applicativo.
         */
        private static ProcedureExecutionDto MapExecutionToDto(ProcedureExecution execution)
        {
            return new ProcedureExecutionDto(
                execution.Id,
                execution.OrderId,
                execution.PerformedAtUtc,
                execution.PerformedByUserId,
                execution.Outcome,
                execution.Notes
            );
        }

        /*
         * Converte un'entità ClinicalReport del dominio
         * nel corrispondente DTO applicativo.
         */
        private static ClinicalReportDto MapReportToDto(ClinicalReport report)
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
    }
}
