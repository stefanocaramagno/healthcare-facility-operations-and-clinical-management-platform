/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/DatabaseSeeder.cs
 *
 * Scopo
 * -----
 * Popolare i database applicativi con un insieme minimo e coerente
 * di dati demo/seed, utili per avviare il sistema in un ambiente locale
 * o di sviluppo con un dataset iniziale già funzionante.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure
 * e viene utilizzata durante la fase di bootstrap del sottosistema persistence
 * per inserire dati iniziali nei diversi bounded context:
 * - Registry
 * - Scheduling
 * - Clinical
 * - Payments
 * - Events
 *
 * Responsabilità principali
 * -------------------------
 * - Verificare se il seed è già stato eseguito.
 * - Creare utenti e relativi profili base.
 * - Creare deleghe e consensi minimi necessari ai workflow applicativi.
 * - Popolare il catalogo prestazioni cliniche.
 * - Creare calendario, slot, appuntamenti e relativo storico stati.
 * - Creare dati clinici demo collegati all'appuntamento.
 * - Creare Payment Intent e Payment Transaction dimostrativi.
 * - Creare una notifica e un record di audit iniziali.
 *
 * Note
 * ----
 * Il seeding utilizza identificativi Guid stabili e predefiniti
 * per rendere ripetibile e riconoscibile il dataset demo.
 * La procedura termina immediatamente se rileva che i dati base
 * risultano già presenti nel sistema.
 */

using System.Security.Cryptography;
using CoreService.Domain.Clinical;
using CoreService.Domain.Events;
using CoreService.Domain.Payments;
using CoreService.Domain.Registry;
using CoreService.Domain.Scheduling;
using CoreService.Infrastructure.Persistence.Clinical;
using CoreService.Infrastructure.Persistence.Events;
using CoreService.Infrastructure.Persistence.Payments;
using CoreService.Infrastructure.Persistence.Registry;
using CoreService.Infrastructure.Persistence.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence;

public sealed class DatabaseSeeder
{
    // DbContext del bounded context Registry.
    private readonly RegistryDbContext _registry;

    // DbContext del bounded context Scheduling.
    private readonly SchedulingDbContext _scheduling;

    // DbContext del bounded context Clinical.
    private readonly ClinicalDbContext _clinical;

    // DbContext del bounded context Payments.
    private readonly PaymentsDbContext _payments;

    // DbContext del bounded context Events.
    private readonly EventsDbContext _events;

    /*
     * Inizializza il seeder con tutti i DbContext necessari
     * per popolare i diversi database dell'applicazione.
     */
    public DatabaseSeeder(
        RegistryDbContext registry,
        SchedulingDbContext scheduling,
        ClinicalDbContext clinical,
        PaymentsDbContext payments,
        EventsDbContext events)
    {
        _registry = registry;
        _scheduling = scheduling;
        _clinical = clinical;
        _payments = payments;
        _events = events;
    }

