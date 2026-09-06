/**
 * File: frontend/js/delegate/pretriage.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina di pre-triage
 * dell’area Delegate, consentendo al delegato di consultare e, quando
 * consentito dalla delega e dallo stato dell’appuntamento, compilare o
 * aggiornare le informazioni pre-visita associate all’assistito.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `pretriage.html` dell’area Delegate. Coordina l’interazione tra
 * interfaccia utente, servizi API relativi a deleghe, appuntamenti e
 * contenuto di pre-triage e componenti condivisi dell’applicazione,
 * trasformando il questionario clinico preliminare in una vista
 * consultabile, validabile e, quando possibile, modificabile dal delegato.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Delegate;
 * - leggere dalla query string gli identificativi di appuntamento e assistito;
 * - recuperare la delega relativa all’assistito corrente;
 * - verificare i permessi di lettura e scrittura del pre-triage;
 * - recuperare l’appuntamento di riferimento;
 * - recuperare l’eventuale contenuto di pre-triage già salvato;
 * - popolare il form con i dati esistenti;
 * - validare i dati inseriti prima del salvataggio;
 * - salvare il contenuto aggiornato del questionario;
 * - gestire lo stato bloccato del form quando la modifica non è consentita;
 * - mostrare messaggi di errore, alert e feedback operativi all’utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.session.clearAuth()` nei casi di sessione scaduta;
 * - utilizza `APL.utils.requestJson()` come base per le chiamate API;
 * - utilizza `APL.utils.parseErrorMessage()` e `APL.utils.humanizeError()`
 *   per normalizzare i messaggi di errore;
 * - utilizza `APL.utils.toast()` per il feedback all’utente;
 * - utilizza utility temporali come `APL.utils.romeTodayDateInputValue()`,
 *   `APL.utils.addDaysToDateInput()` e `APL.utils.romeDateRangeToUtc()`;
 * - utilizza `APL.ui.modal.open()` per la conferma del ripristino del form;
 * - interagisce con gli endpoint:
 *   - `/api/registry/delegates/me/delegations`
 *   - `/api/scheduling/delegates/me/appointments`
 *   - `/api/clinical/delegates/me/pretriage`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli
 * nel global scope. La pagina mantiene uno stato locale con riferimento
 * all’assistito selezionato, all’appuntamento corrente, alla delega
 * associata e alla possibilità effettiva di modifica del questionario,
 * così da supportare controlli coerenti lato client durante l’intero
 * ciclo di vita della vista.
 */

