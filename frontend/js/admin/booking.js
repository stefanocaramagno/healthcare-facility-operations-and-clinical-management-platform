/**
 * File: frontend/js/admin/booking.js
 *
 * Scopo
 * -----
 * Gestire la pagina di prenotazione amministrativa, consentendo a un utente
 * con ruolo Admin di selezionare un paziente, scegliere una prestazione,
 * cercare le disponibilità e confermare la prenotazione di uno slot clinico.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta la logica client-side della pagina di booking
 * lato amministrativo. Coordina i dati provenienti dalle anagrafiche pazienti,
 * dal catalogo delle prestazioni e dal modulo di scheduling, costruendo
 * un flusso guidato che porta dalla selezione iniziale fino alla conferma
 * finale dell’appuntamento.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso dell’utente con ruolo Admin;
 * - caricare e mostrare l’elenco dei pazienti disponibili;
 * - caricare il catalogo delle prestazioni e filtrarne il contenuto;
 * - ricercare gli slot disponibili per il periodo selezionato;
 * - permettere la selezione di uno slot;
 * - aggiornare il riepilogo della prenotazione in tempo reale;
 * - inviare la richiesta di conferma della prenotazione al back-end;
 * - mostrare feedback, errori e modali informative all’utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza funzioni condivise esposte in `APL.utils`, tra cui:
 *   `requestJson`, `parseErrorMessage`, `humanizeError`,
 *   `toRomeDateInputValue`, `romeDateRangeToUtc`, `romeDayKeyFromIso`,
 *   `setLoading` e `toast`;
 * - utilizza `APL.ui.modal` per le finestre modali di conferma e dettaglio;
 * - interagisce con gli endpoint:
 *   `/api/registry/admin/patients`,
 *   `/api/registry/admin/patients/{userId}/profile`,
 *   `/api/catalog/services`,
 *   `/api/scheduling/admin/availability`,
 *   `/api/scheduling/admin/appointments`.
 *
 * Note
 * ----
 * Il file è incapsulato in una IIFE per evitare l’inquinamento del global scope.
 * La pagina è organizzata come un flusso in più fasi:
 * - selezione del paziente;
 * - selezione della prestazione;
 * - ricerca disponibilità;
 * - conferma della prenotazione.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter utilizzare correttamente la pagina di booking amministrativo.
  const EXPECTED_ROLE = "Admin";

  // Endpoint per il recupero dell’elenco dei pazienti.
  const API_PATIENTS = "/api/registry/admin/patients";

  // Endpoint per il recupero del profilo di un paziente specifico.
  const API_PATIENT_PROFILE = (userId) => `/api/registry/admin/patients/${encodeURIComponent(String(userId))}/profile`;

  // Endpoint per il recupero del catalogo prestazioni lato pubblico/applicativo.
  const API_SERVICES = "/api/catalog/services";

  // Endpoint per la ricerca delle disponibilità di scheduling.
  const API_AVAILABILITY = "/api/scheduling/admin/availability";

  // Endpoint per la conferma della prenotazione.
  const API_BOOK = "/api/scheduling/admin/appointments";

  // Numero massimo di pazienti da richiedere per il caricamento iniziale.
  const PATIENTS_TAKE = 200;

  // Flag che limita il caricamento ai soli pazienti attivi.
  const PATIENTS_ONLY_ACTIVE = true;

  // Helper sintetico per recuperare un elemento DOM tramite id.
  function $(id) { return document.getElementById(id); }

  // Mostra un errore globale nella pagina.
  function showError(message) {
    // Recupera il contenitore degli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Imposta il messaggio e rende visibile il box.
    box.textContent = message || "Errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Nasconde e svuota il contenitore degli errori globali.
  function clearError() {
    // Recupera il contenitore degli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Ripulisce contenuto e visibilità.
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Esegue l’escape di una stringa per inserirla in sicurezza nel DOM tramite HTML.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Formatta un importo espresso in centesimi insieme alla valuta.
  function formatMoney(cents, currency) {
    // Converte i centesimi in unità monetaria con due decimali.
    const value = (Number(cents || 0) / 100).toFixed(2);

    // Restituisce la rappresentazione testuale finale.
    return `${value} ${currency || "EUR"}`;
  }

  // Formattta una data ISO UTC in una forma leggibile per l’utente italiano.
  function fmtDate(isoUtc) {
    // Se la data non è presente restituisce il placeholder standard.
    if (!isoUtc) return "—";

    // Prova a costruire l’oggetto Date a partire dalla stringa ricevuta.
    const d = new Date(isoUtc);
    if (!Number.isFinite(d.getTime())) return "—";

    // Restituisce la data con giorno della settimana, data estesa e ora.
    return d.toLocaleString("it-IT", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Converte un oggetto Date nel formato atteso dagli input date locali.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Imposta i vincoli minimi e la coerenza tra le date "da" e "a".
  function setDateInputConstraints() {
    // Recupera i due input dell’intervallo temporale.
    const from = $("fromDate");
    const to = $("toDate");
    if (!from || !to) return;

    // Calcola la data odierna nel formato locale atteso dagli input.
    const todayStr = toLocalDateInputValue(new Date());

    // Impedisce la selezione di date precedenti a oggi.
    from.min = todayStr;
    to.min = todayStr;

    // Sincronizza il valore minimo del campo "A" con il valore del campo "Da".
    const sync = () => {
      const fromVal = String(from.value || "").trim();

      // Se è presente una data iniziale valida, aggiorna il minimo del campo finale.
      if (fromVal) {
        to.min = fromVal >= todayStr ? fromVal : todayStr;

        // Se il valore corrente del campo finale è incompatibile, lo corregge.
        if (to.value && to.value < to.min) to.value = to.min;
      } else {
        // In assenza di data iniziale, il minimo torna a essere la data odierna.
        to.min = todayStr;
      }
    };

    // Aggiorna i vincoli quando cambia la data iniziale.
    from.addEventListener("change", sync);

    // Garantisce che la data finale non sia mai precedente a quella iniziale.
    to.addEventListener("change", () => {
      if (from.value && to.value && to.value < from.value) {
        to.value = from.value;
      }
    });

    // Esegue una prima sincronizzazione all’avvio.
    sync();
  }

  // Converte un intervallo di date locali in un intervallo UTC utilizzabile dal back-end.
  function dateRangeToUtc(fromDateStr, toDateStr) {
    // Richiede al modulo comune la conversione dell’intervallo.
    const range = APL.utils.romeDateRangeToUtc(fromDateStr, toDateStr);

    // Restituisce un oggetto vuoto coerente se la conversione fallisce.
    return range || { fromUtc: "", toUtc: "" };
  }

  // Attende che il componente modale condiviso sia disponibile.
  async function ensureModalReady(timeoutMs = 10000) {
    // Memorizza l’istante iniziale per il controllo del timeout.
    const start = Date.now();

    // Attende a piccoli intervalli finché la modale non è pronta oppure il timeout non scade.
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    // Restituisce true solo se l’API modale è realmente disponibile.
    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Esegue una richiesta JSON autenticata e normalizza la gestione degli errori.
  async function apiJson(method, url, json) {
    // Invia la richiesta con gli header di autenticazione e accetta risposte JSON.
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Gestisce i casi di risposta non positiva.
    if (!res.ok) {
      // Se la sessione è scaduta, pulisce lo stato locale e reindirizza.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Se l’utente non è autorizzato, reindirizza alla pagina di accesso negato.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non consentita.";
        const err = new Error(msg);
        err.status = res.status;
        err.data = res.data;
        throw err;
      }

      // Per tutti gli altri errori costruisce un oggetto Error arricchito con i dettagli.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    // Se la risposta è valida, restituisce direttamente il payload.
    return res.data;
  }

  // Costruisce una descrizione leggibile del clinico a partire dai dati dello slot.
  function clinicianLabelFromSlot(slot) {
    if (!slot) return "—";

    // Estrae email e specialità dal record dello slot.
    const email = String(slot.clinicianEmail || "").trim();
    const spec = String(slot.clinicianSpecialty || "").trim();

    // Compone l’etichetta nel formato più ricco possibile.
    if (email && spec) return `${email} — ${spec}`;
    if (email) return email;
    if (spec) return spec;
    return "—";
  }

  // Garantisce che il riepilogo contenga anche la riga dedicata al clinico.
  function ensureSummaryClinicianRow() {
    // Se la riga è già presente non serve fare nulla.
    if ($("sumClinician")) return;

    // Usa una riga esistente come punto di aggancio per l’inserimento.
    const anchor = $("sumService") || $("sumWhen");
    if (!anchor) return;

    const row = anchor.closest("div.flex");
    const container = row?.parentElement;
    if (!row || !container) return;

    // Crea dinamicamente la riga "Clinico" e la inserisce subito dopo l’anchor.
    const el = document.createElement("div");
    el.className = "flex items-start justify-between gap-4";
    el.innerHTML = `
      <span class="text-slate-500">Clinico</span>
      <span id="sumClinician" class="font-medium text-slate-800 text-right">—</span>
    `;

    container.insertBefore(el, row.nextSibling);
  }

  // Restituisce una chiave giorno locale a partire da una data ISO UTC.
  function dayKeyLocal(isoUtc) {
    return APL.utils.romeDayKeyFromIso(isoUtc);
  }

  // Stato locale relativo al paziente selezionato.
  const state = {
    patientUserId: "",
    patientLabel: "",
    patientItem: null,
  };

  // Cache locale dell’elenco pazienti.
  let _patients = [];

  // Cache locale del catalogo servizi completo.
  let _services = [];

  // Cache locale del catalogo servizi filtrato.
  let _filteredServices = [];

  // Servizio attualmente selezionato.
  let _selectedService = null;

  // Slot disponibili attualmente caricati.
  let _slots = [];

  // Slot attualmente selezionato dall’utente.
  let _selectedSlot = null;

  // Aggiorna lo stato di caricamento dell’area pazienti.
  function setPatLoading(loading) {
    // Mostra o nasconde il badge di caricamento dell’area pazienti.
    const badge = $("patLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Disabilita il select dei pazienti durante il caricamento.
    const sel = $("patientSelect");
    if (sel) sel.disabled = !!loading;

    // Aggiorna anche il pulsante di refresh con lo stato di loading.
    const btn = $("btnRefreshPatients");
    if (btn) APL.utils.setLoading(btn, loading, "Aggiornamento…");
    if (btn) btn.disabled = !!loading;
  }

  // Aggiorna lo stato di caricamento dell’area servizi.
  function setSvcLoading(loading) {
    // Mostra o nasconde il badge dedicato ai servizi.
    const badge = $("svcLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Disabilita i controlli relativi alla scelta e ricerca prestazione.
    const ids = ["serviceSelect", "serviceSearch"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Aggiorna lo stato di caricamento dell’area disponibilità.
  function setAvLoading(loading) {
    // Mostra o nasconde il badge di ricerca disponibilità.
    const badge = $("avLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Disabilita i controlli dell’intervallo date e il pulsante di ricerca.
    const ids = ["fromDate", "toDate", "btnSearchAvailability"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Aggiorna lo stato di caricamento del pulsante di conferma prenotazione.
  function setConfirmLoading(loading) {
    const btn = $("btnConfirm");
    if (btn) APL.utils.setLoading(btn, loading, "Conferma…");
  }

  // Aggiorna la pillola visiva del paziente selezionato.
  function setSelectedPatientPill() {
    const pill = $("selectedPatientPill");
    const label = $("selectedPatientLabel");
    if (!pill || !label) return;

    // Se non esiste un paziente selezionato, nasconde la pillola.
    if (!state.patientUserId) {
      pill.classList.add("hidden");
      label.textContent = "";
      return;
    }

    // Altrimenti mostra la descrizione del paziente selezionato.
    label.textContent = state.patientLabel || "Paziente selezionato";
    pill.classList.remove("hidden");
  }

  // Aggiorna il testo guida sotto la selezione del paziente.
  function setPatientHint(text) {
    const el = $("patientHint");
    if (!el) return;
    el.textContent = text || "Selezioni un paziente per proseguire.";
  }

  // Verifica se sono soddisfatte le condizioni minime per confermare una prenotazione.
  function canBookNow() {
    return !!state.patientUserId && !!_selectedService && !!_selectedSlot;
  }

  // Aggiorna l’intero pannello riepilogativo laterale.
  function setSummary() {
    // Garantisce che la riga "Clinico" sia presente nel riepilogo.
    ensureSummaryClinicianRow();

    const sumPatient = $("sumPatient");
    const sumService = $("sumService");
    const sumClinician = $("sumClinician");
    const sumWhen = $("sumWhen");
    const sumPrice = $("sumPrice");

    // Aggiorna il paziente selezionato.
    if (sumPatient) sumPatient.textContent = state.patientUserId ? (state.patientLabel || "Paziente selezionato") : "—";

    // Aggiorna la prestazione selezionata.
    if (sumService) sumService.textContent = _selectedService ? String(_selectedService.name || "—") : "—";

    // Aggiorna il clinico relativo allo slot selezionato.
    if (sumClinician) sumClinician.textContent = _selectedSlot ? clinicianLabelFromSlot(_selectedSlot) : "—";

    // Aggiorna data e ora dello slot selezionato.
    if (sumWhen) sumWhen.textContent = _selectedSlot ? fmtDate(_selectedSlot.startUtc) : "—";

    // Aggiorna il prezzo stimato della prestazione.
    if (sumPrice) sumPrice.textContent = _selectedService ? formatMoney(_selectedService.basePriceCents, _selectedService.currency) : "—";

    // Determina se la prenotazione è confermabile.
    const can = canBookNow();
    const btn = $("btnConfirm");
    if (btn) btn.disabled = !can;

    // Aggiorna il testo guida contestuale del pulsante di conferma.
    const hint = $("confirmHint");
    if (hint) {
      hint.textContent = can
        ? "Verifichi i dettagli e proceda con la conferma."
        : "La conferma è disponibile dopo la selezione di paziente, prestazione e slot.";
    }
  }

  // Ripristina l’area disponibilità a uno stato neutro, svuotando slot e selezione corrente.
  function resetAvailabilityUI(message) {
    // Azzera la cache degli slot e la selezione corrente.
    _slots = [];
    _selectedSlot = null;

    const host = $("availabilityHost");
    const empty = $("availabilityEmpty");

    // Mostra un messaggio guida nel contenitore disponibilità.
    if (host) host.innerHTML = `<div class="text-sm text-slate-600">${escapeHtml(message || "—")}</div>`;

    // Nasconde l’empty state esplicito.
    if (empty) empty.classList.add("hidden");

    // Aggiorna il riepilogo finale dopo il reset.
    setSummary();
  }

  // Legge dall’URL l’eventuale identificativo del paziente preimpostato.
  function readQueryPatientUserId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("patientUserId");
    return v ? String(v) : "";
  }

  // Legge dall’URL l’eventuale identificativo della prestazione preimpostata.
  function readQueryServiceId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("serviceId");
    return v ? String(v) : null;
  }

  // Aggiorna i query parameter dell’URL per riflettere lo stato corrente della pagina.
  function updateQueryParams() {
    const qs = new URLSearchParams(window.location.search || "");

    // Mantiene o rimuove il patientUserId in base allo stato corrente.
    if (state.patientUserId) qs.set("patientUserId", String(state.patientUserId));
    else qs.delete("patientUserId");

    // Mantiene o rimuove il serviceId in base alla selezione corrente.
    if (_selectedService?.id) qs.set("serviceId", String(_selectedService.id));
    else qs.delete("serviceId");

    // Aggiorna l’URL senza ricaricare la pagina.
    const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}`;
    window.history.replaceState({}, "", next);
  }

  // Costruisce l’etichetta leggibile di un paziente.
  function patientLabel(p) {
    if (!p) return "Paziente";

    // Costruisce il nome completo.
    const name = `${String(p.firstName || "").trim()} ${String(p.lastName || "").trim()}`.trim() || "Paziente";

    // Aggiunge l’email se disponibile.
    const email = String(p.email || "").trim();
    return email ? `${name} — ${email}` : name;
  }

  // Popola il select dei pazienti, preservando se possibile la selezione corrente.
  function populatePatientsSelect(selectedId) {
    const select = $("patientSelect");
    if (!select) return;

    // Salva il valore correntemente selezionato.
    const current = String(selectedId || select.value || "");

    // Reinizializza il select con l’opzione di default.
    select.innerHTML = `<option value="">Selezioni un paziente…</option>`;

    // Se non ci sono pazienti disponibili, mostra un’opzione informativa.
    if (!_patients.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nessun paziente trovato";
      select.appendChild(opt);
      select.value = "";
      return;
    }

    // Ordina i pazienti per etichetta e popola il select.
    _patients
      .slice()
      .sort((a, b) => patientLabel(a).localeCompare(patientLabel(b), "it"))
      .forEach((p) => {
        const opt = document.createElement("option");
        opt.value = String(p.userId || "");
        opt.textContent = patientLabel(p);
        select.appendChild(opt);
      });

    // Ripristina la selezione se il paziente è ancora presente.
    if (current && _patients.some((x) => String(x.userId) === current)) {
      select.value = current;
    } else {
      select.value = "";
    }
  }

  // Sincronizza lo stato interno con il paziente selezionato nel select.
  function syncSelectedPatientFromSelect() {
    const select = $("patientSelect");
    const val = String(select?.value || "").trim();

    // Aggiorna lo stato locale del paziente.
    state.patientUserId = val;
    state.patientItem = val ? (_patients.find((x) => String(x.userId) === val) || null) : null;
    state.patientLabel = state.patientItem ? patientLabel(state.patientItem) : "";

    // Aggiorna la UI con la nuova selezione.
    setSelectedPatientPill();
    setPatientHint(state.patientUserId
      ? "È possibile procedere con la prenotazione per il paziente selezionato."
      : "Selezioni un paziente per proseguire.");

    // La disponibilità dipende da paziente e prestazione, quindi viene resettata.
    resetAvailabilityUI("Selezioni paziente e prestazione, quindi avvii la ricerca delle disponibilità.");

    // Aggiorna l’URL e il riepilogo.
    updateQueryParams();
    setSummary();
  }

  // Carica l’elenco dei pazienti dal back-end.
  async function loadPatients() {
    setPatLoading(true);
    try {
      // Costruisce la query di caricamento pazienti.
      const params = new URLSearchParams();
      params.set("onlyActive", String(PATIENTS_ONLY_ACTIVE));
      params.set("skip", "0");
      params.set("take", String(PATIENTS_TAKE));

      // Esegue la richiesta e aggiorna la cache locale.
      const data = await apiJson("GET", `${API_PATIENTS}?${params.toString()}`);
      _patients = Array.isArray(data) ? data : [];

      // Aggiorna il select e sincronizza la selezione.
      populatePatientsSelect(state.patientUserId);
      syncSelectedPatientFromSelect();
    } catch (err) {
      // In caso di errore, mostra un messaggio e ripulisce lo stato paziente.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare l’elenco pazienti.");
      _patients = [];
      populatePatientsSelect("");
      state.patientUserId = "";
      state.patientLabel = "";
      state.patientItem = null;
      setSelectedPatientPill();
      setPatientHint("Selezioni un paziente per proseguire.");
      resetAvailabilityUI("—");
    } finally {
      setPatLoading(false);
    }
  }

  // Se nell’URL è presente un patientUserId, prova a recuperarlo anche se non è nel primo elenco caricato.
  async function ensurePatientFromQuery(userId) {
    if (!userId) return false;

    try {
      // Recupera il profilo del paziente indicato esplicitamente nell’URL.
      const profile = await apiJson("GET", API_PATIENT_PROFILE(userId));

      // Costruisce un record compatibile con la struttura del select pazienti.
      const pseudo = {
        userId: profile.userId,
        email: "(profilo)",
        isActive: true,
        firstName: profile.firstName,
        lastName: profile.lastName,
        dateOfBirthUtc: profile.dateOfBirthUtc,
        phone: profile.phone || null,
      };

      // Se non è già presente in cache, lo aggiunge e ripopola il select.
      if (!_patients.some((x) => String(x.userId) === String(userId))) {
        _patients = [pseudo, ..._patients];
        populatePatientsSelect(String(userId));
      }

      // Aggiorna lo stato locale e la UI.
      state.patientUserId = String(userId);
      state.patientItem = pseudo;
      state.patientLabel = patientLabel(pseudo);

      const select = $("patientSelect");
      if (select) select.value = String(userId);

      setSelectedPatientPill();
      setPatientHint("È possibile procedere con la prenotazione per il paziente selezionato.");
      updateQueryParams();
      setSummary();
      return true;
    } catch (_) {
      return false;
    }
  }

  // Applica il filtro testuale al catalogo servizi.
  function applyServiceFilter() {
    const term = String($("serviceSearch")?.value || "").trim().toLowerCase();

    // Se non c’è alcun termine, ripristina l’intero catalogo.
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

    // Rigenera il select delle prestazioni filtrate.
    populateServiceSelect();
  }

  // Popola il select delle prestazioni in base alla lista filtrata.
  function populateServiceSelect() {
    const select = $("serviceSelect");
    if (!select) return;

    // Memorizza il valore corrente per cercare di preservarlo.
    const currentId = String(select.value || "");

    // Reinizializza il select con l’opzione di default.
    select.innerHTML = `<option value="">Selezioni una prestazione…</option>`;

    // Popola il select ordinando le prestazioni per nome.
    _filteredServices
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "it"))
      .forEach((s) => {
        const opt = document.createElement("option");
        opt.value = String(s.id);
        opt.textContent = `${s.name || "Prestazione"}${s.code ? ` — ${s.code}` : ""}`;
        select.appendChild(opt);
      });

    // Se la prestazione corrente è ancora presente, la ripristina.
    if (currentId && _filteredServices.some((x) => String(x.id) === currentId)) {
      select.value = currentId;
    }

    // Allinea lo stato interno con il select.
    syncSelectedServiceFromSelect();
  }

  // Sincronizza la prestazione selezionata nel select con lo stato interno.
  function syncSelectedServiceFromSelect() {
    const select = $("serviceSelect");
    const val = String(select?.value || "").trim();

    // Aggiorna il servizio selezionato in base all’id scelto.
    if (!val) {
      _selectedService = null;
    } else {
      _selectedService = _services.find((x) => String(x.id) === val) || null;
    }

    // Aggiorna il box dettagli prestazione.
    renderServiceDetails();

    // La disponibilità dipende anche dalla prestazione, quindi viene azzerata.
    resetAvailabilityUI("Selezioni paziente e prestazione, quindi avvii la ricerca delle disponibilità.");

    // Aggiorna l’URL e il riepilogo.
    updateQueryParams();
    setSummary();
  }

  // Aggiorna il box dei dettagli della prestazione selezionata.
  function renderServiceDetails() {
    const name = $("svcName");
    const code = $("svcCode");
    const desc = $("svcDesc");
    const price = $("svcPrice");

    // Se nessuna prestazione è selezionata, mostra i placeholder.
    if (!_selectedService) {
      if (name) name.textContent = "—";
      if (code) code.textContent = "—";
      if (desc) desc.textContent = "Selezioni una prestazione per visualizzare i dettagli.";
      if (price) price.textContent = "—";
      return;
    }

    // Se una prestazione è selezionata, mostra i dettagli disponibili.
    if (name) name.textContent = String(_selectedService.name || "—");
    if (code) code.textContent = String(_selectedService.code || "—");
    if (desc) desc.textContent = String(_selectedService.description || "—");
    if (price) price.textContent = formatMoney(_selectedService.basePriceCents, _selectedService.currency);
  }

  // Carica il catalogo prestazioni dal back-end.
  async function loadServices() {
    setSvcLoading(true);
    try {
      // Recupera il catalogo completo e aggiorna le cache locali.
      const data = await apiJson("GET", API_SERVICES);
      _services = Array.isArray(data) ? data : [];
      _filteredServices = _services.slice();

      // Popola la select e applica eventuale selezione predefinita da query string.
      populateServiceSelect();

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

  // Raggruppa gli slot per clinico, così da rendere più leggibile la vista disponibilità.
  function groupSlotsByClinician(slots) {
    const groups = new Map();

    for (const s of (Array.isArray(slots) ? slots : [])) {
      // Costruisce la chiave del gruppo in base al clinicianUserId.
      const key = String(s.clinicianUserId || "").trim() || "__unknown";
      const label = clinicianLabelFromSlot(s);

      // Se il gruppo non esiste ancora, lo inizializza.
      if (!groups.has(key)) {
        groups.set(key, { clinicianKey: key, clinicianLabel: label, slots: [] });
      }

      // Aggiunge lo slot al gruppo corretto.
      groups.get(key).slots.push(s);
    }

    // Restituisce i gruppi ordinati alfabeticamente per etichetta clinico.
    return Array.from(groups.values())
      .sort((a, b) => String(a.clinicianLabel || "").localeCompare(String(b.clinicianLabel || ""), "it"));
  }

  // Renderizza gli slot disponibili raggruppati per clinico e per giorno.
  function renderAvailability(list, selectedSlotId) {
    const host = $("availabilityHost");
    const empty = $("availabilityEmpty");
    if (!host) return;

    const items = Array.isArray(list) ? list : [];

    // Se non ci sono slot, mostra l’empty state e svuota il contenitore.
    if (!items.length) {
      if (empty) empty.classList.remove("hidden");
      host.innerHTML = "";
      return;
    }

    // Se ci sono slot, nasconde l’empty state.
    if (empty) empty.classList.add("hidden");

    // Raggruppa per clinico.
    const groups = groupSlotsByClinician(items);

    host.innerHTML = groups.map((g) => {
      // Determina l’intestazione del gruppo clinico.
      const clinicianHeader = (g.clinicianLabel && g.clinicianLabel !== "—")
        ? g.clinicianLabel
        : "Clinico non specificato";

      // Raggruppa gli slot del clinico per giorno.
      const byDay = new Map();
      for (const s of g.slots) {
        const k = dayKeyLocal(s.startUtc);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(s);
      }

      // Ordina i giorni.
      const dayKeys = Array.from(byDay.keys()).sort();

      // Costruisce una card per ciascun giorno.
      const dayCards = dayKeys.map((k) => {
        const daySlots = byDay.get(k) || [];
        daySlots.sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));

        // Costruisce l’intestazione data leggibile del giorno.
        const headerDate = (() => {
          const sample = new Date(daySlots[0].startUtc);
          return sample.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" });
        })();

        // Costruisce i pulsanti selezionabili per gli slot del giorno.
        const buttons = daySlots.map((s) => {
          const id = String(s.id);
          const start = new Date(s.startUtc);
          const end = new Date(s.endUtc);

          const label =
            `${start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` +
            `–${end.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;

          // Evidenzia lo slot se è quello correntemente selezionato.
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

  // Ricerca le disponibilità in base al paziente, alla prestazione e all’intervallo selezionato.
  async function searchAvailability() {
    clearError();

    // Il paziente è obbligatorio per poter proseguire.
    if (!state.patientUserId) {
      APL.utils.toast("Selezioni un paziente per proseguire.", "error");
      return;
    }

    // Anche la prestazione è obbligatoria.
    if (!_selectedService) {
      APL.utils.toast("Selezioni una prestazione.", "error");
      return;
    }

    // Legge l’intervallo temporale richiesto.
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    // Verifica che entrambe le date siano presenti.
    if (!from || !to) {
      APL.utils.toast("Selezioni un intervallo di date valido.", "error");
      return;
    }

    setAvLoading(true);

    try {
      // Converte l’intervallo in UTC e costruisce l’URL della richiesta.
      const rr = dateRangeToUtc(from, to);
      const url = `${API_AVAILABILITY}?fromUtc=${encodeURIComponent(rr.fromUtc)}&toUtc=${encodeURIComponent(rr.toUtc)}`;

      // Recupera gli slot disponibili e azzera l’eventuale selezione precedente.
      const slots = await apiJson("GET", url);
      _slots = Array.isArray(slots) ? slots : [];
      _selectedSlot = null;

      // Renderizza gli slot e aggiorna il riepilogo.
      renderAvailability(_slots, null);
      setSummary();
    } catch (err) {
      // In caso di errore, mostra un messaggio, svuota la disponibilità e aggiorna il riepilogo.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare le disponibilità.");
      _slots = [];
      _selectedSlot = null;

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

    // Verifica nuovamente la presenza del paziente.
    if (!state.patientUserId) {
      APL.utils.toast("Selezioni un paziente.", "error");
      return;
    }

    // Verifica che siano presenti prestazione e slot selezionati.
    if (!_selectedService || !_selectedSlot) {
      APL.utils.toast("Selezioni una prestazione e uno slot disponibile.", "error");
      return;
    }

    // Legge le eventuali note inserite dall’operatore.
    const notes = String($("notes")?.value || "").trim() || null;

    // Prepara l’etichetta del clinico da mostrare nel riepilogo finale.
    const clinicianShown = clinicianLabelFromSlot(_selectedSlot);

    setConfirmLoading(true);
    try {
      // Costruisce il payload da inviare all’endpoint di booking.
      const payload = {
        patientUserId: state.patientUserId,
        slotId: _selectedSlot.id,
        serviceId: _selectedService.id,
        notes,
      };

      // Esegue la prenotazione.
      const appt = await apiJson("POST", API_BOOK, payload);

      APL.utils.toast("Prenotazione confermata.", "success");

      // Se la modale condivisa è disponibile, mostra il riepilogo finale.
      const ok = await ensureModalReady(10000);
      if (ok) {
        const bodyHtml = `
          <div class="space-y-4">
            <div class="rounded-2xl border bg-slate-50 p-4">
              <div class="text-xs font-medium text-slate-500">Dettagli prenotazione</div>
              <div class="mt-2 grid gap-2 text-sm">
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Paziente</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(state.patientLabel || "Paziente selezionato")}</span>
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
              È possibile consultare la gestione appuntamenti per verificare lo stato aggiornato.
            </div>
          </div>
        `;

        // Apre la modale conclusiva con possibilità di aprire direttamente l’appuntamento.
        APL.ui.modal.open({
          title: "Prenotazione completata",
          bodyHtml,
          actions: [
            { label: "Chiudi", kind: "secondary" },
            {
              label: "Apri appuntamento",
              kind: "primary",
              onClick: () => {
                window.location.href = `./appointments.html?appointmentId=${encodeURIComponent(String(appt.id))}`;
              }
            },
          ],
        });
      }

      // Dopo la conferma azzera lo slot selezionato e lascia la lista visualizzata.
      _selectedSlot = null;
      renderAvailability(_slots, null);
      setSummary();
    } catch (err) {
      // In caso di errore mostra il messaggio globale.
      showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      setConfirmLoading(false);
    }
  }

  // Imposta l’intervallo date iniziale della pagina.
  function initDefaultDates() {
    const from = $("fromDate");
    const to = $("toDate");

    // Calcola come default: da domani fino a 14 giorni successivi.
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

    if (from) from.value = toLocalDateInputValue(start);
    if (to) to.value = toLocalDateInputValue(end);
  }

  // Collega tutti gli eventi principali della pagina.
  function wireEvents() {
    const btnRefreshPatients = $("btnRefreshPatients");
    if (btnRefreshPatients) btnRefreshPatients.addEventListener("click", () => loadPatients());

    const patientSelect = $("patientSelect");
    if (patientSelect) patientSelect.addEventListener("change", () => syncSelectedPatientFromSelect());

    const serviceSearch = $("serviceSearch");
    if (serviceSearch) serviceSearch.addEventListener("input", () => applyServiceFilter());

    const serviceSelect = $("serviceSelect");
    if (serviceSelect) serviceSelect.addEventListener("change", () => syncSelectedServiceFromSelect());

    const btnSearch = $("btnSearchAvailability");
    if (btnSearch) btnSearch.addEventListener("click", () => searchAvailability());

    const host = $("availabilityHost");
    if (host) {
      host.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        // Intercetta il click su uno slot selezionabile.
        const btn = t.closest("button[data-slot]");
        if (!btn) return;

        const slotId = btn.getAttribute("data-slot");
        const slot = _slots.find((x) => String(x.id) === String(slotId)) || null;
        if (!slot) return;

        // Salva lo slot selezionato, ridisegna la lista e aggiorna il riepilogo.
        _selectedSlot = slot;
        renderAvailability(_slots, _selectedSlot.id);
        setSummary();
      });
    }

    const btnConfirm = $("btnConfirm");
    if (btnConfirm) btnConfirm.addEventListener("click", () => confirmBooking());
  }

  // Inizializza l’intera pagina di booking amministrativo.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Verifica che l’utente abbia il ruolo richiesto.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Inizializza date, vincoli e collegamenti eventi.
    initDefaultDates();
    setDateInputConstraints();
    wireEvents();

    // Carica inizialmente l’elenco pazienti.
    await loadPatients();

    // Se l’URL contiene un paziente preimpostato, prova a selezionarlo.
    const qsPatientId = readQueryPatientUserId();
    if (qsPatientId) {
      await ensurePatientFromQuery(qsPatientId);
      const select = $("patientSelect");
      if (select) select.value = String(qsPatientId);
      syncSelectedPatientFromSelect();
    }

    try {
      // Carica il catalogo prestazioni.
      await loadServices();
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il catalogo prestazioni.");
    }

    // Aggiorna gli elementi finali di interfaccia.
    setSelectedPatientPill();
    setSummary();
  }

  // Avvia l’inizializzazione quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
