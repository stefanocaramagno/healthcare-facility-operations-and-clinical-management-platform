/**
 * File: frontend/js/delegate/booking.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina di prenotazione
 * dell’area Delegate, consentendo al delegato di selezionare un assistito,
 * scegliere una prestazione, ricercare le disponibilità, selezionare uno
 * slot valido e confermare la prenotazione per conto del paziente delegante.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `booking.html` dell’area Delegate. Coordina l’interazione tra
 * interfaccia utente, servizi API di deleghe, catalogo prestazioni,
 * disponibilità e prenotazione, e componenti condivisi dell’applicazione,
 * trasformando il flusso di prenotazione in un processo guidato composto da
 * selezione assistito, selezione prestazione, ricerca slot e conferma finale.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Delegate;
 * - recuperare l’elenco delle deleghe disponibili del delegato;
 * - verificare che la delega selezionata sia attiva e compatibile con la
 *   prenotazione di appuntamenti;
 * - recuperare il catalogo delle prestazioni e applicare filtri locali;
 * - ricercare le disponibilità nel range temporale selezionato;
 * - raggruppare e renderizzare gli slot per clinico e per giorno;
 * - mantenere il riepilogo della prenotazione in costruzione;
 * - confermare la prenotazione selezionata lato backend;
 * - gestire loading, messaggi informativi, errori globali e modali finali.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.session.clearAuth()` nei casi di sessione scaduta;
 * - utilizza `APL.utils.requestJson()` come base per le chiamate API;
 * - utilizza `APL.utils.parseErrorMessage()` e `APL.utils.humanizeError()`
 *   per normalizzare i messaggi di errore;
 * - utilizza `APL.utils.setLoading()` per lo stato visuale del pulsante di conferma;
 * - utilizza `APL.utils.toast()` per il feedback all’utente;
 * - utilizza utility temporali come `APL.utils.toRomeDateInputValue()`,
 *   `APL.utils.romeDateRangeToUtc()` e `APL.utils.romeDayKeyFromIso()`;
 * - utilizza `APL.ui.modal.open()` per la conferma visuale finale della prenotazione;
 * - interagisce con gli endpoint:
 *   - `/api/registry/delegates/me/delegations`
 *   - `/api/catalog/services`
 *   - `/api/scheduling/delegates/me/availability`
 *   - `/api/scheduling/delegates/me/appointments`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. Lo stato locale mantiene informazioni su deleghe, assistito
 * selezionato, prestazioni, slot disponibili e slot scelto, così da
 * supportare il flusso guidato di prenotazione senza richiedere nuove
 * chiamate al backend per ogni interazione locale.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Delegate";

  // Endpoint per il recupero delle deleghe del delegato autenticato.
  const API_DELEGATIONS = "/api/registry/delegates/me/delegations";

  // Endpoint per il recupero del catalogo prestazioni.
  const API_SERVICES = "/api/catalog/services";

  // Endpoint per la ricerca delle disponibilità prenotabili.
  const API_AVAILABILITY = "/api/scheduling/delegates/me/availability";

  // Endpoint per la creazione della prenotazione finale.
  const API_BOOK = "/api/scheduling/delegates/me/appointments";

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) { return document.getElementById(id); }

  // Mostra un messaggio di errore nel box globale della pagina.
  function showError(message) {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Imposta il messaggio di errore con fallback coerente.
    box.textContent = message || "Errore imprevisto.";

    // Rende visibile il contenitore.
    box.classList.remove("hidden");
  }

  // Ripristina lo stato normale della pagina nascondendo l’eventuale errore globale.
  function clearError() {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Pulisce il contenuto testuale.
    box.textContent = "";

    // Nasconde nuovamente il contenitore.
    box.classList.add("hidden");
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

  // Formatta un importo monetario espresso in centesimi.
  function formatMoney(cents, currency) {
    // Converte i centesimi in unità monetaria con due decimali.
    const value = (Number(cents || 0) / 100).toFixed(2);

    // Restituisce la stringa finale con valuta di fallback.
    return `${value} ${currency || "EUR"}`;
  }

  // Formatta una data/ora UTC in rappresentazione estesa per la UI.
  function fmtDate(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard.
    if (!isoUtc) return "—";

    // Converte la stringa ISO in oggetto Date.
    const d = new Date(isoUtc);

    // Se la data non è valida, mantiene il placeholder.
    if (!Number.isFinite(d.getTime())) return "—";

    // Restituisce una data estesa in formato italiano.
    return d.toLocaleString("it-IT", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Converte una data JavaScript nel formato richiesto dagli input date in fuso di Roma.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Imposta i vincoli minimi e la coerenza reciproca tra gli input data.
  function setDateInputConstraints() {
    // Recupera i due campi data del range di ricerca.
    const from = $("fromDate");
    const to = $("toDate");
    if (!from || !to) return;

    // Determina la data minima selezionabile: oggi nel fuso di Roma.
    const todayStr = toLocalDateInputValue(new Date());
    from.min = todayStr;
    to.min = todayStr;

    // Sincronizza il limite minimo del campo "to" con il valore di "from".
    const sync = () => {
      const fromVal = String(from.value || "").trim();
      if (fromVal) {
        to.min = fromVal >= todayStr ? fromVal : todayStr;
        if (to.value && to.value < to.min) to.value = to.min;
      } else {
        to.min = todayStr;
      }
    };

    // Quando cambia la data iniziale, riallinea i vincoli della data finale.
    from.addEventListener("change", sync);

    // Quando cambia la data finale, impedisce che risulti anteriore alla data iniziale.
    to.addEventListener("change", () => {
      if (from.value && to.value && to.value < from.value) {
        to.value = from.value;
      }
    });

    // Esegue una prima sincronizzazione iniziale.
    sync();
  }

  // Converte un intervallo di date locali nel corrispondente intervallo UTC.
  function dateRangeToUtc(fromDateStr, toDateStr) {
    // Usa l’utility condivisa per convertire il range nel fuso corretto.
    const range = APL.utils.romeDateRangeToUtc(fromDateStr, toDateStr);

    // Restituisce comunque una struttura stabile anche in fallback.
    return range || { fromUtc: "", toUtc: "" };
  }

  // Attende che il sistema modale condiviso sia disponibile prima di utilizzarlo.
  async function ensureModalReady(timeoutMs = 10000) {
    // Registra l’istante iniziale per applicare un timeout massimo di attesa.
    const start = Date.now();

    // Attende finché l’infrastruttura modale non risulta disponibile.
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    // Restituisce true solo se la modale è effettivamente pronta all’uso.
    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione uniforme
  // di sessione scaduta, accesso negato ed errori applicativi.
  async function apiJson(method, url, json) {
    // Invia la richiesta HTTP JSON includendo l’header di autenticazione utente.
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Se la risposta non è positiva, applica una gestione errori coerente.
    if (!res.ok) {
      // Sessione non più valida: pulizia locale e redirect dedicato.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Accesso vietato: redirect e costruzione di un errore semantico.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non consentita.";
        const err = new Error(msg);
        err.status = res.status;
        err.data = res.data;
        throw err;
      }

      // Per tutti gli altri casi costruisce un oggetto Error arricchito.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    // In caso di successo restituisce direttamente il payload deserializzato.
    return res.data;
  }

  // Costruisce una label leggibile del clinico associato a uno slot.
  function clinicianLabelFromSlot(slot) {
    // In assenza dello slot restituisce il placeholder standard.
    if (!slot) return "—";

    // Estrae email e specializzazione, se disponibili.
    const email = String(slot.clinicianEmail || "").trim();
    const spec = String(slot.clinicianSpecialty || "").trim();

    // Compone la label usando prima la combinazione più ricca.
    if (email && spec) return `${email} — ${spec}`;
    if (email) return email;
    if (spec) return spec;
    return "—";
  }

  // Garantisce l’esistenza della riga "Clinico" all’interno del riepilogo finale.
  function ensureSummaryClinicianRow() {
    // Se la riga è già presente non deve essere ricreata.
    if ($("sumClinician")) return;

    // Individua un punto di ancoraggio nel riepilogo esistente.
    const anchor = $("sumService") || $("sumWhen");
    if (!anchor) return;

    const row = anchor.closest("div.flex");
    const container = row?.parentElement;
    if (!row || !container) return;

    // Crea dinamicamente la riga riepilogativa del clinico.
    const el = document.createElement("div");
    el.className = "flex items-start justify-between gap-4";
    el.innerHTML = `
      <span class="text-slate-500">Clinico</span>
      <span id="sumClinician" class="font-medium text-slate-800 text-right">—</span>
    `;

    // Inserisce la nuova riga subito dopo quella di ancoraggio.
    container.insertBefore(el, row.nextSibling);
  }

  // Ricava una chiave di raggruppamento giornaliera locale da uno slot ISO UTC.
  function dayKeyLocal(isoUtc) {
    return APL.utils.romeDayKeyFromIso(isoUtc);
  }

  // Stato locale relativo a deleghe e assistito selezionato.
  const state = {
    delegations: [],
    selectedDelegation: null,
    patientUserId: "",
    patientLabel: "",
  };

  // Dataset completo delle prestazioni caricate dal backend.
  let _services = [];

  // Dataset filtrato delle prestazioni visibili nel selettore.
  let _filteredServices = [];

  // Prestazione attualmente selezionata.
  let _selectedService = null;

  // Slot di disponibilità attualmente caricati.
  let _slots = [];

  // Slot attualmente selezionato per la prenotazione.
  let _selectedSlot = null;

  // Timer usato per applicare un debounce al filtro del catalogo prestazioni.
  let _debounce = null;

  // Aggiorna lo stato di caricamento relativo alla sezione deleghe/assistito.
  function setDelLoading(loading) {
    // Mostra o nasconde il badge locale di caricamento.
    const badge = $("delLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Disabilita i controlli collegati al caricamento delle deleghe.
    const ids = ["patientSelect", "btnReloadDelegations"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Aggiorna lo stato di caricamento relativo alla sezione prestazioni.
  function setSvcLoading(loading) {
    // Mostra o nasconde il badge locale di caricamento.
    const badge = $("svcLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Disabilita i controlli collegati al catalogo prestazioni.
    const ids = ["serviceSelect", "serviceSearch"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Aggiorna lo stato di caricamento relativo alla ricerca disponibilità.
  function setAvLoading(loading) {
    // Mostra o nasconde il badge locale di caricamento.
    const badge = $("avLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Disabilita i controlli collegati alla ricerca degli slot.
    const ids = ["fromDate", "toDate", "btnSearchAvailability"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Aggiorna lo stato visuale del pulsante finale di conferma prenotazione.
  function setConfirmLoading(loading) {
    const btn = $("btnConfirm");
    if (btn) APL.utils.setLoading(btn, loading, "Conferma…");
  }

  // Mostra o nasconde il box informativo relativo ai permessi di prenotazione.
  function setPermissionBox(visible, text) {
    // Recupera il contenitore e il nodo testuale associati al messaggio permessi.
    const box = $("permissionBox");
    const t = $("permissionText");
    if (!box || !t) return;

    // Se il box non deve essere visibile, lo azzera e lo nasconde.
    if (!visible) {
      box.classList.add("hidden");
      t.textContent = "";
      return;
    }

    // Altrimenti mostra il testo fornito con fallback coerente.
    t.textContent = text || "Operazione non disponibile.";
    box.classList.remove("hidden");
  }

  // Aggiorna il badge riepilogativo dell’assistito selezionato.
  function setSelectedPatientPill() {
    // Recupera badge e label del paziente selezionato.
    const pill = $("selectedPatientPill");
    const label = $("selectedPatientLabel");
    if (!pill || !label) return;

    // Se non esiste un assistito selezionato, nasconde il badge.
    if (!state.patientUserId) {
      pill.classList.add("hidden");
      label.textContent = "";
      return;
    }

    // Altrimenti mostra la label corrente dell’assistito.
    label.textContent = state.patientLabel || "Assistito selezionato";
    pill.classList.remove("hidden");
  }

  // Aggiorna dinamicamente il link verso gli appuntamenti dell’assistito selezionato.
  function updateAppointmentsLink() {
    const a = $("appointmentsLink");
    if (!a) return;

    // Se è presente un assistito selezionato, propaga il patientUserId nella query string.
    if (state.patientUserId) {
      a.href = `./appointments.html?patientUserId=${encodeURIComponent(String(state.patientUserId))}`;
    } else {
      a.href = "./appointments.html";
    }
  }

  // Determina se una delega è attualmente attiva e temporalmente valida.
  function isDelegationActiveNow(d) {
    // In assenza di delega il controllo fallisce.
    if (!d) return false;

    // Lo stato deve essere esplicitamente ACTIVE.
    const status = String(d.status || "").toUpperCase();
    if (status !== "ACTIVE") return false;

    // Se le date non sono valorizzate o non valide, si assume delega attiva.
    const now = Date.now();
    const s = Date.parse(d.startsAtUtc || "");
    const e = Date.parse(d.endsAtUtc || "");

    if (!Number.isFinite(s) || !Number.isFinite(e)) return true;

    // Verifica che l’istante corrente ricada nell’intervallo.
    return now >= s && now <= e;
  }

  // Verifica se l’ambito della delega consente la gestione appuntamenti.
  function canManageAppointments(d) {
    if (!d) return false;
    const scope = String(d.scope || "").toUpperCase();
    return scope === "MANAGEAPPOINTMENTS";
  }

  // Determina se la prenotazione può essere confermata in questo momento.
  function canBookNow() {
    return !!state.patientUserId &&
      !!state.selectedDelegation &&
      isDelegationActiveNow(state.selectedDelegation) &&
      canManageAppointments(state.selectedDelegation) &&
      !!_selectedService &&
      !!_selectedSlot;
  }

  // Aggiorna il pannello di riepilogo finale in base allo stato corrente del flusso.
  function setSummary() {
    // Garantisce la presenza della riga del clinico nel riepilogo.
    ensureSummaryClinicianRow();

    // Recupera tutti i nodi del riepilogo finale.
    const sumPatient = $("sumPatient");
    const sumService = $("sumService");
    const sumClinician = $("sumClinician");
    const sumWhen = $("sumWhen");
    const sumPrice = $("sumPrice");

    // Aggiorna l’assistito selezionato.
    if (sumPatient) sumPatient.textContent = state.patientUserId ? (state.patientLabel || "Assistito selezionato") : "—";

    // Aggiorna la prestazione selezionata.
    if (sumService) sumService.textContent = _selectedService ? String(_selectedService.name || "—") : "—";

    // Aggiorna il clinico derivato dallo slot selezionato.
    if (sumClinician) sumClinician.textContent = _selectedSlot ? clinicianLabelFromSlot(_selectedSlot) : "—";

    // Aggiorna data/ora dello slot selezionato.
    if (sumWhen) sumWhen.textContent = _selectedSlot ? fmtDate(_selectedSlot.startUtc) : "—";

    // Aggiorna il costo indicativo della prestazione.
    if (sumPrice) {
      if (_selectedService) sumPrice.textContent = formatMoney(_selectedService.priceCents, _selectedService.currency);
      else sumPrice.textContent = "—";
    }

    // Abilita o disabilita il pulsante finale in base ai prerequisiti.
    const can = canBookNow();
    const btn = $("btnConfirm");
    if (btn) btn.disabled = !can;

    // Aggiorna il testo guida della sezione di conferma.
    const hint = $("confirmHint");
    if (hint) {
      hint.textContent = can
        ? "Verifichi i dettagli e proceda con la conferma."
        : "La conferma è disponibile dopo la selezione di assistito, prestazione e slot.";
    }
  }

  // Aggiorna lo stato della UI in funzione della delega selezionata.
  function updateDelegationUI() {
    const hint = $("delegationHint");
    if (!hint) return;

    // Riparte sempre con il box permessi nascosto.
    setPermissionBox(false, "");

    // Caso 1: nessun assistito selezionato.
    if (!state.patientUserId || !state.selectedDelegation) {
      hint.textContent = "Selezioni un assistito per proseguire.";
      disableBookingInputs(true);
      setSummary();
      return;
    }

    // Caso 2: delega non attiva al momento.
    if (!isDelegationActiveNow(state.selectedDelegation)) {
      hint.textContent = "La delega selezionata non risulta attiva in questo momento.";
      setPermissionBox(true, "La prenotazione non è disponibile per l’assistito selezionato.");
      disableBookingInputs(true);
      setSummary();
      return;
    }

    // Caso 3: delega attiva ma senza permesso di gestione appuntamenti.
    if (!canManageAppointments(state.selectedDelegation)) {
      hint.textContent = "È possibile consultare le informazioni, ma alcune azioni non risultano disponibili.";
      setPermissionBox(true, "La delega selezionata non consente la prenotazione di nuovi appuntamenti.");
      disableBookingInputs(true);
      setSummary();
      return;
    }

    // Caso 4: delega valida e compatibile con la prenotazione.
    hint.textContent = "È possibile procedere con la prenotazione per l’assistito selezionato.";
    disableBookingInputs(false);
    setSummary();
  }

  // Abilita o disabilita i controlli operativi del flusso di prenotazione.
  function disableBookingInputs(disabled) {
    const ids = ["serviceSelect", "serviceSearch", "fromDate", "toDate", "btnSearchAvailability", "notes", "btnConfirm"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!disabled;
    }
  }

  // Costruisce la label leggibile da mostrare per una delega nel selettore assistiti.
  function labelForDelegation(d, idx) {
    // Deriva un nome leggibile del paziente usando i campi migliori disponibili.
    const name =
      d.patientDisplayName ||
      d.patientFullName ||
      d.patientName ||
      `Assistito ${idx + 1}`;

    // Aggiunge stato e scope come suffisso informativo.
    const status = String(d.status || "");
    const scope = String(d.scope || "");

    const suffix = (status || scope) ? ` — ${[status, scope].filter(Boolean).join(", ")}` : "";
    return `${name}${suffix}`;
  }

  // Legge l’eventuale patientUserId dalla query string della pagina.
  function readQueryPatientUserId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("patientUserId");
    return v ? String(v) : "";
  }

  // Legge l’eventuale serviceId dalla query string della pagina.
  function readQueryServiceId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("serviceId");
    return v ? String(v) : null;
  }

  // Carica le deleghe disponibili e popola il selettore degli assistiti.
  async function loadDelegations() {
    setDelLoading(true);
    try {
      // Recupera il dataset delle deleghe del delegato autenticato.
      const res = await APL.utils.requestJson(API_DELEGATIONS, {
        headers: { Accept: "application/json", ...APL.session.authHeader() },
      });

      const delegations = Array.isArray(res.data) ? res.data : [];
      state.delegations = delegations;

      const select = $("patientSelect");
      if (!select) return;

      // Pulisce il selettore prima del nuovo popolamento.
      select.innerHTML = "";

      // Se non esistono deleghe, mostra una sola opzione informativa.
      if (!delegations.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Nessuna delega disponibile";
        select.appendChild(opt);

        state.patientUserId = "";
        state.patientLabel = "";
        state.selectedDelegation = null;

        // Pulisce la query string dall’eventuale patientUserId obsoleto.
        const qs = new URLSearchParams(window.location.search);
        if (qs.has("patientUserId")) {
          qs.delete("patientUserId");
          const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}`;
          window.history.replaceState({}, "", next);
        }

        setSelectedPatientPill();
        updateAppointmentsLink();
        updateDelegationUI();
        return;
      }

      // Inserisce il placeholder iniziale del selettore.
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Selezioni un assistito…";
      select.appendChild(placeholder);

      // Popola il selettore con tutte le deleghe disponibili.
      delegations.forEach((d, idx) => {
        const opt = document.createElement("option");
        opt.value = String(d.patientUserId || "");
        opt.textContent = labelForDelegation(d, idx);
        select.appendChild(opt);
      });

      // Se presente in query string, tenta di preselezionare l’assistito richiesto.
      const fromQs = readQueryPatientUserId();
      const hasValidFromQs = !!fromQs && delegations.some((d) => String(d.patientUserId) === String(fromQs));

      const pick = hasValidFromQs ? String(fromQs) : "";

      select.value = pick;

      // Aggiorna lo stato locale in base all’assistito preselezionato.
      if (!pick) {
        state.patientUserId = "";
        state.patientLabel = "";
        state.selectedDelegation = null;

        const qs = new URLSearchParams(window.location.search);
        if (qs.get("patientUserId")) {
          qs.delete("patientUserId");
          const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}`;
          window.history.replaceState({}, "", next);
        }
      } else {
        state.patientUserId = pick;
        state.selectedDelegation = delegations.find((x) => String(x.patientUserId) === String(pick)) || null;

        const idx = delegations.findIndex((x) => String(x.patientUserId) === String(pick));
        state.patientLabel = idx >= 0 ? labelForDelegation(delegations[idx], idx) : "Assistito selezionato";
      }

      // Riallinea tutta la UI dipendente dal paziente selezionato.
      setSelectedPatientPill();
      updateAppointmentsLink();
      updateDelegationUI();
    } finally {
      setDelLoading(false);
    }
  }

  // Applica il filtro locale al catalogo prestazioni in base al testo cercato.
  function applyServiceFilter() {
    const term = String($("serviceSearch")?.value || "").trim().toLowerCase();

    // Se il filtro è vuoto, ripristina l’intero catalogo.
    if (!term) {
      _filteredServices = _services.slice();
    } else {
      // Altrimenti filtra per nome, descrizione o codice.
      _filteredServices = _services.filter((s) => {
        const name = String(s.name || "").toLowerCase();
        const desc = String(s.description || "").toLowerCase();
        const code = String(s.code || "").toLowerCase();
        return name.includes(term) || desc.includes(term) || code.includes(term);
      });
    }

    // Dopo il filtro rigenera il selettore.
    populateServiceSelect();
  }

  // Popola il selettore prestazioni con il dataset filtrato corrente.
  function populateServiceSelect() {
    const select = $("serviceSelect");
    if (!select) return;

    // Mantiene l’eventuale valore attuale per tentare di preservare la selezione.
    const currentId = String(select.value || "");

    // Riparte sempre dal placeholder iniziale.
    select.innerHTML = `<option value="">Selezioni una prestazione…</option>`;

    // Inserisce le prestazioni ordinate alfabeticamente per nome.
    _filteredServices
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "it"))
      .forEach((s) => {
        const opt = document.createElement("option");
        opt.value = String(s.id);
        opt.textContent = `${s.name || "Prestazione"}${s.code ? ` — ${s.code}` : ""}`;
        select.appendChild(opt);
      });

    // Se la selezione precedente è ancora presente nel filtro corrente, la ripristina.
    if (currentId && _filteredServices.some((x) => String(x.id) === currentId)) {
      select.value = currentId;
    }

    // Riallinea la prestazione selezionata nello stato locale.
    syncSelectedServiceFromSelect();
  }

  // Sincronizza la prestazione selezionata nello stato locale a partire dal select.
  function syncSelectedServiceFromSelect() {
    const select = $("serviceSelect");
    const val = String(select?.value || "").trim();

    // Se nulla è selezionato, azzera la prestazione attuale.
    if (!val) {
      _selectedService = null;
    } else {
      _selectedService = _services.find((x) => String(x.id) === val) || null;
    }

    // Aggiorna dettaglio prestazione e riepilogo finale.
    renderServiceDetails();
    setSummary();
  }

  // Aggiorna il riquadro di dettaglio della prestazione selezionata.
  function renderServiceDetails() {
    const name = $("svcName");
    const code = $("svcCode");
    const desc = $("svcDesc");
    const price = $("svcPrice");

    // Se nessuna prestazione è selezionata, mostra lo stato iniziale.
    if (!_selectedService) {
      if (name) name.textContent = "—";
      if (code) code.textContent = "—";
      if (desc) desc.textContent = "Selezioni una prestazione per visualizzare i dettagli.";
      if (price) price.textContent = "—";
      return;
    }

    // Altrimenti aggiorna tutti i campi del riquadro dettaglio.
    if (name) name.textContent = String(_selectedService.name || "—");
    if (code) code.textContent = String(_selectedService.code || "—");
    if (desc) desc.textContent = String(_selectedService.description || "—");
    if (price) price.textContent = formatMoney(_selectedService.priceCents, _selectedService.currency);
  }

  // Carica il catalogo prestazioni e gestisce l’eventuale preselezione via query string.
  async function loadServices() {
    setSvcLoading(true);
    try {
      // Recupera il dataset completo del catalogo.
      const data = await apiJson("GET", API_SERVICES);
      _services = Array.isArray(data) ? data : [];
      _filteredServices = _services.slice();

      // Popola il selettore prestazioni.
      populateServiceSelect();

      // Se richiesto via query string, tenta di preselezionare la prestazione.
      const svcFromQs = readQueryServiceId();
      if (svcFromQs) {
        const select = $("serviceSelect");
        if (select && _services.some((x) => String(x.id) === String(svcFromQs))) {
          select.value = String(svcFromQs);
          syncSelectedServiceFromSelect();
        }
      }
    } finally {
      setSvcLoading(false);
    }
  }

  // Raggruppa gli slot caricati per clinico.
  function groupSlotsByClinician(slots) {
    const groups = new Map();

    for (const s of (Array.isArray(slots) ? slots : [])) {
      const key = String(s.clinicianUserId || "").trim() || "__unknown";
      const label = clinicianLabelFromSlot(s);

      if (!groups.has(key)) {
        groups.set(key, { clinicianKey: key, clinicianLabel: label, slots: [] });
      }

      groups.get(key).slots.push(s);
    }

    // Restituisce i gruppi ordinati alfabeticamente per label del clinico.
    return Array.from(groups.values())
      .sort((a, b) => String(a.clinicianLabel || "").localeCompare(String(b.clinicianLabel || ""), "it"));
  }

  // Renderizza gli slot disponibili raggruppati per clinico e per giorno.
  function renderAvailability(list, selectedSlotId) {
    const host = $("availabilityHost");
    const empty = $("availabilityEmpty");
    if (!host) return;

    const items = Array.isArray(list) ? list : [];

    // Se non esistono slot, mostra lo stato vuoto e svuota l’host.
    if (!items.length) {
      if (empty) empty.classList.remove("hidden");
      host.innerHTML = "";
      return;
    }

    // In presenza di risultati, nasconde lo stato vuoto.
    if (empty) empty.classList.add("hidden");

    // Raggruppa gli slot per clinico.
    const groups = groupSlotsByClinician(items);

    // Per ogni clinico raggruppa ulteriormente gli slot per giorno locale.
    host.innerHTML = groups.map((g) => {
      const clinicianHeader = (g.clinicianLabel && g.clinicianLabel !== "—")
        ? g.clinicianLabel
        : "Clinico non specificato";

      const byDay = new Map();
      for (const s of g.slots) {
        const k = dayKeyLocal(s.startUtc);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(s);
      }

      const dayKeys = Array.from(byDay.keys()).sort();

      const dayCards = dayKeys.map((k) => {
        const daySlots = byDay.get(k) || [];
        daySlots.sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));

        // Costruisce l’intestazione leggibile del giorno a partire dal primo slot.
        const headerDate = (() => {
          const sample = new Date(daySlots[0].startUtc);
          return sample.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" });
        })();

        // Renderizza i pulsanti dei singoli slot giornalieri.
        const buttons = daySlots.map((s) => {
          const id = String(s.id);
          const start = new Date(s.startUtc);
          const end = new Date(s.endUtc);

          const label =
            `${start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` +
            `–${end.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;

          const isSel = selectedSlotId && String(selectedSlotId) === id;

          const cls = isSel
            ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
            : "bg-white text-slate-700 border hover:bg-slate-50";

          return `
            <button type="button" data-slot="${escapeHtml(id)}"
              class="h-10 inline-flex items-center justify-center rounded-xl border px-3 text-sm font-medium ${cls} focus:outline-none focus:ring-4 focus:ring-blue-100">
              ${escapeHtml(label)}
            </button>
          `;
        }).join("");

        return `
          <div class="rounded-2xl border bg-white p-4">
            <div class="text-sm font-semibold text-slate-900 capitalize">${escapeHtml(headerDate)}</div>
            <div class="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              ${buttons}
            </div>
          </div>
        `;
      }).join("");

      return `
        <div class="rounded-2xl border bg-slate-50 p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-xs font-medium text-slate-500">Clinico</div>
              <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(clinicianHeader)}</div>
            </div>
            <div class="text-xs text-slate-500">${escapeHtml(String(g.slots.length))} slot</div>
          </div>

          <div class="mt-4 grid gap-4">
            ${dayCards}
          </div>
        </div>
      `;
    }).join("");
  }

  // Esegue la ricerca delle disponibilità in base a assistito, prestazione e range date.
  async function searchAvailability() {
    clearError();

    // Verifica preliminare della presenza dell’assistito e della delega selezionata.
    if (!state.patientUserId || !state.selectedDelegation) {
      APL.utils.toast("Selezioni un assistito per proseguire.", "error");
      return;
    }

    // Verifica preliminare dei permessi effettivi di prenotazione.
    if (!isDelegationActiveNow(state.selectedDelegation) || !canManageAppointments(state.selectedDelegation)) {
      APL.utils.toast("La prenotazione non è disponibile per l’assistito selezionato.", "error");
      return;
    }

    // Verifica preliminare della prestazione selezionata.
    if (!_selectedService) {
      APL.utils.toast("Selezioni una prestazione.", "error");
      return;
    }

    // Legge l’intervallo temporale impostato dall’utente.
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    if (!from || !to) {
      APL.utils.toast("Selezioni un intervallo di date valido.", "error");
      return;
    }

    setAvLoading(true);

    try {
      // Converte il range date locale nell’intervallo UTC richiesto dal backend.
      const rr = dateRangeToUtc(from, to);

      // Costruisce l’URL della richiesta disponibilità.
      const url =
        `${API_AVAILABILITY}?patientUserId=${encodeURIComponent(String(state.patientUserId))}` +
        `&fromUtc=${encodeURIComponent(rr.fromUtc)}&toUtc=${encodeURIComponent(rr.toUtc)}`;

      // Recupera gli slot disponibili.
      const slots = await apiJson("GET", url);
      _slots = Array.isArray(slots) ? slots : [];
      _selectedSlot = null;

      // Renderizza gli slot trovati azzerando la selezione corrente.
      renderAvailability(_slots, null);
      setSummary();
    } catch (err) {
      // In caso di errore mostra un messaggio globale coerente.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare le disponibilità.");
      _slots = [];
      _selectedSlot = null;

      // Ripristina i contenitori della sezione disponibilità.
      const host = $("availabilityHost");
      if (host) host.innerHTML = `<div class="text-sm text-slate-600">—</div>`;
      const empty = $("availabilityEmpty");
      if (empty) empty.classList.add("hidden");

      setSummary();
    } finally {
      setAvLoading(false);
    }
  }

  // Conferma la prenotazione dello slot selezionato.
  async function confirmBooking() {
    clearError();

    // Verifica finale dei prerequisiti di delega e permessi.
    if (!state.patientUserId || !state.selectedDelegation || !isDelegationActiveNow(state.selectedDelegation) || !canManageAppointments(state.selectedDelegation)) {
      APL.utils.toast("La prenotazione non è disponibile per l’assistito selezionato.", "error");
      return;
    }

    // Verifica finale di prestazione e slot selezionati.
    if (!_selectedService || !_selectedSlot) {
      APL.utils.toast("Selezioni una prestazione e uno slot disponibile.", "error");
      return;
    }

    // Legge le note opzionali da associare alla prenotazione.
    const notes = String($("notes")?.value || "").trim() || null;

    // Costruisce la label del clinico da mostrare nel riepilogo post-conferma.
    const clinicianShown = clinicianLabelFromSlot(_selectedSlot);

    setConfirmLoading(true);
    try {
      // Costruisce il payload di prenotazione nel formato richiesto dal backend.
      const payload = {
        slotId: _selectedSlot.id,
        serviceId: _selectedService.id,
        notes,
      };

      // Invia la richiesta di creazione appuntamento per il paziente selezionato.
      const url = `${API_BOOK}?patientUserId=${encodeURIComponent(String(state.patientUserId))}`;
      const appt = await apiJson("POST", url, payload);

      // Notifica il successo dell’operazione.
      APL.utils.toast("Prenotazione confermata.", "success");

      // Se la modale condivisa è disponibile, mostra il riepilogo finale dell’operazione.
      const ok = await ensureModalReady(10000);
      if (ok) {
        const bodyHtml = `
          <div class="space-y-4">
            <div class="rounded-2xl border bg-slate-50 p-4">
              <div class="text-xs font-medium text-slate-500">Dettagli prenotazione</div>
              <div class="mt-2 grid gap-2 text-sm">
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Assistito</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(state.patientLabel || "Assistito selezionato")}</span>
                </div>
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Prestazione</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(_selectedService.name || "—")}</span>
                </div>
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Clinico</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(clinicianShown)}</span>
                </div>
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Data/ora</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(fmtDate(appt.startUtc))}</span>
                </div>
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Costo indicativo</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(formatMoney(appt.quotedPriceCents, appt.currency))}</span>
                </div>
              </div>
            </div>

            <div class="text-sm text-slate-600">
              È possibile consultare l’elenco appuntamenti dell’assistito per verificare lo stato aggiornato.
            </div>
          </div>
        `;

        APL.ui.modal.open({
          title: "Prenotazione completata",
          bodyHtml,
          actions: [
            { label: "Chiudi", kind: "secondary" },
            {
              label: "Vedi appuntamenti",
              kind: "primary",
              onClick: () => {
                window.location.href = `./appointments.html?patientUserId=${encodeURIComponent(String(state.patientUserId))}`;
              }
            },
          ],
        });
      }

      // Dopo la conferma azzera lo slot selezionato ma mantiene il contesto del flusso.
      _selectedSlot = null;
      renderAvailability(_slots, null);
      setSummary();
    } catch (err) {
      // In caso di errore mostra un messaggio globale coerente.
      showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      setConfirmLoading(false);
    }
  }

  // Inizializza i valori di default dell’intervallo date di ricerca.
  function initDefaultDates() {
    const from = $("fromDate");
    const to = $("toDate");

    // Imposta come default da domani a due settimane avanti.
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

    if (from) from.value = toLocalDateInputValue(start);
    if (to) to.value = toLocalDateInputValue(end);
  }

  // Collega tutti gli eventi della pagina ai rispettivi controlli UI.
  function wireEvents() {
    // Refresh esplicito dell’elenco assistiti/deleghe.
    const btnReload = $("btnReloadDelegations");
    if (btnReload) {
      btnReload.addEventListener("click", async () => {
        clearError();
        try {
          await loadDelegations();
        } catch (err) {
          showError(APL.utils.humanizeError(err) || "Impossibile aggiornare l’elenco assistiti.");
        }
      });
    }

    // Cambio assistito selezionato.
    const patientSelect = $("patientSelect");
    if (patientSelect) {
      patientSelect.addEventListener("change", () => {
        const pick = String(patientSelect.value || "").trim();

        // Aggiorna il contesto assistito/delega selezionata.
        if (!pick) {
          state.patientUserId = "";
          state.patientLabel = "";
          state.selectedDelegation = null;
        } else {
          state.patientUserId = pick;
          state.selectedDelegation = state.delegations.find((x) => String(x.patientUserId) === String(pick)) || null;

          const idx = state.delegations.findIndex((x) => String(x.patientUserId) === String(pick));
          state.patientLabel = idx >= 0 ? labelForDelegation(state.delegations[idx], idx) : "Assistito selezionato";
        }

        // Propaga il patientUserId nella query string della pagina corrente.
        const qs = new URLSearchParams(window.location.search);
        if (state.patientUserId) qs.set("patientUserId", state.patientUserId);
        else qs.delete("patientUserId");

        const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}`;
        window.history.replaceState({}, "", next);

        setSelectedPatientPill();
        updateAppointmentsLink();

        // Azzera gli slot e la selezione disponibilità poiché il contesto assistito cambia.
        _selectedSlot = null;
        _slots = [];
        const host = $("availabilityHost");
        if (host) host.innerHTML = `<div class="text-sm text-slate-600">Selezioni assistito e prestazione, quindi avvii la ricerca delle disponibilità.</div>`;
        const empty = $("availabilityEmpty");
        if (empty) empty.classList.add("hidden");

        updateDelegationUI();
        setSummary();
      });
    }

    // Filtro testuale del catalogo prestazioni con debounce.
    const serviceSearch = $("serviceSearch");
    if (serviceSearch) {
      serviceSearch.addEventListener("input", () => {
        if (_debounce) clearTimeout(_debounce);
        _debounce = setTimeout(() => applyServiceFilter(), 200);
      });
    }

    // Cambio prestazione selezionata.
    const serviceSelect = $("serviceSelect");
    if (serviceSelect) {
      serviceSelect.addEventListener("change", () => {
        syncSelectedServiceFromSelect();
        _selectedSlot = null;
        renderAvailability(_slots, null);
        setSummary();
      });
    }

    // Avvio manuale della ricerca disponibilità.
    const btnSearch = $("btnSearchAvailability");
    if (btnSearch) btnSearch.addEventListener("click", () => searchAvailability());

    // Gestione della selezione dello slot tramite event delegation.
    const host = $("availabilityHost");
    if (host) {
      host.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        const btn = t.closest("button[data-slot]");
        if (!btn) return;

        const slotId = btn.getAttribute("data-slot");
        const slot = _slots.find((x) => String(x.id) === String(slotId)) || null;
        if (!slot) return;

        _selectedSlot = slot;
        renderAvailability(_slots, _selectedSlot.id);
        setSummary();
      });
    }

    // Conferma finale della prenotazione.
    const btnConfirm = $("btnConfirm");
    if (btnConfirm) btnConfirm.addEventListener("click", () => confirmBooking());
  }

  // Inizializza la pagina di prenotazione per assistito.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Delegate.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Inizializza date, vincoli input e binding degli eventi.
    initDefaultDates();
    setDateInputConstraints();
    wireEvents();

    // Carica il dataset deleghe/assistiti.
    try {
      await loadDelegations();
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare l’elenco assistiti.");
    }

    // Carica il catalogo prestazioni.
    try {
      await loadServices();
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il catalogo prestazioni.");
    }

    // Riallinea i componenti derivati dello stato iniziale.
    setSelectedPatientPill();
    updateAppointmentsLink();
    updateDelegationUI();
    setSummary();
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
