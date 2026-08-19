/*
 * File: services/core-service/src/CoreService.Infrastructure/Persistence/Registry/AdminDirectoryRepository.cs
 *
 * Scopo
 * -----
 * Implementare il repository infrastrutturale dedicato
 * alla ricerca amministrativa degli utenti del sistema
 * nelle directory di pazienti, delegati e clinici.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e fornisce
 * l'implementazione concreta dell'interfaccia IAdminDirectoryRepository del layer Application.
 * Il suo compito è tradurre le richieste di ricerca amministrativa
 * in query Entity Framework Core verso il database Registry,
 * restituendo direttamente DTO già pronti per il layer applicativo.
 *
 * Responsabilità principali
 * -------------------------
 * - Ricercare pazienti con filtri testuali, stato attivo e paginazione.
 * - Ricercare delegati con filtri testuali, stato attivo e paginazione.
 * - Ricercare clinici con filtri testuali, stato attivo e paginazione.
 * - Applicare ordinamento e limiti di pagina coerenti per tutte le directory.
 *
 * Interazioni principali
 * ----------------------
 * - RegistryDbContext
 * - IAdminDirectoryRepository
 * - DTO PatientDirectoryItemDto
 * - DTO DelegateDirectoryItemDto
 * - DTO ClinicianDirectoryItemDto
 *
 * Note
 * ----
 * Le query vengono eseguite in modalità AsNoTracking()
 * perché il repository ha finalità di sola consultazione.
 * La logica di validazione più stretta sui parametri
 * rimane nel layer Application; qui vengono comunque applicati
 * fallback difensivi su skip e take.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Contracts;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Registry;
using Microsoft.EntityFrameworkCore;

namespace CoreService.Infrastructure.Persistence.Registry
{
    internal sealed class AdminDirectoryRepository : IAdminDirectoryRepository
    {
        // DbContext del bounded context Registry usato
        // per eseguire le query di ricerca amministrativa sugli utenti.
        private readonly RegistryDbContext _dbContext;

        /*
         * Inizializza il repository con il DbContext necessario
         * per l'accesso ai dati del dominio Registry.
         */
        public AdminDirectoryRepository(RegistryDbContext dbContext)
        {
            _dbContext = dbContext
                ?? throw new ArgumentNullException(nameof(dbContext));
        }

        /*
         * Esegue una ricerca paginata nella directory dei pazienti.
         */
        public async Task<IReadOnlyList<PatientDirectoryItemDto>> SearchPatientsAsync(
            string? query,
            bool? onlyActive,
            int skip,
            int take,
            CancellationToken cancellationToken = default)
        {
            // Applica fallback difensivi sui parametri di paginazione
            // per evitare valori non significativi o eccessivi.
            if (skip < 0) skip = 0;
            if (take <= 0) take = 50;

            take = Math.Min(take, 500);

            // Normalizza il testo di ricerca e prepara il pattern SQL LIKE.
            var q = (query ?? string.Empty).Trim();
            var like = $"%{q}%";

            // Costruisce la query base unendo utenti e profili paziente
            // e limitando il risultato ai soli utenti con ruolo Patient.
            var baseQuery =
                from u in _dbContext.Users.AsNoTracking()
                join p in _dbContext.PatientProfiles.AsNoTracking() on u.Id equals p.UserId
                where u.Role == UserRole.Patient
                select new { u, p };

            // Applica, se richiesto, il filtro sullo stato attivo dell'utente.
            if (onlyActive.HasValue)
            {
                baseQuery = baseQuery.Where(x => x.u.IsActive == onlyActive.Value);
            }

            // Applica, se presente, il filtro testuale sui campi principali
            // utili alla ricerca amministrativa dei pazienti.
            if (!string.IsNullOrWhiteSpace(q))
            {
                baseQuery = baseQuery.Where(x =>
                    EF.Functions.Like(x.u.Email, like) ||
                    EF.Functions.Like(x.p.FirstName, like) ||
                    EF.Functions.Like(x.p.LastName, like) ||
                    (x.p.Phone != null && EF.Functions.Like(x.p.Phone, like)));
            }

            // Ordina i risultati dai più recenti ai meno recenti
            // in base alla data di creazione dell'utente.
            baseQuery = baseQuery.OrderByDescending(x => x.u.CreatedAtUtc);

            // Applica la paginazione e proietta direttamente il risultato nel DTO finale.
            var rows = await baseQuery
                .Skip(skip)
                .Take(take)
                .Select(x => new PatientDirectoryItemDto(
                    x.u.Id,
                    x.u.Email,
                    x.u.IsActive,
                    x.p.FirstName,
                    x.p.LastName,
                    x.p.DateOfBirthUtc,
                    x.p.Phone,
                    x.u.CreatedAtUtc,
                    x.u.UpdatedAtUtc
                ))
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return rows;
        }

        /*
         * Esegue una ricerca paginata nella directory dei delegati.
         */
        public async Task<IReadOnlyList<DelegateDirectoryItemDto>> SearchDelegatesAsync(
            string? query,
            bool? onlyActive,
            int skip,
            int take,
            CancellationToken cancellationToken = default)
        {
            // Applica fallback difensivi sui parametri di paginazione
            // per evitare valori non significativi o eccessivi.
            if (skip < 0) skip = 0;
            if (take <= 0) take = 50;

            take = Math.Min(take, 500);

            // Normalizza il testo di ricerca e prepara il pattern SQL LIKE.
            var q = (query ?? string.Empty).Trim();
            var like = $"%{q}%";

            // Costruisce la query base sulla directory dei delegati.
            // La left join sui profili consente di restituire anche utenti Delegate
            // eventualmente privi di profilo completo.
            var baseQuery =
                from u in _dbContext.Users.AsNoTracking()
                where u.Role == UserRole.Delegate
                join d in _dbContext.DelegateProfiles.AsNoTracking() on u.Id equals d.UserId into profiles
                from d in profiles.DefaultIfEmpty()
                select new { u, d };

            // Applica, se richiesto, il filtro sullo stato attivo dell'utente.
            if (onlyActive.HasValue)
            {
                baseQuery = baseQuery.Where(x => x.u.IsActive == onlyActive.Value);
            }

            // Applica, se presente, il filtro testuale sui campi rilevanti
            // per la ricerca amministrativa dei delegati.
            if (!string.IsNullOrWhiteSpace(q))
            {
                baseQuery = baseQuery.Where(x =>
                    EF.Functions.Like(x.u.Email, like) ||
                    (x.d != null && EF.Functions.Like(x.d.FirstName, like)) ||
                    (x.d != null && EF.Functions.Like(x.d.LastName, like)) ||
                    (x.d != null && x.d.Phone != null && EF.Functions.Like(x.d.Phone, like)) ||
                    (x.d != null && x.d.Address != null && EF.Functions.Like(x.d.Address, like)));
            }

            // Ordina i risultati dai più recenti ai meno recenti
            // in base alla data di creazione dell'utente.
            baseQuery = baseQuery.OrderByDescending(x => x.u.CreatedAtUtc);

            // Applica la paginazione e proietta direttamente il risultato nel DTO finale.
            var rows = await baseQuery
                .Skip(skip)
                .Take(take)
                .Select(x => new DelegateDirectoryItemDto(
                    x.u.Id,
                    x.u.Email,
                    x.u.IsActive,
                    x.d != null ? x.d.FirstName : string.Empty,
                    x.d != null ? x.d.LastName : string.Empty,
                    x.d != null ? x.d.Phone : null,
                    x.d != null ? x.d.Address : null,
                    x.u.CreatedAtUtc,
                    x.u.UpdatedAtUtc
                ))
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return rows;
        }

        /*
         * Esegue una ricerca paginata nella directory dei clinici.
         */
        public async Task<IReadOnlyList<ClinicianDirectoryItemDto>> SearchCliniciansAsync(
            string? query,
            bool? onlyActive,
            int skip,
            int take,
            CancellationToken cancellationToken = default)
        {
            // Applica fallback difensivi sui parametri di paginazione
            // per evitare valori non significativi o eccessivi.
            if (skip < 0) skip = 0;
            if (take <= 0) take = 50;

            take = Math.Min(take, 500);

            // Normalizza il testo di ricerca e prepara il pattern SQL LIKE.
            var q = (query ?? string.Empty).Trim();
            var like = $"%{q}%";

            // Costruisce la query base sulla directory dei clinici.
            // La left join sui profili consente di restituire anche utenti Clinician
            // eventualmente privi di profilo completo.
            var baseQuery =
                from u in _dbContext.Users.AsNoTracking()
                where u.Role == UserRole.Clinician
                join c in _dbContext.ClinicianProfiles.AsNoTracking() on u.Id equals c.UserId into profiles
                from c in profiles.DefaultIfEmpty()
                select new { u, c };

            // Applica, se richiesto, il filtro sullo stato attivo dell'utente.
            if (onlyActive.HasValue)
            {
                baseQuery = baseQuery.Where(x => x.u.IsActive == onlyActive.Value);
            }

            // Applica, se presente, il filtro testuale sui campi rilevanti
            // per la ricerca amministrativa dei clinici.
            if (!string.IsNullOrWhiteSpace(q))
            {
                baseQuery = baseQuery.Where(x =>
                    EF.Functions.Like(x.u.Email, like) ||
                    (x.c != null && EF.Functions.Like(x.c.FirstName, like)) ||
                    (x.c != null && EF.Functions.Like(x.c.LastName, like)) ||
                    (x.c != null && x.c.Phone != null && EF.Functions.Like(x.c.Phone, like)) ||
                    (x.c != null && EF.Functions.Like(x.c.Specialty, like)) ||
                    (x.c != null && EF.Functions.Like(x.c.LicenseNumber, like)) ||
                    (x.c != null && x.c.OfficeLocation != null && EF.Functions.Like(x.c.OfficeLocation, like)));
            }

            // Ordina i risultati dai più recenti ai meno recenti
            // in base alla data di creazione dell'utente.
            baseQuery = baseQuery.OrderByDescending(x => x.u.CreatedAtUtc);

            // Applica la paginazione e proietta direttamente il risultato nel DTO finale.
            var rows = await baseQuery
                .Skip(skip)
                .Take(take)
                .Select(x => new ClinicianDirectoryItemDto(
                    x.u.Id,
                    x.u.Email,
                    x.u.IsActive,
                    x.c != null ? x.c.FirstName : string.Empty,
                    x.c != null ? x.c.LastName : string.Empty,
                    x.c != null ? x.c.Phone : null,
                    x.c != null ? x.c.Specialty : string.Empty,
                    x.c != null ? x.c.LicenseNumber : string.Empty,
                    x.c != null ? x.c.OfficeLocation : null,
                    x.u.CreatedAtUtc,
                    x.u.UpdatedAtUtc
                ))
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            return rows;
        }
    }
}
