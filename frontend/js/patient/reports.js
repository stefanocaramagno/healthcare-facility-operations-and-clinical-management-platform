/**
 * File: frontend/js/patient/reports.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina referti dell’area
 * Patient, comprendendo il caricamento dei referti clinici del paziente,
 * l’applicazione dei filtri temporali e testuali, l’ordinamento dei
 * risultati, il rendering della tabella, l’apertura sicura del contenuto
 * e il download o la copia dei documenti disponibili.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `reports.html`. Coordina l’interazione tra interfaccia utente,
 * servizi API dell’area clinical e componenti condivisi dell’applicazione,
 * traducendo l’elenco dei referti restituiti dal backend in una vista
 * consultabile, filtrabile e operativamente utilizzabile dal paziente.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Patient;
 * - recuperare i referti clinici del paziente autenticato;
 * - applicare filtri per intervallo temporale, ricerca testuale e ordinamento;
 * - aggiornare le statistiche sintetiche mostrate nella pagina;
 * - renderizzare la tabella dei referti e lo stato vuoto;
 * - aprire il contenuto del referto in una modale dedicata;
 * - consentire copia negli appunti e download locale del contenuto;
 * - gestire loading, errori globali e sincronizzazione dello stato UI.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.session.clearAuth()` nei casi di sessione scaduta;
 * - utilizza `APL.utils.requestJson()` come base per le chiamate API;
 * - utilizza `APL.utils.parseErrorMessage()` e `APL.utils.humanizeError()`
 *   per normalizzare i messaggi di errore;
 * - utilizza `APL.utils.setLoading()` per aggiornare lo stato visuale del pulsante refresh;
 * - utilizza `APL.utils.toast()` per il feedback all’utente;
 * - utilizza utility temporali come `APL.utils.toRomeDateInputValue()`,
 *   `APL.utils.parseApiDate()`, `APL.utils.romeTodayDateInputValue()`,
 *   `APL.utils.addDaysToDateInput()` e `APL.utils.romeDateRangeToUtc()`;
 * - utilizza `APL.ui.modal.open()` per la consultazione estesa del referto;
 * - interagisce con l’endpoint `/api/clinical/patients/me/reports`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. I referti vengono mantenuti in uno stato locale client-side
 * per permettere filtro, ordinamento, apertura modale e download senza
 * ulteriori chiamate al backend dopo il caricamento iniziale del dataset.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Patient";

  // Endpoint per il recupero dei referti del paziente autenticato.
  const API_REPORTS = "/api/clinical/patients/me/reports";

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
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

  // Mostra un messaggio di errore nel box globale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;
    box.textContent = message || "Errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripristina lo stato normale della pagina nascondendo l’eventuale errore globale.
  function clearError() {
    const box = $("pageError");
    if (!box) return;
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna lo stato di caricamento della vista.
  // Oltre al badge, blocca temporaneamente i controlli che alterano filtro o dataset visualizzato.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

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

  // Converte una data nel formato richiesto dagli input HTML usando il fuso di Roma.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formatta una data API in rappresentazione breve per la tabella e le statistiche.
  function fmtDate(isoUtc) {
    if (!isoUtc) return "—";
    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";
    return d.toLocaleDateString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  // Formatta una data API in rappresentazione estesa per la consultazione dettagliata.
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

  // Wrapper centralizzato per richieste JSON autenticate con gestione uniforme
  // di sessione scaduta, accesso negato ed errori applicativi.
  async function apiJson(method, url) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
    });

    if (!res.ok) {
      // Sessione non più valida: pulizia locale e redirect alla schermata dedicata.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Accesso vietato: redirect alla schermata di forbidden se disponibile.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Altri errori: costruzione di un oggetto Error arricchito con metadati utili.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Attende che il sistema modale condiviso sia disponibile prima di utilizzarlo.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }
    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Mostra o nasconde lo stato vuoto della pagina in base alla presenza di risultati.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Legge l’intervallo temporale selezionato dall’utente.
  // In assenza di un intervallo valido, applica una finestra predefinita retroattiva.
  function readRangeOrDefault(daysBack) {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    if (from && to && to >= from) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) {
        return { fromUtc: range.fromUtc, toUtc: range.toUtc, fromLocal: from, toLocal: to };
      }
    }

    const today = APL.utils.romeTodayDateInputValue();
    const startDay = APL.utils.addDaysToDateInput(today, -(daysBack || 365));
    const range = APL.utils.romeDateRangeToUtc(startDay, today);
    return { fromUtc: range.fromUtc, toUtc: range.toUtc, fromLocal: "", toLocal: "" };
  }

  // Applica uno dei preset temporali disponibili nella UI.
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

  // Costruisce la pill visuale che rappresenta lo stato disponibile del referto.
  function statusPill(label) {
    return `<span class="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">${escapeHtml(label)}</span>`;
  }

  // Produce un’anteprima sintetica del contenuto testuale del referto.
  function snippet(text, max) {
    const s = String(text || "").trim().replace(/\s+/g, " ");
    if (!s) return "—";
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  // Aggiorna i riquadri statistici mostrati nella pagina.
  // Distingue tra totale complessivo caricato e sottoinsieme effettivamente mostrato.
  function setStats(allItems, shownItems) {
    const total = Array.isArray(allItems) ? allItems.length : 0;
    const inRange = Array.isArray(shownItems) ? shownItems.length : 0;

    let latest = "—";
    const byDate = (shownItems || [])
      .slice()
      .sort((a, b) => new Date((b.publishedAtUtc || b.createdAtUtc) || 0) - new Date((a.publishedAtUtc || a.createdAtUtc) || 0));
    if (byDate.length) latest = fmtDate(byDate[0].publishedAtUtc || byDate[0].createdAtUtc);

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statInRange")) $("statInRange").textContent = String(inRange);
    if ($("statLatest")) $("statLatest").textContent = String(latest);
  }

  // Normalizza il payload di un referto per gestire differenze di naming
  // tra proprietà camelCase e PascalCase provenienti dal backend.
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

  // Applica i filtri client-side sul dataset già caricato dal backend.
  // La ricerca testuale opera sul contenuto del referto, mentre l’ordinamento
  // utilizza la data di pubblicazione o, in fallback, la data di creazione.
  function applyClientFilters(items) {
    const q = String($("searchInput")?.value || "").trim().toLowerCase();
    const sort = String($("sortSelect")?.value || "NEWEST").toUpperCase();

    let list = Array.isArray(items) ? items.slice() : [];

    if (q) {
      list = list.filter((r) => {
        const hay = `${r.content || ""}`.toLowerCase();
        return hay.includes(q);
      });
    }

    list.sort((a, b) => {
      const da = new Date((a.publishedAtUtc || a.createdAtUtc) || 0).getTime();
      const db = new Date((b.publishedAtUtc || b.createdAtUtc) || 0).getTime();
      return sort === "OLDEST" ? da - db : db - da;
    });

    return list;
  }

  // Genera e avvia il download locale del contenuto del referto come file di testo.
  function downloadText(filename, text) {
    const blob = new Blob([String(text || "")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "referto.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // Copia il contenuto del referto negli appunti.
  // Tenta prima l’API Clipboard moderna e ripiega su una strategia legacy se necessario.
  async function copyToClipboard(text) {
    const t = String(text || "");
    try {
      await navigator.clipboard.writeText(t);
      APL.utils.toast("Copiato negli appunti.", "success");
      return;
    } catch (_) { }

    try {
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

  // Apre una modale con il contenuto completo del referto e le azioni disponibili
  // per copia o download del documento testuale.
  async function openReportModal(report) {
    const ok = await ensureModalReady();
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    const title = "Referto";
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
      title,
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
            const filename = `referto_${date}.txt`;
            downloadText(filename, report.content || "");
          },
        },
        { label: "Chiudi", kind: "primary", closeOnClick: true },
      ],
    });
  }

  // Renderizza le righe della tabella referti e aggiorna stato vuoto e statistiche.
  function renderRows(all, shown) {
    const tbody = $("reportsTbody");
    if (!tbody) return;

    setStats(all, shown);

    if (!shown.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

    const rows = shown.map((r) => {
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
              <button type="button" data-action="open" data-id="${escapeHtml(String(r.id))}" class="${btnCls}">
                Apri
              </button>
              <button type="button" data-action="download" data-id="${escapeHtml(String(r.id))}" class="${btnCls}">
                Scarica
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows.join("");
  }

  // Stato locale della pagina usato per conservare il dataset completo,
  // il sottoinsieme filtrato e l’accesso rapido per id ai singoli referti.
  const state = {
    all: [],
    shown: [],
    byId: new Map(),
  };

  // Carica i referti dal backend in base all’intervallo temporale selezionato,
  // aggiorna lo stato locale e rigenera la vista tabellare.
  async function loadReports() {
    clearError();
    setLoading(true);

    try {
      const { fromUtc, toUtc } = readRangeOrDefault(365);
      const params = new URLSearchParams();
      if (fromUtc) params.set("fromUtc", fromUtc);
      if (toUtc) params.set("toUtc", toUtc);

      const data = await apiJson("GET", `${API_REPORTS}?${params.toString()}`);
      const list = (Array.isArray(data) ? data : []).map(normalizeReport);

      state.all = list;
      state.byId = new Map(list.map((x) => [String(x.id), x]));

      state.shown = applyClientFilters(list);
      renderRows(state.all, state.shown);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare i referti.");
      const tbody = $("reportsTbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-600">—</td></tr>`;
      emptyState(false);
    } finally {
      setLoading(false);
    }
  }

  // Ripristina i filtri della pagina ai valori predefiniti.
  function resetFilters() {
    $("searchInput").value = "";
    $("sortSelect").value = "NEWEST";
    applyQuickRange("last365");
  }

  // Collega tutti gli eventi della pagina ai rispettivi controlli UI.
  function wireEvents() {
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", loadReports);

    const btnLast90 = $("btnLast90");
    if (btnLast90) btnLast90.addEventListener("click", () => { applyQuickRange("last90"); loadReports(); });

    const btnLast365 = $("btnLast365");
    if (btnLast365) btnLast365.addEventListener("click", () => { applyQuickRange("last365"); loadReports(); });

    const btnAll = $("btnAll");
    if (btnAll) btnAll.addEventListener("click", () => { applyQuickRange("all"); loadReports(); });

    const btnReset = $("btnResetFilters");
    if (btnReset) btnReset.addEventListener("click", () => { resetFilters(); loadReports(); });

    const btnEmptyReset = $("btnEmptyReset");
    if (btnEmptyReset) btnEmptyReset.addEventListener("click", () => { resetFilters(); loadReports(); });

    // Ricerca testuale e ordinamento operano sul dataset già caricato in memoria.
    const search = $("searchInput");
    if (search) {
      search.addEventListener("input", () => {
        state.shown = applyClientFilters(state.all);
        renderRows(state.all, state.shown);
      });
    }

    const sort = $("sortSelect");
    if (sort) {
      sort.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderRows(state.all, state.shown);
      });
    }

    // La modifica dell’intervallo temporale richiede un nuovo caricamento dal backend.
    const fromDate = $("fromDate");
    const toDate = $("toDate");
    if (fromDate) fromDate.addEventListener("change", () => loadReports());
    if (toDate) toDate.addEventListener("change", () => loadReports());

    // Event delegation sulle azioni delle righe tabellari.
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

        if (action === "open") {
          await openReportModal(report);
          return;
        }

        if (action === "download") {
          const date = fmtDate(report.publishedAtUtc || report.createdAtUtc).replaceAll("/", "-");
          downloadText(`referto_${date}.txt`, report.content || "");
          return;
        }
      });
    }
  }

  // Inizializza la pagina referti.
  // Coordina autenticazione, preset iniziali, binding degli eventi e primo caricamento.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    applyQuickRange("last365");

    wireEvents();
    await loadReports();
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