(function () {
  "use strict";

  // Ruolo richiesto per l’accesso corretto alla pagina.
  const EXPECTED_ROLE = "Delegate";

  // Endpoint per il recupero delle deleghe del delegato autenticato.
  const API_DELEGATIONS = "/api/registry/delegates/me/delegations";

  // Endpoint per il recupero degli appuntamenti dell’assistito selezionato.
  const API_APPOINTMENTS = "/api/scheduling/delegates/me/appointments";

  // Endpoint per lettura e salvataggio del pre-triage lato delegato.
  const API_PRETRIAGE = "/api/clinical/delegates/me/pretriage";

  // Stato locale della pagina usato per mantenere il contesto corrente.
  const state = {
    appointmentId: "",
    patientUserId: "",
    delegation: null,
    appointment: null,
    editable: false,
  };

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un errore globale nella pagina.
  function showError(message) {
    // Recupera il contenitore dedicato agli errori di pagina.
    const box = $("pageError");
    if (!box) return;

    // Imposta il messaggio con fallback coerente.
    box.textContent = message || "Errore imprevisto.";

    // Rende visibile il contenitore.
    box.classList.remove("hidden");
  }

  // Nasconde il contenitore di errore globale e ne pulisce il contenuto.
  function clearError() {
    // Recupera il contenitore dedicato agli errori di pagina.
    const box = $("pageError");
    if (!box) return;

    // Pulisce il testo visualizzato in precedenza.
    box.textContent = "";

    // Nasconde il contenitore.
    box.classList.add("hidden");
  }

  // Mostra o nasconde l’alert applicativo interno al form.
  function showFormAlert(message) {
    // Recupera il contenitore dedicato agli alert del questionario.
    const box = $("formAlert");
    if (!box) return;

    // In assenza di messaggio, pulisce e nasconde il box.
    if (!message) {
      box.textContent = "";
      box.classList.add("hidden");
      return;
    }

    // In presenza di messaggio, aggiorna il contenuto e rende visibile il box.
    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Aggiorna lo stato di caricamento della pagina.
  function setLoading(loading) {
    // Mostra o nasconde il badge di caricamento globale.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Durante il caricamento, i pulsanti di salvataggio e ripristino
    // vengono disabilitati. Se la pagina non è editabile, restano
    // comunque disabilitati anche a caricamento concluso.
    const btnSave = $("btnSave");
    const btnReset = $("btnReset");
    if (btnSave) btnSave.disabled = !!loading || !state.editable;
    if (btnReset) btnReset.disabled = !!loading || !state.editable;
  }

  // Abilita o disabilita l’intero form di pre-triage.
  function setFormEnabled(enabled) {
    // Recupera il form principale del questionario.
    const form = $("pretriageForm");
    if (!form) return;

    // Disabilita o abilita tutti i controlli del form, tranne i pulsanti
    // che vengono gestiti separatamente.
    const fields = form.querySelectorAll("input, textarea, select, button");
    fields.forEach((el) => {
      if (el.id === "btnSave" || el.id === "btnReset") return;
      el.disabled = !enabled;
    });

    // Aggiorna esplicitamente anche i pulsanti di azione principali.
    const btnSave = $("btnSave");
    const btnReset = $("btnReset");
    if (btnSave) btnSave.disabled = !enabled;
    if (btnReset) btnReset.disabled = !enabled;

    // Mostra un box informativo quando il questionario risulta bloccato.
    const lockedBox = $("lockedBox");
    if (lockedBox) lockedBox.classList.toggle("hidden", enabled);
  }

  // Esegue l’escape HTML di una stringa prima dell’iniezione in markup dinamico.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Formatta una data/ora UTC in formato leggibile per l’utente.
  function fmtDateTime(isoUtc) {
    // In assenza del valore, restituisce il placeholder standard.
    if (!isoUtc) return "—";

    // Converte la stringa ISO in oggetto Date.
    const d = new Date(isoUtc);

    // Restituisce una rappresentazione estesa in formato italiano.
    return d.toLocaleString("it-IT", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Traduce lo stato dell’appuntamento in una pill visuale coerente con la UI.
  function statusPill(raw) {
    const s = String(raw || "").toUpperCase();
    const m =
      s === "BOOKED"
        ? { label: "Prenotato", cls: "bg-blue-50 text-blue-700" }
        : s === "CHECKED_IN"
          ? { label: "Accettato", cls: "bg-amber-50 text-amber-800" }
          : s === "COMPLETED"
            ? { label: "Completato", cls: "bg-emerald-50 text-emerald-700" }
            : s === "CANCELED" || s === "CANCELLED"
              ? { label: "Annullato", cls: "bg-slate-100 text-slate-700" }
              : s === "NO_SHOW"
                ? { label: "Assente", cls: "bg-slate-100 text-slate-700" }
                : { label: raw || "—", cls: "bg-slate-100 text-slate-700" };

    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${m.cls}">${escapeHtml(
      m.label
    )}</span>`;
  }

  // Attende che il sistema modale condiviso sia disponibile prima di usarlo.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();

    // Effettua un polling leggero finché il componente modale non risulta disponibile
    // oppure finché non viene superata la soglia temporale massima.
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    // Restituisce true solo se la modale è effettivamente pronta.
    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione uniforme
  // degli errori applicativi e di sessione.
  async function apiRequest(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // Se la sessione non è più valida, pulisce l’autenticazione locale
      // e reindirizza alla pagina di sessione scaduta.
      if (res.status === 401) {
        try {
          APL.session.clearAuth();
        } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // In caso di accesso non autorizzato, effettua il redirect dedicato.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Per tutti gli altri casi costruisce un errore arricchito con
      // informazioni utili per la UI e per il debugging applicativo.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    // In caso di successo restituisce direttamente il payload JSON.
    return res.data;
  }

  // Legge dalla query string gli identificativi necessari al contesto della pagina.
  function readParams() {
    const q = new URLSearchParams(window.location.search || "");
    const appointmentId = String(q.get("appointmentId") || "").trim();
    const patientUserId = String(q.get("patientUserId") || "").trim();
    return { appointmentId, patientUserId };
  }

  // Aggiorna il link di ritorno al dettaglio appuntamento usando il contesto corrente.
  function setHeaderLinks() {
    const btn = $("btnBackToDetail");
    if (!btn) return;

    btn.href =
      `./appointment-detail.html?appointmentId=${encodeURIComponent(String(state.appointmentId))}` +
      `&patientUserId=${encodeURIComponent(String(state.patientUserId))}`;
  }

  // Recupera l’elenco delle deleghe del delegato e seleziona quella
  // associata all’assistito corrente.
  async function loadDelegation() {
    const data = await apiRequest("GET", API_DELEGATIONS);
    const list = Array.isArray(data) ? data : [];

    state.delegation =
      list.find((x) => String(x.patientUserId || "") === String(state.patientUserId)) || null;

    return state.delegation;
  }

  // Verifica se la delega corrente consente almeno la consultazione del pre-triage.
  function canReadPreTriage() {
    const scope = String(state.delegation?.scope || "").toUpperCase();
    return scope === "READONLY" || scope === "MANAGEAPPOINTMENTS";
  }

  // Verifica se la delega corrente consente la modifica del pre-triage.
  function canWritePreTriage() {
    const scope = String(state.delegation?.scope || "").toUpperCase();
    return scope === "MANAGEAPPOINTMENTS";
  }

  // Recupera l’appuntamento richiesto cercandolo nell’intervallo esteso
  // di un anno precedente e successivo rispetto alla data corrente.
  async function fetchAppointmentById() {
    const today = APL.utils.romeTodayDateInputValue();
    const fromDay = APL.utils.addDaysToDateInput(today, -365);
    const toDay = APL.utils.addDaysToDateInput(today, 365);
    const range = APL.utils.romeDateRangeToUtc(fromDay, toDay);

    const url =
      `${API_APPOINTMENTS}?patientUserId=${encodeURIComponent(state.patientUserId)}` +
      `&fromUtc=${encodeURIComponent(range.fromUtc)}` +
      `&toUtc=${encodeURIComponent(range.toUtc)}`;

    const data = await apiRequest("GET", url);
    const list = Array.isArray(data) ? data : [];
    return list.find((x) => String(x.id) === String(state.appointmentId)) || null;
  }

  // Recupera l’eventuale contenuto di pre-triage già registrato per l’appuntamento.
  async function getPreTriage() {
    const url =
      `${API_PRETRIAGE}/appointments/${encodeURIComponent(String(state.appointmentId))}` +
      `?patientUserId=${encodeURIComponent(String(state.patientUserId))}`;

    const res = await APL.utils.requestJson(url, {
      method: "GET",
      headers: { Accept: "application/json", ...APL.session.authHeader() },
    });

    // In caso di successo restituisce il payload.
    if (res.ok) return res.data;

    // Il caso 404 viene interpretato come assenza di pre-triage già salvato.
    if (res.status === 404) return null;

    // Se la sessione è scaduta, pulisce l’autenticazione e reindirizza.
    if (res.status === 401) {
      try {
        APL.session.clearAuth();
      } catch (_) { }
      if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
      throw new Error("Sessione scaduta.");
    }

    // In caso di accesso negato, effettua il redirect dedicato.
    if (res.status === 403) {
      if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
      throw new Error("Accesso non autorizzato.");
    }

    // Gestione uniforme degli altri errori applicativi.
    const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
    const err = new Error(msg);
    err.status = res.status;
    err.data = res.data;
    err.requestId = res.requestId;
    throw err;
  }

  // Popola il riepilogo sintetico dell’appuntamento e determina se il form
  // sia modificabile nel contesto corrente.
  function setAppointmentSummary(appt) {
    // Mostra il riferimento univoco dell’appuntamento.
    if ($("apptRef")) $("apptRef").textContent = appt?.id ? String(appt.id) : "—";

    // Estrae prestazione e collocazione temporale dell’appuntamento.
    const svc = appt?.serviceCode ? String(appt.serviceCode) : "Appuntamento";
    const when = appt?.startUtc ? fmtDateTime(appt.startUtc) : "—";

    if ($("apptService")) $("apptService").textContent = svc;
    if ($("apptWhen")) $("apptWhen").textContent = when;

    // Aggiorna la pill dello stato dell’appuntamento.
    const pill = $("apptStatusPill");
    if (pill) pill.innerHTML = statusPill(appt?.status);

    // Il form è modificabile solo per appuntamenti attivi e solo se
    // la delega consente la scrittura del pre-triage.
    const st = String(appt?.status || "").toUpperCase();
    const activeAppointment = st === "BOOKED" || st === "CHECKED_IN";
    state.editable = activeAppointment && canWritePreTriage();

    // Sincronizza lo stato effettivo dei campi del form.
    setFormEnabled(state.editable);

    // Mostra un messaggio guida coerente con il motivo del blocco.
    if (!canWritePreTriage()) {
      showFormAlert("La delega corrente consente solo la consultazione del pre-triage.");
    } else if (!activeAppointment) {
      showFormAlert("Le modifiche non sono disponibili per questo appuntamento.");
    }
  }

  // Aggiorna il timestamp dell’ultimo salvataggio mostrato nella UI.
  function setLastSavedText(dto) {
    const el = $("lastSaved");
    if (!el) return;

    // In assenza di dato, mostra il placeholder standard.
    if (!dto || !dto.updatedAtUtc) {
      el.textContent = "—";
      return;
    }

    // Visualizza la data dell’ultimo aggiornamento.
    el.textContent = fmtDateTime(dto.updatedAtUtc);
  }

  // Legge un campo numerico dal form convertendolo in Number o null.
  function readNumber(id) {
    const v = String($(id)?.value || "").trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Costruisce il payload di contenuto da salvare partendo dai valori del form.
  function buildContentFromForm(appointmentId) {
    // Estrae i campi testuali e numerici principali del questionario.
    const chiefComplaint = String($("chiefComplaint")?.value || "").trim();
    const symptoms = String($("symptoms")?.value || "").trim();
    const onsetDate = String($("onsetDate")?.value || "").trim() || null;
    const painScale = readNumber("painScale");

    const temperatureC = readNumber("temperatureC");
    const heartRateBpm = readNumber("heartRateBpm");
    const spo2Pct = readNumber("spo2Pct");
    const bpSystolic = readNumber("bpSystolic");
    const bpDiastolic = readNumber("bpDiastolic");

    const allergies = String($("allergies")?.value || "").trim() || null;
    const medications = String($("medications")?.value || "").trim() || null;
    const conditions = String($("conditions")?.value || "").trim() || null;
    const additionalNotes = String($("additionalNotes")?.value || "").trim() || null;

    // Validazione minima obbligatoria: i sintomi principali devono essere presenti.
    if (!symptoms) {
      return { ok: false, message: "Inserisca una descrizione dei sintomi principali." };
    }

    // Validazione del livello di dolore nel range previsto.
    if (painScale !== null && (painScale < 0 || painScale > 10)) {
      return { ok: false, message: "Il livello di dolore deve essere compreso tra 0 e 10." };
    }

    // Costruisce l’oggetto strutturato del contenuto clinico.
    const contentObj = {
      version: 1,
      appointmentId: String(appointmentId),
      chiefComplaint: chiefComplaint || null,
      onsetDate,
      painScale,
      symptoms,
      vitals: {
        temperatureC,
        heartRateBpm,
        spo2Pct,
        bloodPressure: bpSystolic !== null || bpDiastolic !== null
          ? { systolic: bpSystolic, diastolic: bpDiastolic }
          : null,
      },
      allergies,
      medications,
      conditions,
      additionalNotes,
    };

    // Restituisce il contenuto serializzato pronto per il backend.
    return { ok: true, content: JSON.stringify(contentObj) };
  }

  // Popola il form a partire dal contenuto di pre-triage restituito dal backend.
  function fillFormFromContent(content) {
    // Utility locale per impostare in modo sicuro il valore di un campo.
    const set = (id, val) => {
      const el = $(id);
      if (!el) return;
      el.value = val ?? "";
    };

    // Prima azzera tutti i campi del form per evitare residui precedenti.
    set("chiefComplaint", "");
    set("onsetDate", "");
    set("painScale", "");
    set("symptoms", "");
    set("temperatureC", "");
    set("heartRateBpm", "");
    set("spo2Pct", "");
    set("bpSystolic", "");
    set("bpDiastolic", "");
    set("allergies", "");
    set("medications", "");
    set("conditions", "");
    set("additionalNotes", "");

    // Se non esiste alcun contenuto, termina lasciando il form vuoto.
    if (!content) return;

    try {
      // Prova a interpretare il contenuto come JSON strutturato.
      const obj = JSON.parse(String(content));
      if (obj && typeof obj === "object") {
        set("chiefComplaint", obj.chiefComplaint || "");
        set("onsetDate", obj.onsetDate || "");
        set("painScale", obj.painScale ?? "");
        set("symptoms", obj.symptoms || "");

        const v = obj.vitals || {};
        set("temperatureC", v.temperatureC ?? "");
        set("heartRateBpm", v.heartRateBpm ?? "");
        set("spo2Pct", v.spo2Pct ?? "");

        const bp = v.bloodPressure || null;
        set("bpSystolic", bp?.systolic ?? "");
        set("bpDiastolic", bp?.diastolic ?? "");

        set("allergies", obj.allergies || "");
        set("medications", obj.medications || "");
        set("conditions", obj.conditions || "");
        set("additionalNotes", obj.additionalNotes || "");
        return;
      }
    } catch (_) {
      // Se il parsing fallisce, si usa il fallback semplice qui sotto.
    }

    // Fallback compatibile con contenuti legacy non strutturati:
    // inserisce il testo grezzo nel campo sintomi.
    set("symptoms", String(content));
  }

  // Esegue il salvataggio del pre-triage verso il backend.
  async function savePreTriage() {
    // Pulisce eventuali messaggi precedenti prima di iniziare un nuovo salvataggio.
    showFormAlert("");
    clearError();

    // Costruisce e valida il contenuto a partire dal form.
    const built = buildContentFromForm(state.appointmentId);
    if (!built.ok) {
      showFormAlert(built.message);
      return;
    }

    const url =
      `${API_PRETRIAGE}/appointments/${encodeURIComponent(String(state.appointmentId))}` +
      `?patientUserId=${encodeURIComponent(String(state.patientUserId))}`;

    setLoading(true);
    try {
      // Invia il contenuto serializzato al backend.
      const dto = await apiRequest("PUT", url, { content: built.content });

      // Aggiorna la data dell’ultimo salvataggio e mostra un feedback positivo.
      setLastSavedText(dto);
      APL.utils.toast("Informazioni salvate.", "success");
    } catch (err) {
      const code = err?.data?.code ? String(err.data.code) : "";

      // Se l’appuntamento non è più modificabile, blocca il form e informa l’utente.
      if (code === "appointment_not_active_for_pretriage") {
        setFormEnabled(false);
        showFormAlert("Le modifiche non sono disponibili per questo appuntamento.");
        return;
      }

      // Se i permessi della delega non sono sufficienti, blocca il form e informa l’utente.
      if (code === "delegation_scope_insufficient") {
        setFormEnabled(false);
        showFormAlert("La delega corrente non consente la compilazione del pre-triage.");
        return;
      }

      // Per tutti gli altri casi mostra un messaggio umanizzato.
      showFormAlert(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      setLoading(false);
    }
  }

  // Mostra una conferma modale prima del ripristino del form.
  async function confirmReset() {
    const ok = await ensureModalReady(10000);
    if (!ok) return false;

    return new Promise((resolve) => {
      APL.ui.modal.open({
        title: "Ripristina compilazione",
        bodyHtml:
          `<div class="text-sm text-slate-700">` +
          `Le informazioni inserite non salvate verranno rimosse. Vuole procedere?</div>`,
        actions: [
          { label: "Annulla", kind: "secondary", closeOnClick: true, onClick: () => resolve(false) },
          { label: "Ripristina", kind: "danger", closeOnClick: true, onClick: () => resolve(true) },
        ],
      });
    });
  }

  // Inizializza la pagina di pre-triage del delegato.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Delegate.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Legge il contesto minimo necessario dalla query string.
    const params = readParams();
    state.appointmentId = params.appointmentId;
    state.patientUserId = params.patientUserId;

    // Se mancano i parametri obbligatori, la pagina non può essere aperta correttamente.
    if (!state.appointmentId || !state.patientUserId) {
      showError("Impossibile aprire questa sezione. Acceda dal dettaglio appuntamento dell’assistito.");
      setFormEnabled(false);
      return;
    }

    // Aggiorna i link dell’intestazione in base al contesto corrente.
    setHeaderLinks();

    try {
      setLoading(true);
      await ensureModalReady(10000);

      // Recupera la delega associata all’assistito corrente.
      await loadDelegation();
      if (!state.delegation || !canReadPreTriage()) {
        showError("La delega selezionata non consente l’accesso al pre-triage dell’assistito.");
        setFormEnabled(false);
        return;
      }

      // Recupera l’appuntamento a cui il questionario è associato.
      const appt = await fetchAppointmentById();
      state.appointment = appt;

      if (!appt) {
        showError("Appuntamento non trovato. Verifichi l’elenco appuntamenti dell’assistito.");
        setFormEnabled(false);
        return;
      }

      // Aggiorna il riepilogo dell’appuntamento e lo stato di editabilità del form.
      setAppointmentSummary(appt);

      // Recupera l’eventuale contenuto già salvato del pre-triage.
      const dto = await getPreTriage();
      if (dto) {
        fillFormFromContent(dto.content);
        setLastSavedText(dto);
      } else {
        setLastSavedText(null);
        fillFormFromContent("");
      }

      // Collega l’evento di submit del form con i controlli di editabilità.
      const form = $("pretriageForm");
      if (form) {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();

          // Se il form non è editabile, mostra un messaggio coerente con il motivo.
          if (!state.editable) {
            if (canWritePreTriage()) {
              showFormAlert("Le modifiche non sono disponibili per questo appuntamento.");
            } else {
              showFormAlert("La delega corrente consente solo la consultazione del pre-triage.");
            }
            return;
          }

          await savePreTriage();
        });
      }

      // Collega il pulsante di ripristino con conferma modale preventiva.
      const btnReset = $("btnReset");
      if (btnReset) {
        btnReset.addEventListener("click", async () => {
          if (!state.editable) return;

          const yes = await confirmReset();
          if (!yes) return;

          fillFormFromContent("");
          showFormAlert("");
          APL.utils.toast("Campi ripristinati.", "success");
        });
      }
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la pagina.");
      setFormEnabled(false);
    } finally {
      setLoading(false);
    }
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
