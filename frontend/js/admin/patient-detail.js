/**
 * File: frontend/js/admin/patient-detail.js
 *
 * Scopo
 * -----
 * Gestire il caricamento, la visualizzazione e l’aggiornamento della scheda
 * amministrativa del paziente, includendo anagrafica, consensi, deleghe e,
 * quando previsto, la creazione iniziale del nuovo profilo paziente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della pagina di dettaglio
 * paziente nell’area Admin. Si integra con i moduli condivisi del front-end
 * per verificare il ruolo dell’utente autenticato, interrogare gli endpoint
 * protetti, popolare le varie sezioni della pagina e gestire le operazioni
 * di salvataggio e aggiornamento.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - determinare la modalità operativa della pagina (creazione o dettaglio);
 * - caricare profilo, deleghe e consensi del paziente;
 * - popolare la UI con i dati correnti;
 * - consentire la creazione di un nuovo paziente;
 * - consentire il salvataggio dell’anagrafica e dei consensi;
 * - consentire la creazione e l’aggiornamento delle deleghe;
 * - gestire stati di caricamento, errori globali e messaggi contestuali.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseApiDate`,
 *   `APL.utils.parseErrorMessage`, `APL.utils.humanizeError`,
 *   `APL.utils.toRomeDateInputValue`, `APL.utils.readQuery`,
 *   `APL.utils.setLoading` e `APL.utils.toast`;
 * - interagisce con gli endpoint:
 *   `/api/registry/admin/patients`,
 *   `/api/registry/admin/patients/{userId}/profile`,
 *   `/api/registry/admin/patients/{userId}/delegations`,
 *   `/api/registry/admin/patients/{userId}/consents`,
 *   `/api/registry/admin/delegations/{delegationId}/status`,
 *   `/api/registry/admin/delegations/{delegationId}/permissions`;
 * - utilizza `APL.ui.modal` per la creazione guidata di una nuova delega.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina può operare sia in modalità di sola consultazione/modifica di una
 * scheda esistente, sia in modalità di creazione iniziale di un nuovo paziente.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint base per la creazione di un nuovo paziente.
  const API_CREATE_PATIENT = "/api/registry/admin/patients";

  // Endpoint parametrizzati per profilo, deleghe e consensi del paziente.
  const API_PATIENT_PROFILE = (userId) => `/api/registry/admin/patients/${userId}/profile`;
  const API_PATIENT_DELEGATIONS = (userId) => `/api/registry/admin/patients/${userId}/delegations`;
  const API_PATIENT_CONSENTS = (userId) => `/api/registry/admin/patients/${userId}/consents`;

  // Endpoint parametrizzati per creazione delega e aggiornamenti sulle deleghe esistenti.
  const API_CREATE_DELEGATION = (userId) => `/api/registry/admin/patients/${userId}/delegations`;
  const API_UPDATE_DELEGATION_STATUS = (delegationId) => `/api/registry/admin/delegations/${delegationId}/status`;
  const API_UPDATE_DELEGATION_PERMISSIONS = (delegationId) => `/api/registry/admin/delegations/${delegationId}/permissions`;

  // Stato locale principale della pagina.
  let _userId = "";
  let _profile = null;
  let _delegations = [];
  let _consents = [];
  let _requestSeq = 0;
  let _isCreateMode = false;

  // Restituisce un elemento DOM tramite il suo id.
  function $(id) { return document.getElementById(id); }

  // Mostra un messaggio di errore nel contenitore globale della pagina.
  function showError(message) {
    // Recupera il box errori globale.
    const box = $("pageError");
    if (!box) return;

    // Imposta il testo del messaggio e rende visibile il contenitore.
    box.textContent = message || "Si è verificato un errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore globale degli errori.
  function clearError() {
    // Recupera il box errori globale.
    const box = $("pageError");
    if (!box) return;

    // Ripristina il contenuto e lo stato iniziale.
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna gli indicatori di caricamento e abilita/disabilita i pulsanti principali.
  function setLoading(loading) {
    // Mostra o nasconde il badge di caricamento nella testata della pagina.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Aggiorna l’eventuale pulsante di refresh, se presente nel markup.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

    // Durante il caricamento blocca temporaneamente le principali azioni di salvataggio.
    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) btnSaveProfile.disabled = !!loading;

    const btnSaveConsents = $("btnSaveConsents");
    if (btnSaveConsents) btnSaveConsents.disabled = !!loading;

    const btnNewDelegation = $("btnNewDelegation");
    if (btnNewDelegation) btnNewDelegation.disabled = !!loading;
  }

  // Abilita o disabilita visivamente e funzionalmente una sezione della pagina.
  function setSectionEnabled(sectionId, enabled) {
    const sec = $(sectionId);
    if (!sec) return;

    // Usa classi CSS per comunicare blocco operativo e stato attenuato.
    sec.classList.toggle("opacity-60", !enabled);
    sec.classList.toggle("pointer-events-none", !enabled);
  }

  // Normalizza una stringa che potrebbe contenere un GUID, rimuovendo spazi e graffe esterne.
  function normalizeGuidCandidate(value) {
    let v = String(value || "").trim();
    if (!v) return "";

    // Supporta anche GUID racchiusi tra graffe.
    if (v.startsWith("{") && v.endsWith("}")) v = v.slice(1, -1).trim();
    return v;
  }

  // Verifica se il valore passato rispetta il formato GUID atteso.
  function isGuid(value) {
    const v = normalizeGuidCandidate(value);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  }

  // Legge dalla query string l’identificativo del paziente usando più possibili alias.
  function readUserIdFromUrl() {
    const qs = APL.utils.readQuery();
    const keys = ["userId", "userid", "id", "patientUserId", "patientId"];

    // Scorre i nomi parametro supportati e restituisce il primo GUID valido trovato.
    for (const k of keys) {
      const raw = qs.get(k);
      const v = normalizeGuidCandidate(raw);
      if (isGuid(v)) return v;
    }

    return "";
  }

  // Determina se la pagina è stata aperta in modalità di creazione.
  function readCreateModeFromUrl() {
    const qs = APL.utils.readQuery();
    const mode = String(qs.get("mode") || "").trim().toLowerCase();
    const action = String(qs.get("action") || "").trim().toLowerCase();

    return mode === "create" || action === "create";
  }

  // Verifica la presenza del flag `created` nella query string.
  function hasCreatedFlag() {
    const qs = APL.utils.readQuery();
    const raw = String(qs.get("created") || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  }

  // Rimuove dalla URL il flag `created` dopo che è stato consumato.
  function consumeCreatedFlag() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("created")) return;

    url.searchParams.delete("created");
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  // Esegue l’escape HTML di una stringa per inserirla in sicurezza nel markup.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Converte un ISO UTC in una data breve leggibile.
  function fmtDate(isoUtc) {
    if (!isoUtc) return "—";

    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    return d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  // Converte un ISO UTC in una data/ora leggibile.
  function fmtDateTime(isoUtc) {
    if (!isoUtc) return "—";

    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Converte un timestamp ISO nel formato richiesto dagli input type="date".
  function isoToDateInput(isoUtc) {
    if (!isoUtc) return "";
    return APL.utils.toRomeDateInputValue(isoUtc);
  }

  // Converte una data HTML input in un ISO UTC all’inizio o alla fine del giorno.
  function dateInputToUtcIso(dateStr, endOfDay) {
    const s = String(dateStr || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";

    // Estrae anno, mese e giorno e costruisce un Date UTC coerente con il significato richiesto.
    const [y, m, d] = s.split("-").map((x) => Number(x));
    const dt = endOfDay
      ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59))
      : new Date(Date.UTC(y, m - 1, d, 0, 0, 0));

    return dt.toISOString();
  }

  // Esegue una richiesta JSON autenticata e gestisce i principali casi applicativi di errore.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Se la risposta non è positiva, gestisce sessione scaduta, accesso negato e altri errori.
    if (!res.ok) {
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Imposta il testo di un elemento identificato da id.
  function setText(id, value) {
    const el = $(id);
    if (!el) return;
    el.textContent = value ?? "—";
  }

  // Imposta il value di un campo di input o textarea identificato da id.
  function setValue(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value ?? "";
  }

  // Mostra o nasconde un elemento in base al valore booleano passato.
  function toggleHidden(id, hidden) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("hidden", !!hidden);
  }

  // Traduce l’ambito tecnico della delega in una descrizione leggibile.
  function scopeLabel(scope) {
    const s = String(scope || "");
    if (/^ManageAppointments$/i.test(s)) return "Gestione appuntamenti";
    if (/^ManagePayments$/i.test(s)) return "Gestione pagamenti";
    if (/^ReadOnly$/i.test(s)) return "Solo lettura";
    return "—";
  }

  // Traduce lo stato tecnico della delega in etichetta e stile semantico.
  function statusLabel(status) {
    const s = String(status || "");
    if (/^Active$/i.test(s)) return { label: "Attiva", kind: "success" };
    if (/^Pending$/i.test(s)) return { label: "In attesa", kind: "info" };
    if (/^Revoked$/i.test(s)) return { label: "Revocata", kind: "muted" };
    if (/^Expired$/i.test(s)) return { label: "Scaduta", kind: "muted" };
    return { label: "—", kind: "muted" };
  }

  // Costruisce il badge HTML che rappresenta lo stato della delega.
  function statusPill(status) {
    const { label, kind } = statusLabel(status);

    if (kind === "success") {
      return `<span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"><span class="h-2 w-2 rounded-full bg-emerald-600"></span>${escapeHtml(label)}</span>`;
    }

    if (kind === "info") {
      return `<span class="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"><span class="h-2 w-2 rounded-full bg-blue-600"></span>${escapeHtml(label)}</span>`;
    }

    return `<span class="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"><span class="h-2 w-2 rounded-full bg-slate-500"></span>${escapeHtml(label)}</span>`;
  }

  // Applica alla UI la modalità corrente della pagina: creazione o dettaglio esistente.
  function applyModeUi() {
    const subtitle = _isCreateMode
      ? "Inserimento di un nuovo paziente con creazione contestuale di account e anagrafica."
      : "Visualizzazione e gestione delle informazioni principali, delle deleghe e dei consensi.";

    // Aggiorna testi principali della pagina in base alla modalità operativa.
    setText("patientSubtitle", subtitle);
    setText("patientTitleName", _isCreateMode ? "Nuovo paziente" : "Dettaglio paziente");
    setText("patientUserId", _isCreateMode ? "Disponibile dopo la creazione" : (_userId || "—"));
    setText("patientProfileId", _isCreateMode ? "Disponibile dopo la creazione" : (_profile?.id ? String(_profile.id) : "—"));

    // Aggiorna il messaggio contestuale relativo al profilo/anagrafica.
    const profileHint = $("profileHint");
    if (profileHint) {
      profileHint.textContent = _isCreateMode
        ? "Compili i dati di accesso e l’anagrafica per registrare il nuovo paziente."
        : "Le informazioni anagrafiche non risultano ancora complete. È possibile inserirle e salvare la scheda.";
      profileHint.classList.toggle("hidden", !_isCreateMode && !!_profile);
    }

    // Aggiorna l’etichetta del pulsante principale di salvataggio.
    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) {
      btnSaveProfile.textContent = _isCreateMode ? "Crea paziente" : "Salva anagrafica";
    }

    // Aggiorna la nota informativa sulle operazioni di salvataggio.
    const notesBox = $("saveInfoText");
    if (notesBox) {
      notesBox.textContent = _isCreateMode
        ? "La registrazione crea il nuovo account paziente e l’anagrafica in un’unica operazione."
        : "Le modifiche vengono applicate solo dopo il salvataggio.";
    }

    // Attiva o disattiva le sezioni pertinenti alla modalità corrente.
    toggleHidden("accountSection", !_isCreateMode);
    toggleHidden("createModeNotice", !_isCreateMode);
    toggleHidden("btnSaveConsents", _isCreateMode);
    toggleHidden("sectionDelegations", _isCreateMode);
    toggleHidden("sectionConsents", _isCreateMode);
  }

  // Aggiorna intestazione e identificativi usando i dati del profilo corrente.
  function setHeaderFromProfile() {
    // In modalità creazione si limita a riallineare la UI standard della modalità.
    if (_isCreateMode) {
      applyModeUi();
      return;
    }

    // Costruisce il nome completo se disponibile.
    const firstName = String(_profile?.firstName || "").trim();
    const lastName = String(_profile?.lastName || "").trim();

    const titleName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : "Dettaglio paziente";
    setText("patientTitleName", titleName);

    // Aggiorna identificativo utente e identificativo profilo.
    setText("patientUserId", _userId || "—");
    setText("patientProfileId", _profile?.id ? String(_profile.id) : "—");

    // Mostra il suggerimento di completamento profilo solo quando il profilo non è disponibile.
    const hint = $("profileHint");
    if (hint) {
      hint.textContent = "Le informazioni anagrafiche non risultano ancora complete. È possibile inserirle e salvare la scheda.";
      hint.classList.toggle("hidden", !!_profile);
    }
  }

  // Compila i campi del form anagrafico con i dati del profilo corrente.
  function fillProfileForm() {
    setValue("firstName", _profile?.firstName ? String(_profile.firstName) : "");
    setValue("lastName", _profile?.lastName ? String(_profile.lastName) : "");
    setValue("dateOfBirth", _profile?.dateOfBirthUtc ? isoToDateInput(_profile.dateOfBirthUtc) : "");
    setValue("phone", _profile?.phone ? String(_profile.phone) : "");
    setValue("address", _profile?.address ? String(_profile.address) : "");

    // In modalità creazione i dati di accesso partono sempre vuoti.
    if (_isCreateMode) {
      setValue("email", "");
      setValue("password", "");
    }
  }

  // Renderizza la tabella delle deleghe associate al paziente.
  function renderDelegations() {
    const tbody = $("delegationsTbody");
    const empty = $("delegationsEmpty");
    if (!tbody) return;

    const rows = Array.isArray(_delegations) ? _delegations : [];
    if (empty) empty.classList.toggle("hidden", rows.length > 0);

    // Se non ci sono deleghe, mostra il messaggio placeholder nella tabella.
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    // Ordina le deleghe dalla più recente alla meno recente e genera il markup tabellare.
    const html = rows
      .slice()
      .sort((a, b) => (APL.utils.parseApiDate(b?.createdAtUtc)?.getTime() || 0) - (APL.utils.parseApiDate(a?.createdAtUtc)?.getTime() || 0))
      .map((d) => {
        const id = String(d?.id || "");
        const delegateId = String(d?.delegateUserId || "");
        const scope = scopeLabel(d?.scope);
        const status = String(d?.status || "");
        const startsAt = fmtDate(d?.startsAtUtc);
        const endsAt = fmtDate(d?.endsAtUtc);
        const created = fmtDateTime(d?.createdAtUtc);

        // Prepara il link alla scheda completa del delegato.
        const delegateUrl = new URL("./delegate-detail.html", window.location.href);
        if (delegateId) delegateUrl.searchParams.set("userId", delegateId);

        return `
          <tr>
            <td class="py-4 pr-4">
              <div class="font-medium text-slate-900 break-all">${escapeHtml(delegateId || "—")}</div>
              <div class="mt-1 text-xs text-slate-500">Utente delegato</div>
            </td>

            <td class="py-4 pr-4 text-slate-700">${escapeHtml(scope)}</td>

            <td class="py-4 pr-4 text-slate-700">
              <div>Dal <span class="font-medium">${escapeHtml(startsAt)}</span></div>
              <div class="mt-1">Al <span class="font-medium">${escapeHtml(endsAt)}</span></div>
            </td>

            <td class="py-4 pr-4">${statusPill(status)}</td>
            <td class="py-4 pr-4 text-slate-700">${escapeHtml(created)}</td>

            <td class="py-4 text-right">
              <div class="flex flex-wrap items-center gap-2 justify-end">
                <a href="${escapeHtml(delegateUrl.toString())}"
                  class="h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  Apri delegato
                </a>

                <select data-delegation-scope="${escapeHtml(id)}"
                  class="h-9 rounded-xl border bg-white px-3 text-xs text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  <option value="ReadOnly" ${/^ReadOnly$/i.test(String(d?.scope || "")) ? "selected" : ""}>Solo lettura</option>
                  <option value="ManageAppointments" ${/^ManageAppointments$/i.test(String(d?.scope || "")) ? "selected" : ""}>Gestione appuntamenti</option>
                  <option value="ManagePayments" ${/^ManagePayments$/i.test(String(d?.scope || "")) ? "selected" : ""}>Gestione pagamenti</option>
                </select>

                <select data-delegation-select="${escapeHtml(id)}"
                  class="h-9 rounded-xl border bg-white px-3 text-xs text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  <option value="Pending" ${/^Pending$/i.test(status) ? "selected" : ""}>In attesa</option>
                  <option value="Active" ${/^Active$/i.test(status) ? "selected" : ""}>Attiva</option>
                  <option value="Revoked" ${/^Revoked$/i.test(status) ? "selected" : ""}>Revocata</option>
                  <option value="Expired" ${/^Expired$/i.test(status) ? "selected" : ""}>Scaduta</option>
                </select>

                <button type="button" data-action="save-delegation" data-delegation-id="${escapeHtml(id)}"
                  class="h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  Aggiorna
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = html;
  }

  // Cerca un consenso specifico per tipo tra quelli correntemente caricati.
  function consentMeta(type) {
    const item = (_consents || []).find((x) => String(x?.type || "").toLowerCase() === String(type || "").toLowerCase());
    if (!item) return null;
    return item;
  }

  // Popola la sezione consensi con i dati correnti del paziente.
  function fillConsents() {
    const treatment = consentMeta("Treatment");
    const dataProcessing = consentMeta("DataProcessing");
    const marketing = consentMeta("Marketing");

    // Aggiorna il consenso al trattamento sanitario.
    if ($("consentTreatment")) $("consentTreatment").checked = !!treatment?.granted;
    if ($("notesTreatment")) $("notesTreatment").value = treatment?.notes ? String(treatment.notes) : "";
    if ($("metaTreatment")) $("metaTreatment").textContent = treatment ? fmtDateTime(treatment?.grantedAtUtc || treatment?.createdAtUtc) : "—";

    // Aggiorna il consenso al trattamento dati.
    if ($("consentDataProcessing")) $("consentDataProcessing").checked = !!dataProcessing?.granted;
    if ($("notesDataProcessing")) $("notesDataProcessing").value = dataProcessing?.notes ? String(dataProcessing.notes) : "";
    if ($("metaDataProcessing")) $("metaDataProcessing").textContent = dataProcessing ? fmtDateTime(dataProcessing?.grantedAtUtc || dataProcessing?.createdAtUtc) : "—";

    // Aggiorna il consenso alle comunicazioni/marketing.
    if ($("consentMarketing")) $("consentMarketing").checked = !!marketing?.granted;
    if ($("notesMarketing")) $("notesMarketing").value = marketing?.notes ? String(marketing.notes) : "";
    if ($("metaMarketing")) $("metaMarketing").textContent = marketing ? fmtDateTime(marketing?.grantedAtUtc || marketing?.createdAtUtc) : "—";
  }

  // Normalizza il payload profilo proveniente dall’API gestendo sia camelCase sia PascalCase.
  function normalizeProfile(x) {
    return {
      id: x?.id ?? x?.Id ?? "",
      userId: x?.userId ?? x?.UserId ?? "",
      firstName: x?.firstName ?? x?.FirstName ?? "",
      lastName: x?.lastName ?? x?.LastName ?? "",
      dateOfBirthUtc: x?.dateOfBirthUtc ?? x?.DateOfBirthUtc ?? "",
      phone: x?.phone ?? x?.Phone ?? "",
      address: x?.address ?? x?.Address ?? "",
    };
  }

  // Normalizza il payload delega proveniente dall’API.
  function normalizeDelegation(x) {
    return {
      id: x?.id ?? x?.Id ?? "",
      patientUserId: x?.patientUserId ?? x?.PatientUserId ?? "",
      delegateUserId: x?.delegateUserId ?? x?.DelegateUserId ?? "",
      scope: x?.scope ?? x?.Scope ?? "",
      status: x?.status ?? x?.Status ?? "",
      startsAtUtc: x?.startsAtUtc ?? x?.StartsAtUtc ?? "",
      endsAtUtc: x?.endsAtUtc ?? x?.EndsAtUtc ?? "",
      createdAtUtc: x?.createdAtUtc ?? x?.CreatedAtUtc ?? "",
    };
  }

  // Normalizza il payload consenso proveniente dall’API.
  function normalizeConsent(x) {
    return {
      id: x?.id ?? x?.Id ?? "",
      patientUserId: x?.patientUserId ?? x?.PatientUserId ?? "",
      type: x?.type ?? x?.Type ?? "",
      granted: !!(x?.granted ?? x?.Granted),
      grantedAtUtc: x?.grantedAtUtc ?? x?.GrantedAtUtc ?? "",
      revokedAtUtc: x?.revokedAtUtc ?? x?.RevokedAtUtc ?? "",
      notes: x?.notes ?? x?.Notes ?? "",
      createdAtUtc: x?.createdAtUtc ?? x?.CreatedAtUtc ?? "",
    };
  }

  // Carica in parallelo profilo, deleghe e consensi del paziente corrente.
  async function loadAll() {
    const requestId = ++_requestSeq;
    clearError();
    setLoading(true);

    try {
      const [profileRaw, delegationsRaw, consentsRaw] = await Promise.all([
        apiJson("GET", API_PATIENT_PROFILE(_userId)),
        apiJson("GET", API_PATIENT_DELEGATIONS(_userId)),
        apiJson("GET", API_PATIENT_CONSENTS(_userId)),
      ]);

      // Se nel frattempo è partita un’altra richiesta, interrompe l’aggiornamento della UI.
      if (requestId !== _requestSeq) return;

      // Normalizza e salva nello stato locale i dati ricevuti.
      _profile = profileRaw ? normalizeProfile(profileRaw) : null;
      _delegations = (Array.isArray(delegationsRaw) ? delegationsRaw : []).map(normalizeDelegation);
      _consents = (Array.isArray(consentsRaw) ? consentsRaw : []).map(normalizeConsent);

      // Aggiorna la UI con i dati appena caricati.
      applyModeUi();
      setHeaderFromProfile();
      fillProfileForm();
      renderDelegations();
      fillConsents();

      // Riabilita le sezioni nel caso in cui fossero state precedentemente bloccate.
      setSectionEnabled("sectionProfile", true);
      setSectionEnabled("sectionDelegations", true);
      setSectionEnabled("sectionConsents", true);
    } catch (err) {
      if (requestId !== _requestSeq) return;

      // In caso di errore mostra un messaggio globale e blocca le sezioni operative.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la scheda del paziente.");
      setSectionEnabled("sectionProfile", false);
      setSectionEnabled("sectionDelegations", false);
      setSectionEnabled("sectionConsents", false);
    } finally {
      if (requestId === _requestSeq) {
        setLoading(false);
      }
    }
  }

  // Attende che l’API della modale condivisa sia disponibile nel namespace globale.
  async function ensureModalReady(timeoutMs = 8000) {
    const start = Date.now();

    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Apre la modale per la creazione guidata di una nuova delega.
  async function openNewDelegationModal() {
    const ok = await ensureModalReady();
    if (!ok) {
      showError("Impossibile inizializzare la finestra modale.");
      return;
    }

    // Corpo HTML della modale con campi necessari alla creazione della delega.
    const bodyHtml = `
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium text-slate-700" for="delegationDelegateId">Identificativo delegato</label>
          <input id="delegationDelegateId" type="text"
            class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="UUID del delegato" />
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700" for="delegationScope">Ambito</label>
          <select id="delegationScope"
            class="mt-2 h-11 w-full rounded-xl border bg-white px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100">
            <option value="ReadOnly">Solo lettura</option>
            <option value="ManageAppointments">Gestione appuntamenti</option>
            <option value="ManagePayments">Gestione pagamenti</option>
          </select>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium text-slate-700" for="delegationStartsAt">Validità dal</label>
            <input id="delegationStartsAt" type="date"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100" />
          </div>

          <div>
            <label class="text-sm font-medium text-slate-700" for="delegationEndsAt">Validità al</label>
            <input id="delegationEndsAt" type="date"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100" />
          </div>
        </div>

        <div class="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700 leading-relaxed">
          Inserisca l’identificativo dell’utente delegato, selezioni l’ambito dei permessi e definisca l’intervallo di validità.
        </div>
      </div>
    `;

    APL.ui.modal.open({
      title: "Nuova delega",
      bodyHtml,
      actions: [
        { label: "Annulla", kind: "secondary", closeOnClick: true },
        {
          label: "Conferma",
          kind: "primary",
          closeOnClick: false,
          onClick: async () => {
            // Legge e valida i dati inseriti nella modale.
            const read = readDelegationForm();
            if (!read.ok) {
              APL.utils.toast(read.message || "Verifichi i dati inseriti.", "error");
              return;
            }

            try {
              // Crea la delega lato server e la inserisce subito nello stato locale.
              const created = await apiJson("POST", API_CREATE_DELEGATION(_userId), read.payload);
              _delegations.unshift(normalizeDelegation(created));
              renderDelegations();
              APL.utils.toast("Delega creata correttamente.", "success");
              if (APL.ui?.modal?.close) APL.ui.modal.close();
            } catch (err) {
              APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
            }
          },
        },
      ],
    });
  }

  // Legge e valida i campi del form di creazione delega presenti nella modale.
  function readDelegationForm() {
    const delegateUserId = String(document.getElementById("delegationDelegateId")?.value || "").trim();
    const scope = String(document.getElementById("delegationScope")?.value || "").trim();
    const startsAt = String(document.getElementById("delegationStartsAt")?.value || "").trim();
    const endsAt = String(document.getElementById("delegationEndsAt")?.value || "").trim();

    // Verifica presenza e validità dei dati richiesti.
    if (!delegateUserId) return { ok: false, message: "L’identificativo del delegato è obbligatorio." };
    if (!isGuid(delegateUserId)) return { ok: false, message: "L’identificativo del delegato non è valido." };
    if (!scope) return { ok: false, message: "L’ambito della delega è obbligatorio." };
    if (!startsAt) return { ok: false, message: "La data di inizio validità è obbligatoria." };
    if (!endsAt) return { ok: false, message: "La data di fine validità è obbligatoria." };

    const startsAtUtc = dateInputToUtcIso(startsAt, false);
    const endsAtUtc = dateInputToUtcIso(endsAt, true);

    if (!startsAtUtc || !endsAtUtc) {
      return { ok: false, message: "L’intervallo di validità non è valido." };
    }

    // Valida cronologicamente l’intervallo di validità.
    const startTime = APL.utils.parseApiDate(startsAtUtc)?.getTime() ?? NaN;
    const endTime = APL.utils.parseApiDate(endsAtUtc)?.getTime() ?? NaN;

    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
      return { ok: false, message: "L’intervallo di validità non è valido." };
    }

    return { ok: true, payload: { delegateUserId, scope, startsAtUtc, endsAtUtc } };
  }

  // Legge e valida i campi del form anagrafico del paziente.
  function readProfileForm() {
    const firstName = String($("firstName")?.value || "").trim();
    const lastName = String($("lastName")?.value || "").trim();
    const dateOfBirth = String($("dateOfBirth")?.value || "").trim();
    const phone = String($("phone")?.value || "").trim();
    const address = String($("address")?.value || "").trim();

    // Verifica la presenza dei campi anagrafici obbligatori.
    if (!firstName) return { ok: false, message: "Il nome è obbligatorio." };
    if (!lastName) return { ok: false, message: "Il cognome è obbligatorio." };
    if (!dateOfBirth) return { ok: false, message: "La data di nascita è obbligatoria." };

    const dateOfBirthUtc = dateInputToUtcIso(dateOfBirth, false);
    if (!dateOfBirthUtc) return { ok: false, message: "La data di nascita non è valida." };

    return {
      ok: true,
      payload: {
        firstName,
        lastName,
        dateOfBirthUtc,
        phone: phone || null,
        address: address || null,
      },
    };
  }

  // Verifica la validità sintattica minima di un indirizzo e-mail.
  function isValidEmail(value) {
    const email = String(value || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Legge e valida i dati di accesso usati nella modalità di creazione paziente.
  function readAccountForm() {
    const email = String($("email")?.value || "").trim();
    const password = String($("password")?.value || "").trim();

    // Verifica presenza e validità minima dei dati di accesso.
    if (!email) return { ok: false, message: "L’e-mail è obbligatoria." };
    if (!isValidEmail(email)) return { ok: false, message: "L’e-mail inserita non è valida." };
    if (!password) return { ok: false, message: "La password è obbligatoria." };
    if (password.length < 8) return { ok: false, message: "La password deve contenere almeno 8 caratteri." };

    return { ok: true, payload: { email, password } };
  }

  // Salva l’anagrafica del paziente oppure crea un nuovo paziente in modalità create.
  async function saveProfile() {
    clearError();

    const btn = $("btnSaveProfile");
    if (btn) APL.utils.setLoading(btn, true, _isCreateMode ? "Creazione…" : "Salvataggio…");

    try {
      // Legge e valida i dati anagrafici.
      const profileRead = readProfileForm();
      if (!profileRead.ok) {
        APL.utils.toast(profileRead.message || "Verifichi i dati del profilo.", "error");
        return;
      }

      if (_isCreateMode) {
        // In modalità creazione legge e valida anche i dati di accesso.
        const accountRead = readAccountForm();
        if (!accountRead.ok) {
          APL.utils.toast(accountRead.message || "Verifichi i dati di accesso.", "error");
          return;
        }

        // Unisce i dati di account e profilo per creare il nuovo paziente.
        const payload = {
          ...accountRead.payload,
          ...profileRead.payload,
        };

        const created = await apiJson("POST", API_CREATE_PATIENT, payload);
        const newUserId = normalizeGuidCandidate(created?.userId ?? created?.UserId);

        // Verifica che il back-end abbia restituito un identificativo valido per proseguire.
        if (!isGuid(newUserId)) {
          throw new Error("Creazione completata ma identificativo paziente non disponibile.");
        }

        // Reindirizza alla stessa pagina in modalità dettaglio, segnalando che la creazione è appena avvenuta.
        const next = new URL(window.location.href);
        next.searchParams.delete("mode");
        next.searchParams.delete("action");
        next.searchParams.set("userId", newUserId);
        next.searchParams.set("created", "1");
        window.location.href = next.toString();
        return;
      }

      // In modalità dettaglio aggiorna l’anagrafica esistente.
      const saved = await apiJson("PUT", API_PATIENT_PROFILE(_userId), profileRead.payload);
      _profile = saved ? normalizeProfile(saved) : _profile;
      setHeaderFromProfile();
      fillProfileForm();

      APL.utils.toast("Anagrafica aggiornata correttamente.", "success");
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      if (btn) APL.utils.setLoading(btn, false);
    }
  }

  // Salva i consensi correnti del paziente.
  async function saveConsents() {
    clearError();

    const btn = $("btnSaveConsents");
    if (btn) APL.utils.setLoading(btn, true, "Salvataggio…");

    try {
      // Raccoglie dallo stato della UI i tre principali consensi gestiti dalla pagina.
      const payload = {
        consents: [
          { type: "Treatment", granted: !!$("consentTreatment")?.checked, notes: String($("notesTreatment")?.value || "").trim() || null },
          { type: "DataProcessing", granted: !!$("consentDataProcessing")?.checked, notes: String($("notesDataProcessing")?.value || "").trim() || null },
          { type: "Marketing", granted: !!$("consentMarketing")?.checked, notes: String($("notesMarketing")?.value || "").trim() || null },
        ],
      };

      const saved = await apiJson("PUT", API_PATIENT_CONSENTS(_userId), payload);
      _consents = Array.isArray(saved) ? saved.map(normalizeConsent) : [];
      fillConsents();
      APL.utils.toast("Consensi aggiornati correttamente.", "success");
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      if (btn) APL.utils.setLoading(btn, false);
    }
  }

  // Cerca una delega nello stato locale a partire dal suo identificativo.
  function getDelegationById(delegationId) {
    const id = String(delegationId || "").trim();
    return (_delegations || []).find((x) => String(x?.id || "") === id) || null;
  }

  // Sostituisce nello stato locale una delega con la sua versione aggiornata.
  function mergeDelegation(delegationId, updated) {
    const id = String(delegationId || "").trim();
    const idx = (_delegations || []).findIndex((x) => String(x?.id || "") === id);
    if (idx >= 0 && updated) _delegations[idx] = normalizeDelegation(updated);
  }

  // Salva le modifiche di stato e/o permessi su una delega esistente.
  async function saveDelegationStatus(delegationId) {
    const id = String(delegationId || "").trim();
    if (!isGuid(id)) {
      APL.utils.toast("Elemento non disponibile.", "error");
      return;
    }

    const current = getDelegationById(id);
    if (!current) {
      APL.utils.toast("Elemento non disponibile.", "error");
      return;
    }

    // Recupera i due select associati alla delega per leggere stato e ambito correnti.
    const statusSelect = document.querySelector(`select[data-delegation-select="${CSS.escape(id)}"]`);
    const scopeSelect = document.querySelector(`select[data-delegation-scope="${CSS.escape(id)}"]`);

    const newStatus = String(statusSelect?.value || "").trim();
    const newScope = String(scopeSelect?.value || "").trim();

    const currentStatus = String(current?.status || "").trim();
    const currentScope = String(current?.scope || "").trim();

    const statusChanged = !!newStatus && newStatus !== currentStatus;
    const scopeChanged = !!newScope && newScope !== currentScope;

    // Se non ci sono differenze rispetto allo stato corrente, interrompe l’operazione.
    if (!statusChanged && !scopeChanged) {
      APL.utils.toast("Nessuna modifica da applicare.", "info");
      return;
    }

    const btn = document.querySelector(`button[data-action="save-delegation"][data-delegation-id="${CSS.escape(id)}"]`);
    if (btn) APL.utils.setLoading(btn, true, "Aggiornamento…");

    try {
      let latest = current;

      // Aggiorna prima i permessi, se cambiati.
      if (scopeChanged) {
        latest = await apiJson("PATCH", API_UPDATE_DELEGATION_PERMISSIONS(id), { scope: newScope });
        mergeDelegation(id, latest);
      }

      // Aggiorna poi lo stato, se cambiato.
      if (statusChanged) {
        latest = await apiJson("PATCH", API_UPDATE_DELEGATION_STATUS(id), { status: newStatus });
        mergeDelegation(id, latest);
      }

      // Riesegue il rendering della tabella per mostrare i valori aggiornati.
      renderDelegations();

      // Mostra un messaggio di conferma specifico in base al tipo di modifica applicata.
      if (scopeChanged && statusChanged) {
        APL.utils.toast("Permessi e stato aggiornati correttamente.", "success");
      } else if (scopeChanged) {
        APL.utils.toast("Permessi aggiornati correttamente.", "success");
      } else {
        APL.utils.toast("Stato aggiornato correttamente.", "success");
      }
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      if (btn) APL.utils.setLoading(btn, false);
    }
  }

  // Collega gli handler degli eventi principali della pagina.
  function wireHandlers() {
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", () => loadAll());

    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) btnSaveProfile.addEventListener("click", () => saveProfile());

    const btnSaveConsents = $("btnSaveConsents");
    if (btnSaveConsents) btnSaveConsents.addEventListener("click", () => saveConsents());

    const btnNewDelegation = $("btnNewDelegation");
    if (btnNewDelegation) btnNewDelegation.addEventListener("click", () => openNewDelegationModal());

    // Gestisce click delegato sui pulsanti presenti nella tabella deleghe.
    const tbody = $("delegationsTbody");
    if (tbody) {
      tbody.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        const btn = t.closest("button[data-action]");
        if (!btn) return;

        const action = btn.getAttribute("data-action") || "";
        const id = btn.getAttribute("data-delegation-id") || "";

        if (action === "save-delegation") saveDelegationStatus(id);
      });
    }
  }

  // Mostra lo stato “scheda non disponibile” e nasconde il contenuto principale.
  function showMissingState() {
    const missing = $("missingState");
    const main = $("mainContent");
    if (missing) missing.classList.remove("hidden");
    if (main) main.classList.add("hidden");

    // Blocca anche le sezioni operative secondarie.
    setSectionEnabled("sectionProfile", false);
    setSectionEnabled("sectionDelegations", false);
    setSectionEnabled("sectionConsents", false);
  }

  // Inizializza la pagina verificando ruolo, modalità operativa e dati da caricare.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Determina modalità create/detail e identificativo paziente dalla URL.
    _isCreateMode = readCreateModeFromUrl();
    _userId = readUserIdFromUrl();

    wireHandlers();

    if (_isCreateMode) {
      // In modalità creazione prepara la UI senza effettuare caricamenti remoti del dettaglio.
      applyModeUi();
      fillProfileForm();
      fillConsents();
      setSectionEnabled("sectionProfile", true);
      setSectionEnabled("sectionDelegations", false);
      setSectionEnabled("sectionConsents", false);
      if (hasCreatedFlag()) consumeCreatedFlag();
      return;
    }

    // Se non esiste uno userId valido in modalità dettaglio, mostra lo stato di errore contestuale.
    if (!_userId) {
      showMissingState();
      return;
    }

    // Se la pagina è stata raggiunta subito dopo una creazione, mostra il toast di conferma.
    if (hasCreatedFlag()) {
      consumeCreatedFlag();
      APL.utils.toast("Paziente registrato correttamente.", "success");
    }

    applyModeUi();
    await loadAll();
  }

  // Avvia l’inizializzazione della pagina quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
