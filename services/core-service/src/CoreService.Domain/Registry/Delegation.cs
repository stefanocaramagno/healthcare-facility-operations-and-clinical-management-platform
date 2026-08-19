/*
 * File: services/core-service/src/CoreService.Domain/Registry/Delegation.cs
 *
 * Scopo
 * -----
 * Definire l'entità di dominio che rappresenta una delega
 * tra un paziente e un delegato all'interno del sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Domain, nel contesto del bounded context Registry,
 * e modella il rapporto formale tramite cui un utente con ruolo Patient
 * autorizza un utente con ruolo Delegate a operare per suo conto
 * entro specifici limiti funzionali e temporali.
 *
 * Responsabilità principali
 * -------------------------
 * - Identificare univocamente la delega.
 * - Collegare il paziente titolare della delega al delegato autorizzato.
 * - Definire l'ambito operativo consentito tramite lo scope.
 * - Rappresentare lo stato corrente della delega.
 * - Delimitare temporalmente la validità della delega.
 * - Tracciare il timestamp di creazione della delega.
 *
 * Note
 * ----
 * Questa entità costituisce il riferimento centrale
 * per tutti i controlli di autorizzazione delegata del sistema.
 * La verifica di validità effettiva della delega
 * dipende dalla combinazione tra stato, intervallo temporale
 * e scope richiesto dall'operazione applicativa.
 */

namespace CoreService.Domain.Registry;

public sealed class Delegation
{
    // Identificativo univoco della delega.
    public Guid Id { get; set; }

    // Identificativo dell'utente paziente che concede la delega.
    public Guid PatientUserId { get; set; }

    // Identificativo dell'utente delegato autorizzato a operare per conto del paziente.
    public Guid DelegateUserId { get; set; }

    // Ambito dei permessi concessi dalla delega.
    public DelegationScope Scope { get; set; }

    // Stato corrente della delega, utilizzato per determinarne l'effettiva utilizzabilità.
    public DelegationStatus Status { get; set; }

    // Timestamp UTC di inizio validità della delega.
    public DateTime StartsAtUtc { get; set; }

    // Timestamp UTC di fine validità della delega.
    public DateTime EndsAtUtc { get; set; }

    // Timestamp UTC di creazione della delega.
    public DateTime CreatedAtUtc { get; set; }
}