    /*
     * Esegue il seeding dei dati iniziali.
     *
     * La procedura è volutamente idempotente a livello logico:
     * se rileva che il database contiene già utenti o voci di catalogo,
     * assume che il dataset iniziale sia già stato creato
     * e termina senza effettuare ulteriori inserimenti.
     */
    public async Task SeedAsync(CancellationToken ct)
    {
        // Interrompe il seeding se sono già presenti dati base
        // sufficienti a considerare inizializzato l'ambiente.
        if (await _registry.Users.AnyAsync(ct) || await _clinical.ServiceCatalog.AnyAsync(ct))
        {
            return;
        }

        // Identificativi stabili dei principali attori del sistema.
        var adminId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var clinicianId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        var patientId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var delegateId = Guid.Parse("44444444-4444-4444-4444-444444444444");

        // Identificativi stabili per calendario e slot.
        var calendarId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        var slot1Id = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
        var slot2Id = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
        var slot3Id = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");

        // Identificativi stabili per appuntamento e cambio di stato.
        var appointmentId = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
        var statusChangeId = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeef");

        // Identificativi stabili per le prestazioni di catalogo.
        var serviceVisitId = Guid.Parse("99999999-9999-9999-9999-999999999999");
        var serviceBloodId = Guid.Parse("88888888-8888-8888-8888-888888888888");

        // Identificativi stabili per i dati clinici demo.
        var encounterId = Guid.Parse("12121212-1212-1212-1212-121212121212");
        var anamnesisId = Guid.Parse("13131313-1313-1313-1313-131313131313");
        var vitalId = Guid.Parse("14141414-1414-1414-1414-141414141414");
        var orderId = Guid.Parse("15151515-1515-1515-1515-151515151515");
        var executionId = Guid.Parse("16161616-1616-1616-1616-161616161616");
        var reportId = Guid.Parse("17171717-1717-1717-1717-171717171717");

        // Identificativi stabili per i dati di pagamento demo.
        var paymentIntentId = Guid.Parse("18181818-1818-1818-1818-181818181818");
        var paymentTxId = Guid.Parse("19191919-1919-1919-1919-191919191919");

        // Identificativi stabili per eventi e audit.
        var notificationId = Guid.Parse("21212121-2121-2121-2121-212121212121");
        var auditId = Guid.Parse("22222222-3333-4444-5555-666666666666");

        var now = DateTime.UtcNow;

        // -----------------------------
        // Seed del database Registry
        // -----------------------------

        // Utente amministratore demo.
        var admin = new User
        {
            Id = adminId,
            Email = "admin@healthcare.local",
            PasswordHash = HashPassword("Admin123!"),
            Role = UserRole.Admin,
            IsActive = true,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        // Utente clinico demo.
        var clinician = new User
        {
            Id = clinicianId,
            Email = "clinician@healthcare.local",
            PasswordHash = HashPassword("Clinician123!"),
            Role = UserRole.Clinician,
            IsActive = true,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        // Utente paziente demo.
        var patient = new User
        {
            Id = patientId,
            Email = "patient@healthcare.local",
            PasswordHash = HashPassword("Patient123!"),
            Role = UserRole.Patient,
            IsActive = true,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        // Utente delegato demo.
        var delegateUser = new User
        {
            Id = delegateId,
            Email = "delegate@healthcare.local",
            PasswordHash = HashPassword("Delegate123!"),
            Role = UserRole.Delegate,
            IsActive = true,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        _registry.Users.AddRange(admin, clinician, patient, delegateUser);

        // Profilo del paziente demo.
        _registry.PatientProfiles.Add(new PatientProfile
        {
            Id = Guid.Parse("aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa"),
            UserId = patientId,
            FirstName = "Mario",
            LastName = "Rossi",
            DateOfBirthUtc = new DateTime(1995, 5, 10, 0, 0, 0, DateTimeKind.Utc),
            Phone = "+39-000-000-000",
            Address = "Via Esempio 1, Catania",
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        });

        // Profilo del delegato demo.
        _registry.DelegateProfiles.Add(new DelegateProfile
        {
            Id = Guid.Parse("abababab-1111-1111-1111-abababababab"),
            UserId = delegateId,
            FirstName = "Luigi",
            LastName = "Bianchi",
            Phone = "+39-111-222-333",
            Address = "Via Delega 2, Catania",
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        });

        // Profilo del clinico demo.
        _registry.ClinicianProfiles.Add(new ClinicianProfile
        {
            Id = Guid.Parse("bbbbbbbb-1111-1111-1111-bbbbbbbbbbbb"),
            UserId = clinicianId,
            FirstName = "Giulia",
            LastName = "Verdi",
            Phone = "+39-222-333-444",
            Specialty = "Medicina Generale",
            LicenseNumber = "LIC-IT-00001",
            OfficeLocation = "Ambulatorio 1",
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        });

        // Delega attiva del paziente verso il delegato,
        // utile per testare i workflow delegati in sola lettura.
        _registry.Delegations.Add(new Delegation
        {
            Id = Guid.Parse("cccccccc-1111-1111-1111-cccccccccccc"),
            PatientUserId = patientId,
            DelegateUserId = delegateId,
            Scope = DelegationScope.ReadOnly,
            Status = DelegationStatus.Active,
            StartsAtUtc = now.AddDays(-1),
            EndsAtUtc = now.AddMonths(6),
            CreatedAtUtc = now
        });

        // Consensi minimi obbligatori del paziente,
        // necessari per consentire prenotazioni e workflow clinici.
        _registry.Consents.AddRange(
            new Consent
            {
                Id = Guid.Parse("dddddddd-1111-1111-1111-dddddddddddd"),
                PatientUserId = patientId,
                Type = ConsentType.Treatment,
                Granted = true,
                GrantedAtUtc = now.AddDays(-30),
                RevokedAtUtc = null,
                Notes = "Consenso al trattamento sanitario.",
                CreatedAtUtc = now
            },
            new Consent
            {
                Id = Guid.Parse("eeeeeeee-1111-1111-1111-eeeeeeeeeeee"),
                PatientUserId = patientId,
                Type = ConsentType.DataProcessing,
                Granted = true,
                GrantedAtUtc = now.AddDays(-30),
                RevokedAtUtc = null,
                Notes = "Consenso al trattamento dati.",
                CreatedAtUtc = now
            }
        );

        await _registry.SaveChangesAsync(ct);

        // -----------------------------
        // Seed del database Clinical
        // - Catalogo prestazioni
        // -----------------------------

        // Prestazione demo di visita generale.
        var visit = new ServiceCatalogItem
        {
            Id = serviceVisitId,
            Code = "VISIT_GEN",
            Name = "Visita Generale",
            Description = "Visita clinica generale.",
            BasePriceCents = 5000,
            Currency = "EUR",
            IsActive = true,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        // Prestazione demo di esame ematico.
        var blood = new ServiceCatalogItem
        {
            Id = serviceBloodId,
            Code = "BLOOD_TEST",
            Name = "Esame Ematico",
            Description = "Esame ematico standard.",
            BasePriceCents = 2000,
            Currency = "EUR",
            IsActive = true,
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        _clinical.ServiceCatalog.AddRange(visit, blood);
        await _clinical.SaveChangesAsync(ct);

        // -----------------------------
        // Seed del database Scheduling
        // -----------------------------

        // Calendario del clinico demo.
        _scheduling.Calendars.Add(new ClinicianCalendar
        {
            Id = calendarId,
            ClinicianUserId = clinicianId,
            TimeZone = "Europe/Rome",
            CreatedAtUtc = now
        });

        // Orario base usato per costruire slot demo coerenti e futuri.
        var slotStart = new DateTime(now.Year, now.Month, now.Day, 9, 0, 0, DateTimeKind.Utc);

        // Slot demo:
        // - il primo già riservato e associato all'appuntamento seed;
        // - gli altri disponibili per eventuali test.
        _scheduling.Slots.AddRange(
            new AvailabilitySlot
            {
                Id = slot1Id,
                CalendarId = calendarId,
                StartUtc = slotStart.AddDays(1),
                EndUtc = slotStart.AddDays(1).AddMinutes(30),
                Status = SlotStatus.Reserved,
                CreatedAtUtc = now
            },
            new AvailabilitySlot
            {
                Id = slot2Id,
                CalendarId = calendarId,
                StartUtc = slotStart.AddDays(1).AddHours(1),
                EndUtc = slotStart.AddDays(1).AddHours(1).AddMinutes(30),
                Status = SlotStatus.Available,
                CreatedAtUtc = now
            },
            new AvailabilitySlot
            {
                Id = slot3Id,
                CalendarId = calendarId,
                StartUtc = slotStart.AddDays(2),
                EndUtc = slotStart.AddDays(2).AddMinutes(30),
                Status = SlotStatus.Available,
                CreatedAtUtc = now
            }
        );

        // Appuntamento demo prenotato dal paziente con il clinico seed.
        _scheduling.Appointments.Add(new Appointment
        {
            Id = appointmentId,
            SlotId = slot1Id,
            PatientUserId = patientId,
            ClinicianUserId = clinicianId,
            ServiceId = serviceVisitId,
            ServiceCode = "VISIT_GEN",
            QuotedPriceCents = 5000,
            Currency = "EUR",
            Status = AppointmentStatus.Booked,
            Notes = "Appuntamento demo (seed).",
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        });

        // Primo record di storico stato dell'appuntamento seed.
        _scheduling.AppointmentStatusChanges.Add(new AppointmentStatusChange
        {
            Id = statusChangeId,
            AppointmentId = appointmentId,
            FromStatus = AppointmentStatus.Booked,
            ToStatus = AppointmentStatus.Booked,
            ChangedByUserId = patientId,
            ChangedAtUtc = now,
            Reason = "Creazione appuntamento (seed)."
        });

        await _scheduling.SaveChangesAsync(ct);

        // -----------------------------
        // Seed del database Clinical
        // - Dati clinici collegati all'appuntamento
        // -----------------------------

        // Encounter clinico demo associato all'appuntamento seed.
        _clinical.Encounters.Add(new ClinicalEncounter
        {
            Id = encounterId,
            AppointmentId = appointmentId,
            PatientUserId = patientId,
            ClinicianUserId = clinicianId,
            StartedAtUtc = now,
            EndedAtUtc = null,
            Notes = "Presa in carico iniziale (seed).",
            CreatedAtUtc = now
        });

        // Record anamnestico demo.
        _clinical.Anamneses.Add(new AnamnesisRecord
        {
            Id = anamnesisId,
            EncounterId = encounterId,
            Content = "Anamnesi demo: nessuna allergia nota. Nessuna patologia cronica rilevante.",
            CreatedAtUtc = now,
            CreatedByUserId = clinicianId
        });

        // Parametro vitale demo.
        _clinical.VitalSigns.Add(new VitalSign
        {
            Id = vitalId,
            EncounterId = encounterId,
            Type = VitalSignType.HeartRate,
            Value = 72.0m,
            Unit = "bpm",
            MeasuredAtUtc = now,
            MeasuredByUserId = clinicianId
        });

        // Ordine clinico demo che richiede un esame ematico.
        _clinical.Orders.Add(new ClinicalOrder
        {
            Id = orderId,
            EncounterId = encounterId,
            CatalogItemId = serviceBloodId,
            Status = OrderStatus.Created,
            Notes = "Prescrizione esame ematico (seed).",
            CreatedAtUtc = now,
            CreatedByUserId = clinicianId
        });

        // Esecuzione procedurale demo collegata all'ordine.
        _clinical.Executions.Add(new ProcedureExecution
        {
            Id = executionId,
            OrderId = orderId,
            PerformedAtUtc = now.AddHours(1),
            PerformedByUserId = clinicianId,
            Outcome = "Eseguito",
            Notes = "Esecuzione demo (seed)."
        });

        // Referto clinico iniziale in bozza.
        _clinical.Reports.Add(new ClinicalReport
        {
            Id = reportId,
            EncounterId = encounterId,
            Status = ClinicalReportStatus.Draft,
            Content = "Referto demo (bozza): parametri nella norma.",
            SignedAtUtc = null,
            SignedByUserId = null,
            PublishedAtUtc = null,
            CreatedAtUtc = now
        });

        await _clinical.SaveChangesAsync(ct);

        // -----------------------------
        // Seed del database Payments
        // -----------------------------

        // Payment Intent demo per l'appuntamento seed.
        _payments.Intents.Add(new PaymentIntent
        {
            Id = paymentIntentId,
            AppointmentId = appointmentId,
            AmountCents = 5000,
            Currency = "EUR",
            Status = PaymentStatus.Created,
            Provider = "SIMULATED",
            ProviderIntentId = "pi_demo_001",
            IdempotencyKey = "idem_demo_001",
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        });

        // Prima transazione tecnica demo associata al Payment Intent.
        _payments.Transactions.Add(new PaymentTransaction
        {
            Id = paymentTxId,
            IntentId = paymentIntentId,
            ProviderTransactionId = "tx_demo_001",
            Status = PaymentStatus.Created,
            AmountCents = 5000,
            ProcessedAtUtc = now,
            RawResponseJson = "{\"provider\":\"SIMULATED\",\"status\":\"CREATED\"}"
        });

        await _payments.SaveChangesAsync(ct);

        // -----------------------------
        // Seed del database Events
        // -----------------------------

        // Notifica demo collegata alla prenotazione effettuata.
        _events.Notifications.Add(new Notification
        {
            Id = notificationId,
            RecipientUserId = patientId,
            Channel = "IN_APP",
            Subject = "Prenotazione confermata",
            Body = "La tua prenotazione demo è stata registrata correttamente.",
            Status = NotificationStatus.Pending,
            ScheduledAtUtc = now,
            SentAtUtc = null,
            Error = null,
            CreatedAtUtc = now
        });

        // Record di audit demo per tracciare la creazione dell'appuntamento.
        _events.AuditLogs.Add(new AuditLogEntry
        {
            Id = auditId,
            ActorUserId = patientId,
            Action = "APPOINTMENT_CREATED",
            EntityType = "Appointment",
            EntityId = appointmentId.ToString(),
            OccurredAtUtc = now,
            RequestId = "seed",
            MetadataJson = "{\"source\":\"seed\"}"
        });

        await _events.SaveChangesAsync(ct);
    }

    /*
     * Calcola l'hash PBKDF2 di una password in chiaro
     * per generare credenziali seed consistenti con il resto del sistema.
     *
     * Il formato restituito è:
     * iterations.saltBase64.hashBase64
     */
    private static string HashPassword(string password)
    {
        const int saltSize = 16;
        const int keySize = 32;
        const int iterations = 100_000;

        // Genera un salt casuale per la password seed.
        var salt = RandomNumberGenerator.GetBytes(saltSize);

        // Deriva l'hash della password con PBKDF2 e SHA-256.
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            iterations,
            HashAlgorithmName.SHA256,
            keySize);

        // Restituisce la rappresentazione serializzata usata dall'applicazione.
        return string.Join(
            '.',
            iterations.ToString(),
            Convert.ToBase64String(salt),
            Convert.ToBase64String(hash));
    }
}
