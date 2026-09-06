/**
 * File: frontend/js/delegate/reports.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina di consultazione
 * referti dell’area Delegate, consentendo al delegato di selezionare
 * un assistito delegante, verificare i permessi della delega attiva,
 * recuperare l’elenco dei referti disponibili, applicare filtri lato
 * client e utilizzare azioni di apertura, copia e download del contenuto.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `reports.html` dell’area Delegate. Coordina l’interazione tra
 * interfaccia utente, servizi API relativi a deleghe e referti
 * clinici e componenti condivisi dell’applicazione, trasformando
 * i dati documentali dell’assistito in una vista filtrabile,
 * navigabile e consultabile dal delegato autenticato.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Delegate;
 * - recuperare le deleghe disponibili del delegato autenticato;
 * - selezionare l’assistito corrente anche da query string;
 * - verificare se la delega consente la consultazione dei referti;
 * - recuperare i referti dell’assistito tramite endpoint primario o fallback;
 * - applicare filtri lato client su ricerca testuale e ordinamento;
 * - gestire i filtri temporali e i range rapidi predefiniti;
 * - aggiornare statistiche sintetiche sui documenti caricati;
 * - mostrare modali di dettaglio del referto;
 * - consentire copia e download del contenuto del referto;
 * - aggiornare dinamicamente i link contestuali verso gli appuntamenti;
 * - gestire loading, empty state ed errori globali di pagina.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.session.clearAuth()` nei casi di sessione scaduta;
 * - utilizza `APL.utils.requestJson()` come base per le chiamate API;
 * - utilizza `APL.utils.parseErrorMessage()` e `APL.utils.humanizeError()`
 *   per normalizzare i messaggi di errore;
 * - utilizza `APL.utils.toast()` per il feedback operativo all’utente;
 * - utilizza utility temporali come `APL.utils.toRomeDateInputValue()`,
 *   `APL.utils.romeTodayDateInputValue()`,
 *   `APL.utils.addDaysToDateInput()`,
 *   `APL.utils.romeDateRangeToUtc()` e
 *   `APL.utils.parseApiDate()`;
 * - utilizza `APL.ui.modal.open()` per l’apertura della modale
 *   di dettaglio referto;
 * - interagisce con gli endpoint:
 *   - `/api/registry/delegates/me/delegations`
 *   - `/api/clinical/delegates/me/reports`
 *   - `/api/clinical/delegates/me/patients/{patientUserId}/reports`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli
 * nel global scope. Lo stato locale mantiene l’elenco delle deleghe,
 * l’assistito selezionato, il sottoinsieme dei referti caricati e la
 * mappa indicizzata per id, così da supportare sia il rendering della
 * tabella sia le azioni contestuali sui singoli documenti.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Delegate";

  // Endpoint per il recupero delle deleghe del delegato autenticato.
  const API_DELEGATIONS = "/api/registry/delegates/me/delegations";

  // Endpoint primario per il recupero dei referti dell’assistito lato delegato.
  const API_REPORTS_PRIMARY = "/api/clinical/delegates/me/reports";

  // Endpoint alternativo usato come fallback quando il primario non è disponibile.
  const API_REPORTS_FALLBACK = (patientUserId) =>
    `/api/clinical/delegates/me/patients/${encodeURIComponent(String(patientUserId))}/reports`;

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) { return document.getElementById(id); }

  // Esegue l’escape HTML di una stringa prima dell’iniezione in markup dinamico.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Mostra un errore globale nel box dedicato della pagina.
  function showError(message) {
    // Recupera il contenitore degli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Imposta il messaggio con fallback coerente.
    box.textContent = message || "Errore imprevisto.";

    // Rende visibile il contenitore.
    box.classList.remove("hidden");
  }

  // Nasconde il contenitore di errore globale e ne pulisce il contenuto.
  function clearError() {
    // Recupera il contenitore degli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Pulisce il testo e nasconde il box.
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna lo stato di caricamento principale della pagina referti.
  function setLoading(loading) {
    // Mostra o nasconde il badge di caricamento globale.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Aggiorna il pulsante di refresh usando l’helper condiviso.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

    // Durante il caricamento vengono disabilitati i controlli di filtro
    // per evitare richieste concorrenti o interazioni incoerenti.
    const ids = [
      "fromDate",
      "toDate",
      "sortSelect",
      "searchInput",
      "btnLast90",
      "btnLast365",
      "btnAll",
      "btnResetFilters",
      "btnEmptyReset",
    ];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Aggiorna lo stato di caricamento dell’area deleghe/assistiti.
  function setDelegationsLoading(loading) {
    // Mostra o nasconde il badge dedicato al caricamento assistiti.
    const badge = $("delLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Disabilita selettore assistito e pulsante di refresh deleghe
    // mentre è in corso il caricamento.
    const ids = ["patientSelect", "btnReloadDelegations"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Mostra o nasconde il riquadro informativo relativo ai permessi insufficienti.
  function setPermissionBox(visible, text) {
    const box = $("permissionBox");
    const t = $("permissionText");
    if (!box || !t) return;

    // Quando il box non deve essere visibile, lo nasconde e ne pulisce il contenuto.
    if (!visible) {
      box.classList.add("hidden");
      t.textContent = "";
      return;
    }

    // Quando il box deve essere mostrato, aggiorna il testo e lo rende visibile.
    t.textContent = text || "Operazione non disponibile.";
    box.classList.remove("hidden");
  }

  // Aggiorna i link contestuali verso la pagina appuntamenti per l’assistito corrente.
  function updateAppointmentsLinks(patientUserId) {
    const a1 = $("appointmentsLink");
    const a2 = $("appointmentsLinkEmpty");

    const base = "./appointments.html";
    const href = patientUserId
      ? `${base}?patientUserId=${encodeURIComponent(String(patientUserId))}`
      : base;

    if (a1) a1.href = href;
    if (a2) a2.href = href;
  }

  // Mostra o nasconde l’empty state dell’elenco referti.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Wrapper locale dell’utility condivisa per convertire una Date nel formato input date locale.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formatta una data API in formato giorno/mese/anno per la tabella e le statistiche.
  function fmtDate(isoUtc) {
    if (!isoUtc) return "—";
    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";
    return d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  // Formatta una data API con giorno e orario per la modale di dettaglio.
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

  // Wrapper centralizzato per richieste GET JSON autenticate con gestione uniforme
  // di sessione scaduta, accesso negato ed errori applicativi.
  async function apiJson(method, url) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
    });

    if (!res.ok) {
      // Sessione non più valida: pulizia locale e redirect dedicato.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Accesso negato: redirect alla pagina dedicata.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Costruisce un errore arricchito per i restanti casi.
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

  // Attende che il sistema modale condiviso sia disponibile prima del suo utilizzo.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();

    // Effettua un polling leggero fino alla disponibilità della modale
    // oppure fino al superamento della soglia temporale.
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Legge l’intervallo di date dai filtri oppure costruisce un intervallo di default.
  function readRangeOrDefault(daysBack) {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    // Se l’utente ha specificato un intervallo valido, converte il range in UTC.
    if (from && to && to >= from) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) return { fromUtc: range.fromUtc, toUtc: range.toUtc };
    }

    // In assenza di range esplicito, usa una finestra retroattiva di default.
    const today = APL.utils.romeTodayDateInputValue();
    const startDay = APL.utils.addDaysToDateInput(today, -(daysBack || 365));
    return APL.utils.romeDateRangeToUtc(startDay, today);
  }

  // Applica rapidamente un intervallo temporale predefinito ai campi filtro.
  function applyQuickRange(kind) {
    const fromEl = $("fromDate");
    const toEl = $("toDate");
    if (!fromEl || !toEl) return;

    const today = APL.utils.romeTodayDateInputValue();

    if (kind === "last90") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -90);
      toEl.value = today;
    } else if (kind === "last365") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -365);
      toEl.value = today;
    } else if (kind === "all") {
      fromEl.value = "";
      toEl.value = "";
    }
  }

  // Riduce un contenuto testuale per la visualizzazione sintetica in tabella.
  function snippet(text, max) {
    const s = String(text || "").trim().replace(/\s+/g, " ");
    if (!s) return "—";
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  // Costruisce la pill visuale dello stato del referto.
  function statusPill(label) {
    return `<span class="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">${escapeHtml(label)}</span>`;
  }

  // Normalizza la struttura di un referto proveniente dal backend.
  function normalizeReport(x) {
    return {
      id: x?.id || x?.Id || "",
      encounterId: x?.encounterId || x?.EncounterId || "",
      clinicianUserId: x?.clinicianUserId || x?.ClinicianUserId || "",
      createdAtUtc: x?.createdAtUtc || x?.CreatedAtUtc || "",
      publishedAtUtc: x?.publishedAtUtc || x?.PublishedAtUtc || "",
      content: x?.content || x?.Content || "",
      raw: x,
    };
  }

  // Applica i filtri lato client ai referti già caricati.
  function applyClientFilters(items) {
    const q = String($("searchInput")?.value || "").trim().toLowerCase();
    const sort = String($("sortSelect")?.value || "NEWEST").toUpperCase();

    let list = Array.isArray(items) ? items.slice() : [];

    // Filtra per contenuto testuale del referto.
    if (q) {
      list = list.filter((r) => String(r.content || "").toLowerCase().includes(q));
    }

    // Ordina cronologicamente in base alla preferenza selezionata.
    list.sort((a, b) => {
      const da = new Date((a.publishedAtUtc || a.createdAtUtc) || 0).getTime();
      const db = new Date((b.publishedAtUtc || b.createdAtUtc) || 0).getTime();
      return sort === "OLDEST" ? da - db : db - da;
    });

    return list;
  }

  // Ripristina le statistiche sintetiche allo stato neutro.
  function resetStats() {
    if ($("statTotal")) $("statTotal").textContent = "—";
    if ($("statInRange")) $("statInRange").textContent = "—";
    if ($("statLatest")) $("statLatest").textContent = "—";
  }

  // Aggiorna le statistiche sintetiche mostrate nella testata della pagina.
  function setStats(allItems, shownItems) {
    const total = Array.isArray(allItems) ? allItems.length : 0;
    const inRange = Array.isArray(shownItems) ? shownItems.length : 0;

    // Determina la data del referto più recente tra quelli correntemente mostrati.
    let latest = "—";
    const byDate = (shownItems || [])
      .slice()
      .sort((a, b) => new Date((b.publishedAtUtc || b.createdAtUtc) || 0) - new Date((a.publishedAtUtc || a.createdAtUtc) || 0));
    if (byDate.length) latest = fmtDate(byDate[0].publishedAtUtc || byDate[0].createdAtUtc);

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statInRange")) $("statInRange").textContent = String(inRange);
    if ($("statLatest")) $("statLatest").textContent = String(latest);
  }

  // Scarica un contenuto testuale come file locale.
  function downloadText(filename, text) {
    const blob = new Blob([String(text || "")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    // Crea temporaneamente un link invisibile e simula il click per avviare il download.
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "referto.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Revoca l’object URL dopo un breve intervallo.
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // Copia il contenuto del referto negli appunti con fallback legacy.
  async function copyToClipboard(text) {
    const t = String(text || "");
    try {
      // Primo tentativo: Clipboard API moderna.
      await navigator.clipboard.writeText(t);
      APL.utils.toast("Copiato negli appunti.", "success");
      return;
    } catch (_) { }

    try {
      // Fallback: textarea temporanea e document.execCommand.
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      APL.utils.toast("Copiato negli appunti.", "success");
    } catch (_) {
      APL.utils.toast("Impossibile copiare.", "error");
    }
  }

  // Apre la modale di dettaglio di un referto con azioni di copia e download.
  async function openReportModal(report) {
    const ok = await ensureModalReady();
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    const when = fmtDateTime(report.publishedAtUtc || report.createdAtUtc);

    const body = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Disponibile dal</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(when)}</div>
        </div>

        <div>
          <div class="text-xs font-medium text-slate-500">Contenuto</div>
          <pre class="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800 leading-relaxed rounded-2xl border bg-white p-4 max-h-[52vh] overflow-auto">${escapeHtml(report.content || "")}</pre>
        </div>

        <div class="text-xs text-slate-600 leading-relaxed">
          Se desidera conservare una copia, utilizzi il pulsante di download.
        </div>
      </div>
    `;

    APL.ui.modal.open({
      title: "Referto",
      bodyHtml: body,
      actions: [
        {
          label: "Copia",
          kind: "secondary",
          closeOnClick: false,
          onClick: async () => {
            await copyToClipboard(report.content || "");
          },
        },
        {
          label: "Scarica",
          kind: "secondary",
          closeOnClick: false,
          onClick: async () => {
            const date = fmtDate(report.publishedAtUtc || report.createdAtUtc).replaceAll("/", "-");
            downloadText(`referto_${date}.txt`, report.content || "");
          },
        },
        { label: "Chiudi", kind: "primary", closeOnClick: true },
      ],
    });
  }

  // Stato locale della pagina.
  // Mantiene il contesto deleghe, assistito corrente e referti caricati.
  const state = {
    delegations: [],
    selectedDelegation: null,
    patientUserId: "",
    all: [],
    shown: [],
    byId: new Map(),
  };

  // Verifica se la delega è attualmente attiva anche dal punto di vista temporale.
  function isDelegationActiveNow(d) {
    if (!d) return false;
    const status = String(d.status || "").toUpperCase();
    if (status !== "ACTIVE") return false;

    const now = Date.now();
    const s = Date.parse(d.startsAtUtc || "");
    const e = Date.parse(d.endsAtUtc || "");

    if (!Number.isFinite(s) || !Number.isFinite(e)) return true;
    return now >= s && now <= e;
  }

  // Verifica se la delega corrente consente la lettura dei referti.
  // In questo contesto la consultazione è ammessa quando la delega è attiva.
  function canReadReports(d) {
    return isDelegationActiveNow(d);
  }

  // Costruisce una label leggibile per il selettore assistiti.
  function labelForDelegation(d, idx) {
    return String(d.patientDisplayName || d.patientFullName || d.patientName || `Assistito ${idx + 1}`);
  }

  // Legge dalla query string l’eventuale patientUserId iniziale.
  function readQueryPatientUserId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("patientUserId");
    return v ? String(v) : "";
  }

  // Aggiorna la UI dipendente dalla delega e dall’assistito corrente.
  function updateDelegationUI() {
    const hint = $("delegationHint");
    if (!hint) return;

    // Inizialmente nasconde il box dei permessi insufficienti.
    setPermissionBox(false, "");

    // Nessun assistito selezionato: guida l’utente alla selezione.
    if (!state.patientUserId || !state.selectedDelegation) {
      hint.textContent = "Selezioni un assistito per visualizzare l’elenco dei referti.";
      updateAppointmentsLinks("");
      return;
    }

    // Aggiorna i link contestuali verso l’agenda dell’assistito scelto.
    updateAppointmentsLinks(state.patientUserId);

    // Delega non valida o non attiva: comunica il vincolo operativo.
    if (!canReadReports(state.selectedDelegation)) {
      hint.textContent = "La delega selezionata non risulta attiva in questo momento.";
      setPermissionBox(true, "La consultazione dei referti non è disponibile per l’assistito selezionato.");
      return;
    }

    // Caso regolare: il delegato può consultare i documenti dell’assistito.
    hint.textContent = "È possibile consultare i referti dell’assistito selezionato.";
  }

  // Renderizza il corpo tabellare dei referti e aggiorna statistiche ed empty state.
  function renderRows(all, shown) {
    const tbody = $("reportsTbody");
    if (!tbody) return;

    // Nessun assistito selezionato: stato iniziale della pagina.
    if (!state.patientUserId) {
      resetStats();
      emptyState(false);
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-600">Selezioni un assistito per iniziare.</td></tr>`;
      return;
    }

    // Aggiorna le statistiche prima del rendering della tabella.
    setStats(all, shown);

    // Nessun elemento mostrabile dopo il filtraggio: mostra empty state.
    if (!shown.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

    // Costruisce le righe della tabella con pulsanti Apri e Scarica per ogni referto.
    tbody.innerHTML = shown.map((r) => {
      const date = fmtDate(r.publishedAtUtc || r.createdAtUtc);
      const doc = "Referto";
      const st = statusPill("Disponibile");
      const details = snippet(r.content, 120);

      return `
        <tr>
          <td class="py-4 pr-4 text-slate-800">${escapeHtml(date)}</td>
          <td class="py-4 pr-4 text-slate-700">${escapeHtml(doc)}</td>
          <td class="py-4 pr-4">${st}</td>
          <td class="py-4 pr-4 text-slate-600 max-w-[520px] truncate" title="${escapeHtml(details)}">${escapeHtml(details)}</td>
          <td class="py-4 text-right">
            <div class="inline-flex items-center gap-2 justify-end">
              <button type="button" data-action="open" data-id="${escapeHtml(String(r.id))}" class="${btnCls}">Apri</button>
              <button type="button" data-action="download" data-id="${escapeHtml(String(r.id))}" class="${btnCls}">Scarica</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // Recupera i referti del delegato provando prima l’endpoint primario
  // e poi, se necessario, quello di fallback.
  async function fetchReportsForDelegate(patientUserId, params) {
    const q = new URLSearchParams(params || "");
    q.set("patientUserId", String(patientUserId || ""));

    const candidates = [
      `${API_REPORTS_PRIMARY}?${q.toString()}`,
      `${API_REPORTS_FALLBACK(patientUserId)}?${new URLSearchParams(params || "").toString()}`,
    ];

    let lastErr = null;
    for (const url of candidates) {
      try {
        return await apiJson("GET", url);
      } catch (err) {
        lastErr = err;

        // Se l’endpoint non esiste o non supporta il metodo, prova il successivo.
        const st = err && typeof err.status === "number" ? err.status : 0;
        if (st === 404 || st === 405) continue;

        // Negli altri casi propaga subito l’errore.
        throw err;
      }
    }

    throw lastErr || new Error("Operazione non riuscita.");
  }

  // Carica i referti dell’assistito corrente applicando le regole di delega e i filtri attivi.
  async function loadReports() {
    clearError();

    // Se manca il contesto assistito/delega, ripristina lo stato neutro della tabella.
    if (!state.patientUserId || !state.selectedDelegation) {
      state.all = [];
      state.shown = [];
      state.byId = new Map();
      updateDelegationUI();
      renderRows([], []);
      return;
    }

    // Se la delega non consente la lettura, mostra un messaggio coerente e non interroga il backend.
    if (!canReadReports(state.selectedDelegation)) {
      state.all = [];
      state.shown = [];
      state.byId = new Map();
      updateDelegationUI();
      emptyState(false);
      resetStats();
      const tbody = $("reportsTbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-600">Consultazione non disponibile.</td></tr>`;
      return;
    }

    setLoading(true);

    try {
      // Costruisce il range temporale da applicare alla richiesta server-side.
      const { fromUtc, toUtc } = readRangeOrDefault(365);
      const params = new URLSearchParams();
      if (fromUtc) params.set("fromUtc", fromUtc);
      if (toUtc) params.set("toUtc", toUtc);

      // Recupera i referti tramite endpoint primario o fallback e li normalizza.
      const data = await fetchReportsForDelegate(state.patientUserId, params.toString());
      const list = (Array.isArray(data) ? data : []).map(normalizeReport);

      // Aggiorna lo stato locale completo e la mappa indicizzata per id.
      state.all = list;
      state.byId = new Map(list.map((x) => [String(x.id), x]));

      // Applica i filtri lato client e renderizza la tabella.
      state.shown = applyClientFilters(list);
      renderRows(state.all, state.shown);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare i referti.");
      const tbody = $("reportsTbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-600">—</td></tr>`;
      emptyState(false);
      resetStats();
    } finally {
      setLoading(false);
    }
  }

  // Ripristina i filtri ai valori iniziali standard della pagina.
  function resetFilters() {
    $("searchInput").value = "";
    $("sortSelect").value = "NEWEST";
    applyQuickRange("last365");
  }

  // Carica le deleghe del delegato e popola il selettore assistiti.
  async function loadDelegations() {
    setDelegationsLoading(true);
    clearError();

    try {
      const res = await APL.utils.requestJson(API_DELEGATIONS, {
        headers: { Accept: "application/json", ...APL.session.authHeader() },
      });

      const list = Array.isArray(res.data) ? res.data : [];
      state.delegations = list;

      const sel = $("patientSelect");
      if (!sel) return;

      sel.innerHTML = "";

      // Caso in cui il delegato non disponga di alcuna delega.
      if (!list.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "Nessuna delega disponibile";
        sel.appendChild(opt);

        state.patientUserId = "";
        state.selectedDelegation = null;

        updateDelegationUI();

        state.all = [];
        state.shown = [];
        state.byId = new Map();
        renderRows([], []);
        return;
      }

      // Inserisce un placeholder iniziale per la selezione esplicita dell’assistito.
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = "Selezionare un assistito...";
      sel.appendChild(ph);

      // Popola le opzioni del selettore con le etichette dei deleganti disponibili.
      list.forEach((d, idx) => {
        const opt = document.createElement("option");
        opt.value = String(d.patientUserId || "");
        opt.textContent = labelForDelegation(d, idx);
        sel.appendChild(opt);
      });

      // Se presente un patientUserId in query string, tenta di selezionarlo automaticamente.
      const fromQs = readQueryPatientUserId();
      const pick = (fromQs && list.some((d) => String(d.patientUserId) === fromQs))
        ? fromQs
        : "";

      sel.value = pick;

      state.patientUserId = pick;
      state.selectedDelegation = pick
        ? (list.find((x) => String(x.patientUserId) === String(pick)) || null)
        : null;

      updateDelegationUI();

      // Se il contesto selezionato consente la lettura, avvia subito il caricamento dei referti.
      if (state.patientUserId && state.selectedDelegation && canReadReports(state.selectedDelegation)) {
        await loadReports();
      } else {
        // Altrimenti ripristina la tabella allo stato coerente con l’assenza di dati.
        state.all = [];
        state.shown = [];
        state.byId = new Map();
        renderRows([], []);
      }
    } finally {
      setDelegationsLoading(false);
    }
  }

  // Collega tutti gli eventi UI della pagina ai rispettivi handler applicativi.
  function wireEvents() {
    // Refresh dell’elenco assistiti/deleghe.
    const btnReload = $("btnReloadDelegations");
    if (btnReload) btnReload.addEventListener("click", loadDelegations);

    // Cambio assistito selezionato: aggiorna query string, contesto e referti.
    const sel = $("patientSelect");
    if (sel) {
      sel.addEventListener("change", async () => {
        const pick = String(sel.value || "").trim();

        state.patientUserId = pick;
        state.selectedDelegation = state.delegations.find((x) => String(x.patientUserId) === String(pick)) || null;

        const qs = new URLSearchParams(window.location.search || "");
        if (state.patientUserId) qs.set("patientUserId", state.patientUserId);
        else qs.delete("patientUserId");
        const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}`;
        window.history.replaceState({}, "", next);

        updateDelegationUI();

        await loadReports();
      });
    }

    // Refresh manuale della tabella referti.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", loadReports);

    // Range rapidi predefiniti con relativo ricaricamento dei dati.
    const btnLast90 = $("btnLast90");
    if (btnLast90) btnLast90.addEventListener("click", () => { applyQuickRange("last90"); loadReports(); });

    const btnLast365 = $("btnLast365");
    if (btnLast365) btnLast365.addEventListener("click", () => { applyQuickRange("last365"); loadReports(); });

    const btnAll = $("btnAll");
    if (btnAll) btnAll.addEventListener("click", () => { applyQuickRange("all"); loadReports(); });

    // Ripristino dei filtri standard dalla toolbar principale.
    const btnReset = $("btnResetFilters");
    if (btnReset) btnReset.addEventListener("click", () => { resetFilters(); loadReports(); });

    // Ripristino dei filtri standard dallo stato vuoto.
    const btnEmptyReset = $("btnEmptyReset");
    if (btnEmptyReset) btnEmptyReset.addEventListener("click", () => { resetFilters(); loadReports(); });

    // Ricerca testuale lato client sul contenuto già caricato.
    const search = $("searchInput");
    if (search) {
      search.addEventListener("input", () => {
        state.shown = applyClientFilters(state.all);
        renderRows(state.all, state.shown);
      });
    }

    // Cambio ordinamento lato client.
    const sort = $("sortSelect");
    if (sort) {
      sort.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderRows(state.all, state.shown);
      });
    }

    // Cambio intervallo temporale con ricaricamento server-side dei dati.
    const fromDate = $("fromDate");
    const toDate = $("toDate");
    if (fromDate) fromDate.addEventListener("change", loadReports);
    if (toDate) toDate.addEventListener("change", loadReports);

    // Event delegation sui pulsanti azione della tabella referti.
    const tbody = $("reportsTbody");
    if (tbody) {
      tbody.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-action][data-id]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        if (!id) return;

        const report = state.byId.get(String(id));
        if (!report) return;

        // Apertura della modale di dettaglio del referto.
        if (action === "open") {
          await openReportModal(report);
          return;
        }

        // Download diretto del contenuto del referto.
        if (action === "download") {
          const date = fmtDate(report.publishedAtUtc || report.createdAtUtc).replaceAll("/", "-");
          downloadText(`referto_${date}.txt`, report.content || "");
          return;
        }
      });
    }
  }

  // Inizializza la pagina referti del delegato.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Delegate.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Imposta il range temporale iniziale standard e i link contestuali neutri.
    applyQuickRange("last365");
    updateAppointmentsLinks("");

    // Collega gli eventi della UI e avvia il caricamento delle deleghe.
    wireEvents();
    await loadDelegations();
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
