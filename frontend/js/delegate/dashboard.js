/**
 * File: frontend/js/delegate/dashboard.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della dashboard dell’area
 * Delegate, comprendendo il caricamento delle deleghe attive del
 * delegato, la selezione del paziente delegante, il recupero dei dati
 * sintetici relativi ad appuntamenti e pagamenti e l’aggiornamento dei
 * KPI e dei riepiloghi mostrati nella vista.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `dashboard.html` dell’area Delegate. Coordina l’interazione tra
 * interfaccia utente, servizi API relativi a deleghe, appuntamenti e
 * pagamenti e componenti condivisi dell’applicazione, traducendo il
 * contesto della delega selezionata in una dashboard operativa e
 * riassuntiva.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Delegate;
 * - recuperare l’elenco delle deleghe attive associate al delegato;
 * - popolare il selettore dei pazienti deleganti disponibili;
 * - mantenere in stato locale la delega e il paziente selezionato;
 * - recuperare appuntamenti e payment intents del paziente selezionato;
 * - aggiornare i KPI della dashboard;
 * - renderizzare i permessi attivi in base all’ambito della delega;
 * - renderizzare l’elenco sintetico dei prossimi appuntamenti;
 * - gestire refresh manuale, cambio selezione e trattamento degli errori.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.utils.requestJson()` per il recupero dei dati JSON;
 * - utilizza utility temporali come `APL.utils.parseApiDate()`,
 *   `APL.utils.romeTodayDateInputValue()` e
 *   `APL.utils.addDaysToDateInput()` e `APL.utils.romeDateRangeToUtc()`;
 * - utilizza `APL.utils.humanizeError()` per normalizzare i messaggi di errore;
 * - interagisce con gli endpoint:
 *   - `/api/registry/delegates/me/delegations`
 *   - `/api/scheduling/delegates/me/appointments`
 *   - `/api/payments/delegates/me/intents`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli
 * nel global scope. La dashboard mantiene uno stato locale minimale con
 * l’elenco delle deleghe disponibili e l’identificativo del paziente
 * selezionato, così da sincronizzare rapidamente i diversi riquadri della
 * vista senza introdurre logiche ridondanti.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla dashboard del delegato.
  const EXPECTED_ROLE = "Delegate";

  // Stato locale della pagina usato per memorizzare le deleghe disponibili
  // e il paziente attualmente selezionato nel menu a tendina.
  const state = {
    delegations: [],
    selectedPatientUserId: "",
  };

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel box globale della pagina.
  function showError(message) {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");

    // In assenza del nodo DOM non è possibile mostrare il messaggio.
    if (!box) return;

    // Scrive il testo di errore nel contenitore.
    box.textContent = message;

    // Rende visibile il contenitore.
    box.classList.remove("hidden");
  }

  // Formatta una data API in rappresentazione estesa per la dashboard.
  function fmtDateTime(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard di pagina.
    if (!isoUtc) return "—";

    // Prova a convertire il valore API in oggetto Date tramite utility condivisa.
    const d = APL.utils.parseApiDate(isoUtc);

    // Se il parsing fallisce mantiene il placeholder.
    if (!d) return "—";

    // Restituisce data e ora in formato italiano.
    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Costruisce un badge semplice per mostrare stato o permessi nella UI.
  function chip(text) {
    // Converte il valore in stringa garantendo sempre un fallback leggibile.
    const safe = String(text || "—");

    // Restituisce il frammento HTML pronto per essere inserito nella dashboard.
    return `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${safe}</span>`;
  }

  // Traduce lo stato tecnico di un pagamento in una label leggibile.
  function mapPaymentStatus(raw) {
    // Normalizza lo stato in minuscolo per confronti stabili.
    const s = String(raw || "").toLowerCase();

    // Mappa gli stati noti a etichette utente localizzate.
    if (["succeeded", "paid", "completed", "confirmed", "success"].includes(s)) return "Pagato";
    if (["failed", "canceled", "cancelled", "error"].includes(s)) return "Non riuscito";
    if (["pending", "processing"].includes(s)) return "In elaborazione";
    if (["created", "requires_action", "requiresaction"].includes(s)) return "Da completare";

    // Fallback per stati inattesi o assenti.
    return raw || "—";
  }

  // Traduce lo stato tecnico di un appuntamento in una label leggibile.
  function mapAppointmentStatus(raw) {
    // Normalizza lo stato in maiuscolo per confronti stabili.
    const s = String(raw || "").toUpperCase();

    // Mappa gli stati noti a etichette utente localizzate.
    if (s === "BOOKED") return "Prenotato";
    if (s === "CHECKED_IN") return "Accettato";
    if (s === "COMPLETED") return "Completato";
    if (s === "CANCELED" || s === "CANCELLED") return "Annullato";
    if (s === "NO_SHOW") return "Assente";

    // Fallback per stati inattesi o assenti.
    return raw || "—";
  }

  // Deriva i permessi leggibili da mostrare a partire dall’ambito della delega.
  function delegationScopeChips(scope) {
    // Normalizza il valore in maiuscolo per confronti stabili.
    const s = String(scope || "").toUpperCase();

    // La delega per gestione appuntamenti include consultazione e appuntamenti.
    if (s === "MANAGEAPPOINTMENTS") {
      return ["Consultazione", "Appuntamenti"];
    }

    // La delega per gestione pagamenti include consultazione e pagamenti.
    if (s === "MANAGEPAYMENTS") {
      return ["Consultazione", "Pagamenti"];
    }

    // La delega in sola lettura mostra soltanto la consultazione.
    if (s === "READONLY") {
      return ["Consultazione"];
    }

    // In assenza di ambito non restituisce permessi espliciti.
    if (!s) {
      return [];
    }

    // Fallback generico per ambiti non previsti.
    return [
      s
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/(^|\s)\S/g, (m) => m.toUpperCase()),
    ];
  }

  // Aggiorna il riquadro dei permessi attivi in base al paziente selezionato.
  function renderPermissionsForPatient(patientUserId) {
    // Recupera il contenitore dei permessi nella dashboard.
    const host = $("kpiPermissions");
    if (!host) return;

    // Cerca la delega corrispondente al paziente selezionato.
    const d = state.delegations.find((x) => String(x.patientUserId) === String(patientUserId));

    // Deriva l’elenco dei permessi leggibili dal relativo scope.
    const permissions = delegationScopeChips(d?.scope);

    // Se non sono presenti permessi specifici, mostra un fallback descrittivo.
    if (!permissions.length) {
      host.innerHTML = `<span class="text-slate-600 text-sm">Non specificati</span>`;
      return;
    }

    // Altrimenti renderizza tutti i permessi come chip.
    host.innerHTML = permissions.map((p) => chip(p)).join("");
  }

  // Renderizza l’elenco sintetico dei prossimi appuntamenti del paziente selezionato.
  function renderAppointments(items) {
    // Recupera il contenitore della lista appuntamenti.
    const host = $("appointmentsList");
    if (!host) return;

    // Se non ci sono appuntamenti da mostrare, visualizza un messaggio informativo.
    if (!items.length) {
      host.innerHTML = '<div class="px-4 py-4 text-sm text-slate-600">Nessun appuntamento nei prossimi 30 giorni.</div>';
      return;
    }

    // In caso di dati disponibili, mostra al massimo i primi otto elementi.
    host.innerHTML = items
      .slice(0, 8)
      .map((it) => {
        const when = fmtDateTime(it.startUtc);
        const service = it.serviceCode || "—";
        const status = mapAppointmentStatus(it.status);
        return `
          <div class="grid grid-cols-12 px-4 py-3 text-sm">
            <div class="col-span-5 text-slate-800">${when}</div>
            <div class="col-span-3 text-slate-700">${service}</div>
            <div class="col-span-4 text-right">${chip(status)}</div>
          </div>
        `;
      })
      .join("");
  }

  // Carica le deleghe del delegato autenticato e popola il selettore dei pazienti.
  async function loadDelegations() {
    // Richiede al backend l’elenco delle deleghe associate al delegato corrente.
    const res = await APL.utils.requestJson("/api/registry/delegates/me/delegations", {
      headers: { Accept: "application/json", ...APL.session.authHeader() },
    });

    // Normalizza il risultato a un array sicuro.
    const delegations = Array.isArray(res.data) ? res.data : [];

    // Aggiorna lo stato locale con tutte le deleghe disponibili.
    state.delegations = delegations;

    // Aggiorna il KPI relativo al numero di deleghe attive associate all’account.
    if ($("kpiDelegations")) $("kpiDelegations").textContent = String(delegations.length);

    // Recupera il selettore dei pazienti deleganti.
    const select = $("patientSelect");
    if (!select) return { selected: "" };

    // Svuota il contenuto precedente del selettore prima di ripopolarlo.
    select.innerHTML = "";

    // Se non esistono deleghe disponibili, mostra un’unica opzione informativa.
    if (!delegations.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nessuna delega disponibile";
      select.appendChild(opt);
      renderPermissionsForPatient("");
      return { selected: "" };
    }

    // Inserisce una opzione per ogni paziente delegante disponibile.
    delegations.forEach((d, idx) => {
      const opt = document.createElement("option");
      opt.value = d.patientUserId;

      // Determina la label più significativa disponibile per il paziente.
      const patientEmail =
        d.patientDisplayName ||
        d.patientEmail ||
        d.patientMail ||
        d.patientContactEmail ||
        `Paziente ${idx + 1}`;

      opt.textContent = patientEmail;
      select.appendChild(opt);
    });

    // Imposta come selezione iniziale il primo paziente disponibile.
    const first = delegations[0].patientUserId;
    select.value = first;
    state.selectedPatientUserId = first;

    // Aggiorna subito il riquadro dei permessi per la delega selezionata.
    renderPermissionsForPatient(first);

    return { selected: first };
  }

  // Carica il riepilogo operativo del paziente selezionato:
  // appuntamenti nei prossimi 30 giorni e payment intents disponibili.
  async function loadPatientSnapshot(patientUserId) {
    // In assenza di un paziente selezionato, ripristina la dashboard a uno stato vuoto.
    if (!patientUserId) {
      renderAppointments([]);
      if ($("kpiAppointments")) $("kpiAppointments").textContent = "0";
      if ($("kpiPendingPayments")) $("kpiPendingPayments").textContent = "0";
      renderPermissionsForPatient("");
      return;
    }

    // Aggiorna il riquadro permessi in base al paziente corrente.
    renderPermissionsForPatient(patientUserId);

    // Calcola la finestra temporale dei prossimi 30 giorni nel fuso di Roma.
    const now = new Date();
    const today = APL.utils.romeTodayDateInputValue();
    const endDay = APL.utils.addDaysToDateInput(today, 30);
    const range30 = APL.utils.romeDateRangeToUtc(today, endDay);

    // Costruisce l’endpoint per il riepilogo appuntamenti del paziente selezionato.
    const apptUrl = `/api/scheduling/delegates/me/appointments?patientUserId=${encodeURIComponent(
      patientUserId
    )}&fromUtc=${encodeURIComponent(now.toISOString())}&toUtc=${encodeURIComponent(range30.toUtc)}`;

    // Costruisce l’endpoint per i payment intents del paziente selezionato.
    const intentsUrl = `/api/payments/delegates/me/intents?patientUserId=${encodeURIComponent(patientUserId)}`;

    // Carica in parallelo appuntamenti e pagamenti per ridurre il tempo di attesa totale.
    const [apptsRes, intentsRes] = await Promise.all([
      APL.utils.requestJson(apptUrl, { headers: { Accept: "application/json", ...APL.session.authHeader() } }),
      APL.utils.requestJson(intentsUrl, { headers: { Accept: "application/json", ...APL.session.authHeader() } }),
    ]);

    // Normalizza i dataset ricevuti dal backend.
    const appts = Array.isArray(apptsRes.data) ? apptsRes.data : [];
    const intents = Array.isArray(intentsRes.data) ? intentsRes.data : [];

    // Aggiorna il KPI del numero di appuntamenti in programma.
    if ($("kpiAppointments")) $("kpiAppointments").textContent = String(appts.length);

    // Seleziona le operazioni di pagamento ancora non concluse positivamente.
    const pendingPayments = intents.filter((i) => {
      const s = String(i.status || "").toLowerCase();
      return ["created", "pending", "processing", "requires_action", "failed"].includes(s);
    });

    // Aggiorna il KPI dei pagamenti da completare.
    if ($("kpiPendingPayments")) $("kpiPendingPayments").textContent = String(pendingPayments.length);

    // Aggiorna l’elenco sintetico dei prossimi appuntamenti.
    renderAppointments(appts);
  }

  // Inizializza la dashboard del delegato.
  // Coordina autenticazione, binding degli eventi e primo caricamento dei dati.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Delegate.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Recupera i controlli principali della dashboard.
    const select = $("patientSelect");
    const refreshBtn = $("refreshBtn");

    // Collega il pulsante di refresh al ricaricamento del riepilogo del paziente corrente.
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        const patientUserId = select ? select.value : "";
        try {
          await loadPatientSnapshot(patientUserId);
        } catch (err) {
          console.error(err);
          showError(APL.utils.humanizeError(err) || "Impossibile aggiornare i dati.");
        }
      });
    }

    // Collega il cambio di selezione del paziente al ricaricamento della dashboard contestuale.
    if (select) {
      select.addEventListener("change", async () => {
        try {
          state.selectedPatientUserId = select.value;
          await loadPatientSnapshot(select.value);
        } catch (err) {
          console.error(err);
          showError(APL.utils.humanizeError(err) || "Impossibile caricare i dati del paziente selezionato.");
        }
      });
    }

    try {
      // Carica l’elenco delle deleghe e seleziona automaticamente il primo paziente disponibile.
      const { selected } = await loadDelegations();

      // Se esiste una selezione valida, carica il relativo riepilogo operativo.
      if (selected) await loadPatientSnapshot(selected);
    } catch (err) {
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la dashboard.");
    }
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
