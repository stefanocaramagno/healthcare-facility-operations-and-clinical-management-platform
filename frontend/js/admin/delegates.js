/**
 * File: frontend/js/admin/delegates.js
 *
 * Scopo
 * -----
 * Gestire il caricamento, il filtraggio, la visualizzazione e l’esportazione
 * dell’elenco dei delegati nell’area amministrativa, includendo anche
 * l’apertura di un dettaglio sintetico in modale.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della pagina amministrativa
 * dedicata ai delegati. Si integra con i moduli condivisi del front-end per
 * verificare il ruolo dell’utente autenticato, interrogare gli endpoint protetti,
 * applicare filtri lato client, aggiornare i contatori statistici ed esporre
 * azioni operative sull’anagrafica dei delegati.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - caricare paginando l’elenco completo dei delegati;
 * - mantenere uno stato locale dei dati completi e dei dati filtrati;
 * - applicare ricerca testuale e filtro per stato;
 * - aggiornare tabella, contatori, empty state e indicatori di caricamento;
 * - aprire una modale con il riepilogo del delegato selezionato;
 * - esportare in CSV l’elenco visibile.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseApiDate`,
 *   `APL.utils.parseErrorMessage`, `APL.utils.humanizeError`,
 *   `APL.utils.setLoading` e `APL.utils.toast`;
 * - interagisce con l’endpoint `/api/registry/admin/delegates`;
 * - utilizza `APL.ui.modal` per mostrare il dettaglio rapido del delegato.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * Il caricamento dell’elenco avviene per pagine successive, con un limite massimo
 * configurato, mentre i filtri vengono applicati lato client sui dati già scaricati.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint base per il recupero dell’anagrafica dei delegati lato amministratore.
  const API_LIST = "/api/registry/admin/delegates";

  // Parametri di paginazione usati per caricare i dati in più richieste successive.
  const PAGE_SIZE = 500;
  const MAX_PAGES = 20;

  // Collezione completa dei record caricati dal back-end.
  let _allRows = [];

  // Collezione dei record effettivamente visibili dopo l’applicazione dei filtri.
  let _visibleRows = [];

  // Stato UI locale dei filtri attivi.
  let _state = {
    q: "",
    status: "all",
  };

  // Timer usato per il debounce della ricerca testuale.
  let _debounce = null;

  // Contatore incrementale usato per invalidare richieste precedenti quando parte un nuovo caricamento.
  let _requestSeq = 0;

  // Restituisce un elemento DOM tramite il suo id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel contenitore globale della pagina.
  function showError(message) {
    // Recupera il box errori dedicato alla pagina.
    const box = $("pageError");
    if (!box) return;

    // Imposta il testo del messaggio e rende visibile il contenitore.
    box.textContent = message || "Si è verificato un errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore globale degli errori.
  function clearError() {
    // Recupera il box errori dedicato alla pagina.
    const box = $("pageError");
    if (!box) return;

    // Ripristina il contenuto e lo stato visivo iniziale.
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna gli indicatori visuali di caricamento e abilita/disabilita i principali controlli UI.
  function setLoading(loading) {
    // Mostra o nasconde il badge di caricamento nella sezione risultati.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Aggiorna lo stato del pulsante di refresh principale.
    const refreshBtn = $("btnRefresh");
    if (refreshBtn) APL.utils.setLoading(refreshBtn, loading, "Aggiornamento…");

    // Aggiorna lo stato del pulsante di refresh presente nell’empty state.
    const refreshEmpty = $("btnRefreshEmpty");
    if (refreshEmpty) APL.utils.setLoading(refreshEmpty, loading, "Aggiornamento…");

    // Durante il caricamento disabilita l’esportazione per evitare inconsistenze.
    const exportBtn = $("btnExport");
    if (exportBtn) exportBtn.disabled = !!loading;

    // Disabilita temporaneamente i controlli di filtro durante il fetch.
    const searchInput = $("searchInput");
    if (searchInput) searchInput.disabled = !!loading;

    const clearBtn = $("btnClearSearch");
    if (clearBtn) clearBtn.disabled = !!loading;

    const statusSelect = $("statusSelect");
    if (statusSelect) statusSelect.disabled = !!loading;
  }

  // Mostra o nasconde il blocco di empty state.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Esegue l’escape HTML di una stringa per evitarne l’inserimento non sicuro nel markup.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Converte un timestamp ISO UTC in una data/ora leggibile.
  function fmtDateTime(isoUtc) {
    // Se il valore manca, usa il placeholder standard.
    if (!isoUtc) return "—";

    // Prova a interpretare il timestamp tramite la utility condivisa.
    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    // Restituisce data e ora formattate nel locale italiano.
    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Normalizza una stringa per la ricerca testuale, rimuovendo accenti e uniformando il case.
  function normalizeLower(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  // Esegue una GET autenticata e gestisce i principali casi applicativi di errore.
  async function apiGet(url) {
    // Invia la richiesta verso l’endpoint richiesto con header autenticati.
    const res = await APL.utils.requestJson(url, {
      headers: { Accept: "application/json", ...APL.session.authHeader() },
    });

    // Se la risposta non è positiva, gestisce i casi più importanti.
    if (!res.ok) {
      // In caso di sessione scaduta, pulisce la sessione locale e reindirizza.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // In caso di accesso non autorizzato, reindirizza alla pagina corretta.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Per gli altri errori solleva un messaggio leggibile ottenuto dal payload applicativo.
      throw new Error(APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.");
    }

    // Se la risposta è valida, restituisce direttamente il payload.
    return res.data;
  }

  // Normalizza una riga proveniente dall’API gestendo sia camelCase sia PascalCase.
  function normalizeRow(x) {
    return {
      userId: String(x?.userId ?? x?.UserId ?? ""),
      email: String(x?.email ?? x?.Email ?? ""),
      isActive: !!(x?.isActive ?? x?.IsActive),
      firstName: String(x?.firstName ?? x?.FirstName ?? ""),
      lastName: String(x?.lastName ?? x?.LastName ?? ""),
      phone: String(x?.phone ?? x?.Phone ?? ""),
      address: String(x?.address ?? x?.Address ?? ""),
      createdAtUtc: x?.createdAtUtc ?? x?.CreatedAtUtc ?? "",
      updatedAtUtc: x?.updatedAtUtc ?? x?.UpdatedAtUtc ?? "",
    };
  }

  // Costruisce il nome visualizzato del delegato.
  function delegateName(d) {
    const firstName = String(d?.firstName || "").trim();
    const lastName = String(d?.lastName || "").trim();
    const full = `${firstName} ${lastName}`.trim();

    // Se nome e cognome sono presenti, usa il nominativo completo.
    if (full) return full;

    // In assenza del nominativo, prova a usare l’e-mail.
    if (d?.email) return String(d.email);

    // Fallback standard in assenza di dati sufficienti.
    return "—";
  }

  // Costruisce il badge HTML che rappresenta lo stato attivo/non attivo del delegato.
  function statePill(active) {
    if (active) {
      return `<span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"><span class="h-2 w-2 rounded-full bg-emerald-600"></span>Attivo</span>`;
    }

    return `<span class="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"><span class="h-2 w-2 rounded-full bg-slate-500"></span>Non attivo</span>`;
  }

  // Verifica se una riga soddisfa la query di ricerca testuale corrente.
  function rowMatches(row, query) {
    // Se la query è vuota, la riga è automaticamente compatibile.
    if (!query) return true;

    // Costruisce una stringa unica contenente i campi ricercabili principali.
    const name = delegateName(row);
    const hay = normalizeLower([
      row?.firstName,
      row?.lastName,
      name,
      row?.email,
      row?.phone,
      row?.address,
      row?.userId,
    ].join(" "));

    // Verifica la presenza della query normalizzata nei dati concatenati.
    return hay.includes(query);
  }

  // Applica i filtri correnti ai dati completi e aggiorna il rendering.
  function applyFiltersAndRender() {
    // Normalizza la query di ricerca e legge il filtro di stato.
    const q = normalizeLower(_state.q || "");
    const status = String(_state.status || "all").toLowerCase();

    // Parte da una copia dei dati completi per non modificare l’array originale.
    let rows = Array.isArray(_allRows) ? _allRows.slice() : [];

    // Applica il filtro per stato attivo/non attivo.
    if (status === "active") rows = rows.filter((r) => !!r.isActive);
    if (status === "inactive") rows = rows.filter((r) => !r.isActive);

    // Applica la ricerca testuale, se presente.
    if (q) rows = rows.filter((r) => rowMatches(r, q));

    // Ordina i risultati per nome delegato.
    rows.sort((a, b) => {
      const an = normalizeLower(delegateName(a));
      const bn = normalizeLower(delegateName(b));
      return an.localeCompare(bn, "it");
    });

    // Aggiorna la cache dei record visibili e il rendering della UI.
    _visibleRows = rows;
    renderRows(rows);
    renderStats(rows);
  }

  // Aggiorna i contatori statistici sulla base della lista correntemente mostrata.
  function renderStats(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const active = list.filter((x) => !!x.isActive).length;
    const inactive = list.length - active;

    if ($("statShown")) $("statShown").textContent = String(list.length);
    if ($("statActive")) $("statActive").textContent = String(active);
    if ($("statInactive")) $("statInactive").textContent = String(inactive);
  }

  // Renderizza la tabella dell’elenco delegati.
  function renderRows(rows) {
    const tbody = $("delegatesTbody");
    if (!tbody) return;

    const list = Array.isArray(rows) ? rows : [];

    // Aggiorna la visibilità dello stato vuoto.
    emptyState(list.length === 0);

    // Se non esistono risultati, mostra una riga placeholder.
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    // Costruisce il markup di ogni riga della tabella.
    const html = list.map((d) => {
      const userId = String(d?.userId || "");
      const name = escapeHtml(delegateName(d));
      const email = escapeHtml(d?.email || "—");
      const phone = escapeHtml(d?.phone || "—");
      const address = escapeHtml(d?.address || "—");
      const updated = fmtDateTime(d?.updatedAtUtc);
      const st = statePill(!!d?.isActive);

      // Costruisce l’URL della scheda completa del delegato.
      const detailUrl = new URL("./delegate-detail.html", window.location.href);
      if (userId) detailUrl.searchParams.set("userId", userId);

      return `
        <tr>
          <td class="py-4 pr-4">
            <div class="font-medium text-slate-900">${name}</div>
            <div class="mt-1 text-xs text-slate-500 break-all">${escapeHtml(userId || "—")}</div>
          </td>

          <td class="py-4 pr-4">
            <div class="text-slate-700 break-all">${email}</div>
            <div class="mt-1 text-xs text-slate-500">${phone}</div>
          </td>

          <td class="py-4 pr-4 text-slate-700">${address}</td>
          <td class="py-4 pr-4">${st}</td>
          <td class="py-4 pr-4 text-slate-700">${escapeHtml(updated)}</td>

          <td class="py-4 text-right">
            <div class="inline-flex items-center gap-2 justify-end">
              <button type="button" data-action="details" data-userid="${escapeHtml(userId)}"
                class="h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
                Dettagli
              </button>

              <a href="${escapeHtml(detailUrl.toString())}"
                class="h-9 inline-flex items-center rounded-xl bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100">
                Apri scheda
              </a>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // Sostituisce il contenuto del tbody con il markup generato.
    tbody.innerHTML = html;
  }

  // Attende che l’API della modale condivisa sia disponibile nel namespace globale.
  async function ensureModalReady(timeoutMs = 8000) {
    const start = Date.now();

    // Attende a piccoli intervalli finché la modale non è pronta oppure scade il timeout.
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Costruisce il markup HTML da mostrare nella modale di dettaglio rapido del delegato.
  function detailsBodyHtml(d) {
    const name = escapeHtml(delegateName(d));
    const email = escapeHtml(d?.email || "—");
    const phone = escapeHtml(d?.phone || "—");
    const address = escapeHtml(d?.address || "—");
    const created = fmtDateTime(d?.createdAtUtc);
    const updated = fmtDateTime(d?.updatedAtUtc);
    const st = d?.isActive ? "Attivo" : "Non attivo";

    return `
      <div class="space-y-4">
        <div>
          <div class="text-xs font-medium text-slate-500">Delegato</div>
          <div class="mt-1 text-lg font-semibold text-slate-900">${name}</div>
          <div class="mt-1 text-sm text-slate-600">${email}</div>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Telefono</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${phone}</div>
          </div>
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Stato</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(st)}</div>
          </div>
        </div>

        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Indirizzo</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${address}</div>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Inserimento</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(created)}</div>
          </div>
          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Ultimo aggiornamento</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(updated)}</div>
          </div>
        </div>
      </div>
    `;
  }

  // Cerca nei record attualmente visibili il delegato con lo userId specificato.
  function findVisibleByUserId(userId) {
    const id = String(userId || "");
    return (_visibleRows || []).find((x) => String(x.userId) === id) || null;
  }

  // Apre la modale di dettaglio rapido per il delegato selezionato.
  async function openDetailsModal(userId) {
    const row = findVisibleByUserId(userId);

    // Se il record non è disponibile, mostra una notifica di errore.
    if (!row) {
      APL.utils.toast("Elemento non disponibile.", "error");
      return;
    }

    // Attende che la modale condivisa sia pronta.
    const ok = await ensureModalReady(8000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    // Costruisce l’URL della scheda completa del delegato.
    const detailUrl = new URL("./delegate-detail.html", window.location.href);
    if (row.userId) detailUrl.searchParams.set("userId", String(row.userId));

    // Apre la modale con corpo HTML e azioni contestuali.
    APL.ui.modal.open({
      title: "Dettaglio delegato",
      bodyHtml: detailsBodyHtml(row),
      actions: [
        { label: "Chiudi", kind: "secondary", onClick: () => APL.ui.modal.close() },
        { label: "Apri scheda", kind: "primary", onClick: () => (window.location.href = detailUrl.toString()) },
      ],
    });
  }

  // Costruisce il contenuto CSV dell’elenco da esportare.
  function buildCsv(rows) {
    const header = [
      "Nome",
      "Cognome",
      "Telefono",
      "Email",
      "Indirizzo",
      "Stato",
      "Creato",
      "Aggiornato",
    ];

    const lines = [header];

    // Per ogni record visibile costruisce una riga CSV con escaping corretto.
    for (const d of (Array.isArray(rows) ? rows : [])) {
      const line = [
        String(d?.firstName || ""),
        String(d?.lastName || ""),
        String(d?.phone || ""),
        String(d?.email || ""),
        String(d?.address || ""),
        d?.isActive ? "Attivo" : "Non attivo",
        fmtDateTime(d?.createdAtUtc),
        fmtDateTime(d?.updatedAtUtc),
      ].map((v) => {
        const s = String(v ?? "");
        const escaped = s.replaceAll('"', '""');
        return `"${escaped}"`;
      });

      lines.push(line);
    }

    // Aggiunge BOM UTF-8 per migliorare la compatibilità con fogli di calcolo.
    return "\uFEFF" + lines.map((r) => r.join(",")).join("\n");
  }

  // Avvia il download del CSV relativo ai record attualmente visibili.
  function downloadCsv() {
    // Se non esistono righe visibili, mostra una notifica e interrompe l’operazione.
    if (!_visibleRows || !_visibleRows.length) {
      APL.utils.toast("Nessun dato da esportare.", "info");
      return;
    }

    // Costruisce il contenuto CSV e il relativo Blob.
    const csv = buildCsv(_visibleRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

    // Genera un nome file comprensivo di data e ora.
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const fileName = `delegates_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.csv`;

    // Prepara un link temporaneo di download.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);

    // Esegue programmaticamente il download.
    a.click();

    // Ripulisce l’elemento temporaneo e rilascia l’object URL.
    a.remove();
    URL.revokeObjectURL(url);

    // Mostra una notifica sintetica di conferma.
    APL.utils.toast("Esportazione completata.", "success");
  }

  // Carica tutte le pagine disponibili dell’elenco delegati fino a esaurimento o raggiungimento del limite.
  async function fetchAllPages() {
    let out = [];

    // Interroga l’API pagina per pagina accumulando i risultati.
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const skip = page * PAGE_SIZE;
      const url = `${API_LIST}?skip=${skip}&take=${PAGE_SIZE}`;
      const data = await apiGet(url);

      // Normalizza i dati della pagina corrente.
      const rows = Array.isArray(data) ? data.map(normalizeRow) : [];
      out = out.concat(rows);

      // Se la pagina contiene meno elementi del previsto, non ci sono ulteriori pagine.
      if (rows.length < PAGE_SIZE) break;
    }

    return out;
  }

  // Ricarica l’intero dataset dei delegati e aggiorna la UI.
  async function reload() {
    clearError();
    setLoading(true);

    // Incrementa il contatore richieste per invalidare eventuali fetch precedenti.
    const seq = ++_requestSeq;

    try {
      // Carica tutte le pagine disponibili.
      const rows = await fetchAllPages();
      if (seq !== _requestSeq) return;

      // Aggiorna il dataset completo e applica subito i filtri correnti.
      _allRows = rows;
      applyFiltersAndRender();
    } catch (err) {
      // Se la richiesta corrente non è più valida, non aggiorna la UI.
      if (seq !== _requestSeq) return;

      // Mostra un messaggio errore leggibile all’utente.
      showError(APL.utils.humanizeError(err) || "Si è verificato un errore imprevisto.");

      // Ripristina lo stato locale come vuoto e aggiorna il rendering.
      _allRows = [];
      _visibleRows = [];
      renderRows([]);
      renderStats([]);
    } finally {
      // Ripristina lo stato UI solo se la richiesta conclusa è ancora quella corrente.
      if (seq === _requestSeq) setLoading(false);
    }
  }

  // Pianifica l’applicazione dei filtri con debounce per evitare aggiornamenti troppo frequenti.
  function scheduleFilter() {
    if (_debounce) clearTimeout(_debounce);
    _debounce = setTimeout(() => {
      applyFiltersAndRender();
    }, 250);
  }

  // Collega tutti gli handler degli eventi UI della pagina.
  function wireHandlers() {
    const searchInput = $("searchInput");
    if (searchInput) {
      // Aggiorna la query di ricerca ad ogni input, applicando debounce.
      searchInput.addEventListener("input", () => {
        _state.q = searchInput.value || "";
        scheduleFilter();
      });
    }

    const statusSelect = $("statusSelect");
    if (statusSelect) {
      // Aggiorna il filtro di stato e riesegue subito il rendering.
      statusSelect.addEventListener("change", () => {
        _state.status = statusSelect.value || "all";
        applyFiltersAndRender();
      });
    }

    const btnClearSearch = $("btnClearSearch");
    if (btnClearSearch) {
      // Ripristina la ricerca testuale e aggiorna subito i risultati.
      btnClearSearch.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        _state.q = "";
        applyFiltersAndRender();
      });
    }

    // Collega i due pulsanti di refresh elenco.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", () => reload());

    const btnRefreshEmpty = $("btnRefreshEmpty");
    if (btnRefreshEmpty) btnRefreshEmpty.addEventListener("click", () => reload());

    // Collega il pulsante di esportazione CSV.
    const btnExport = $("btnExport");
    if (btnExport) btnExport.addEventListener("click", () => downloadCsv());

    // Gestisce il click delegato sui pulsanti “Dettagli” presenti nelle righe tabellari.
    const tbody = $("delegatesTbody");
    if (tbody) {
      tbody.addEventListener("click", async (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        const btn = t.closest("button[data-action='details']");
        if (!btn) return;

        // Estrae lo userId associato alla riga e apre la modale di dettaglio.
        const userId = btn.getAttribute("data-userid") || "";
        await openDetailsModal(userId);
      });
    }
  }

  // Inizializza la pagina verificando il ruolo e avviando il caricamento dei dati.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Collega gli handler UI e carica l’elenco iniziale.
    wireHandlers();
    await reload();
  }

  // Avvia l’inizializzazione della pagina quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
