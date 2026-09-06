/**
 * File: frontend/js/admin/clinicians.js
 *
 * Scopo
 * -----
 * Gestire il caricamento, il filtraggio, la visualizzazione e l’esportazione
 * dell’elenco dei clinici nell’area amministrativa, includendo anche l’apertura
 * di un dettaglio sintetico in modale.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della pagina amministrativa
 * dedicata ai clinici. Si integra con i moduli condivisi del front-end per
 * verificare il ruolo dell’utente autenticato, interrogare gli endpoint protetti,
 * applicare filtri lato client, aggiornare i contatori statistici ed esporre
 * azioni operative sull’anagrafica professionale.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - caricare paginando l’elenco completo dei clinici;
 * - mantenere uno stato locale dei dati completi e dei dati filtrati;
 * - applicare ricerca testuale e filtro per stato;
 * - aggiornare tabella, contatori, empty state e indicatori di caricamento;
 * - aprire una modale con il riepilogo del clinico selezionato;
 * - esportare in CSV l’elenco visibile.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseApiDate`,
 *   `APL.utils.parseErrorMessage`, `APL.utils.humanizeError`,
 *   `APL.utils.setLoading` e `APL.utils.toast`;
 * - interagisce con l’endpoint `/api/registry/admin/clinicians`;
 * - utilizza `APL.ui.modal` per mostrare il dettaglio rapido del clinico.
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

  // Endpoint base per il recupero dell’anagrafica dei clinici lato amministratore.
  const API_LIST = "/api/registry/admin/clinicians";

  // Parametri di paginazione usati per caricare i dati in più richieste successive.
  const PAGE_SIZE = 500;
  const MAX_PAGES = 20;

  // Collezione completa dei record caricati dal back-end.
  let _allRows = [];

  // Collezione dei record effettivamente visibili dopo l’applicazione dei filtri.
  let _visibleRows = [];

  // Stato UI locale dei filtri attivi.
  let _state = { q: "", status: "all" };

  // Timer usato per il debounce della ricerca testuale.
  let _debounce = null;

  // Contatore incrementale usato per invalidare richieste precedenti quando parte un nuovo caricamento.
  let _requestSeq = 0;

  // Restituisce un elemento DOM tramite il suo id.
  function $(id) { return document.getElementById(id); }

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

  // Converte un ISO UTC in una data/ora leggibile.
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

  // Costruisce il badge HTML che rappresenta lo stato attivo/non attivo del clinico.
  function statusPill(isActive) {
    // Se il clinico è attivo, usa una pill verde.
    if (isActive) {
      return `<span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"><span class="h-2 w-2 rounded-full bg-emerald-600"></span>Attivo</span>`;
    }

    // In caso contrario, usa una pill neutra.
    return `<span class="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"><span class="h-2 w-2 rounded-full bg-slate-500"></span>Non attivo</span>`;
  }

  // Aggiorna i contatori statistici in testa alla pagina sulla base della lista passata.
  function setStats(list) {
    // Normalizza l’input come array.
    const rows = Array.isArray(list) ? list : [];

    // Calcola numero totale visualizzato, attivi e non attivi.
    const shown = rows.length;
    const active = rows.filter((x) => !!x.isActive).length;
    const inactive = shown - active;

    // Aggiorna i tre riquadri statistici.
    if ($("statShown")) $("statShown").textContent = String(shown);
    if ($("statActive")) $("statActive").textContent = String(active);
    if ($("statInactive")) $("statInactive").textContent = String(inactive);
  }

  // Esegue una GET autenticata e gestisce i principali casi applicativi di errore.
  async function apiGet(url) {
    // Invia la richiesta verso l’endpoint richiesto con header autenticati.
    const res = await APL.utils.requestJson(url, {
      method: "GET",
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

      // Per gli altri errori costruisce un oggetto Error arricchito con dettagli utili.
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

  // Normalizza una stringa, rimuovendo spazi iniziali/finali.
  function normalizeString(x) {
    return String(x || "").trim();
  }

  // Normalizza una stringa e la converte in lowercase per confronti case-insensitive.
  function normalizeLower(x) {
    return normalizeString(x).toLowerCase();
  }

  // Normalizza una riga proveniente dall’API gestendo sia camelCase sia PascalCase.
  function normalizeRow(raw) {
    return {
      userId: raw?.userId ?? raw?.UserId ?? "",
      email: raw?.email ?? raw?.Email ?? "",
      isActive: !!(raw?.isActive ?? raw?.IsActive),
      firstName: raw?.firstName ?? raw?.FirstName ?? "",
      lastName: raw?.lastName ?? raw?.LastName ?? "",
      phone: raw?.phone ?? raw?.Phone ?? "",
      specialty: raw?.specialty ?? raw?.Specialty ?? "",
      licenseNumber: raw?.licenseNumber ?? raw?.LicenseNumber ?? "",
      officeLocation: raw?.officeLocation ?? raw?.OfficeLocation ?? "",
      createdAtUtc: raw?.createdAtUtc ?? raw?.CreatedAtUtc ?? "",
      updatedAtUtc: raw?.updatedAtUtc ?? raw?.UpdatedAtUtc ?? "",
    };
  }

  // Costruisce il nome completo leggibile del clinico.
  function clinicianName(c) {
    // Estrae nome e cognome normalizzati.
    const firstName = normalizeString(c?.firstName);
    const lastName = normalizeString(c?.lastName);

    // Restituisce nome completo oppure placeholder se assente.
    return `${firstName} ${lastName}`.trim() || "—";
  }

  // Verifica se un record clinico soddisfa la query di ricerca.
  function matchesQuery(c, q) {
    // Se la query è vuota, il record è automaticamente compatibile.
    if (!q) return true;

    // Costruisce una stringa unica contenente i campi ricercabili principali.
    const hay = [
      c?.firstName,
      c?.lastName,
      c?.phone,
      c?.email,
      c?.specialty,
      c?.licenseNumber,
      c?.officeLocation,
    ].map((x) => normalizeLower(x)).join(" ");

    // Verifica la presenza della query normalizzata nei dati concatenati.
    return hay.includes(q);
  }

  // Applica i filtri correnti ai dati completi e aggiorna il rendering.
  function applyFiltersAndRender() {
    // Normalizza la query e recupera il filtro di stato.
    const q = normalizeLower(_state.q);
    const status = _state.status;

    // Parte da una copia dei dati completi per non modificare l’array originale.
    let rows = Array.isArray(_allRows) ? _allRows.slice() : [];

    // Applica il filtro per stato attivo/non attivo.
    if (status === "active") rows = rows.filter((x) => !!x.isActive);
    if (status === "inactive") rows = rows.filter((x) => !x.isActive);

    // Applica la ricerca testuale, se presente.
    if (q) rows = rows.filter((x) => matchesQuery(x, q));

    // Aggiorna la cache dei record visibili e il rendering della tabella.
    _visibleRows = rows;
    renderRows(_visibleRows);
  }

  // Renderizza le righe della tabella in base alla lista ricevuta.
  function renderRows(list) {
    // Recupera il tbody della tabella.
    const tbody = $("cliniciansTbody");
    if (!tbody) return;

    // Normalizza l’input come array.
    const rows = Array.isArray(list) ? list : [];

    // Aggiorna sempre i contatori statistici.
    setStats(rows);

    // Se non ci sono righe, mostra l’empty state e una riga descrittiva in tabella.
    if (!rows.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    // Se esistono risultati, nasconde l’empty state.
    emptyState(false);

    // Ordina i record per nome completo e costruisce l’HTML della tabella.
    const html = rows
      .slice()
      .sort((a, b) => {
        const an = normalizeLower(clinicianName(a));
        const bn = normalizeLower(clinicianName(b));
        return an.localeCompare(bn, "it");
      })
      .map((c) => {
        // Estrae e normalizza i principali campi del clinico.
        const userId = String(c.userId || "");
        const name = escapeHtml(clinicianName(c));
        const email = escapeHtml(c.email || "—");
        const phone = escapeHtml(c.phone || "—");
        const specialty = escapeHtml(c.specialty || "—");
        const licenseNumber = escapeHtml(c.licenseNumber || "—");
        const officeLocation = escapeHtml(c.officeLocation || "—");
        const updated = fmtDateTime(c.updatedAtUtc);
        const st = statusPill(!!c.isActive);

        // Costruisce l’URL di dettaglio completo del clinico.
        const detailUrl = new URL("./clinician-detail.html", window.location.href);
        if (userId) detailUrl.searchParams.set("userId", userId);

        // Restituisce il markup della singola riga tabellare.
        return `
          <tr>
            <td class="py-4 pr-4">
              <div class="font-medium text-slate-900">${name}</div>
              <div class="mt-1 text-xs text-slate-500">Clinico</div>
            </td>

            <td class="py-4 pr-4">
              <div class="text-slate-900">${email}</div>
              <div class="mt-1 text-xs text-slate-500">Telefono: <span class="font-medium text-slate-700">${phone}</span></div>
            </td>

            <td class="py-4 pr-4 text-slate-700">
              <div class="font-medium">${specialty}</div>
              <div class="mt-1 text-xs text-slate-500">Licenza: <span class="font-medium text-slate-700">${licenseNumber}</span></div>
            </td>

            <td class="py-4 pr-4 text-slate-700">${officeLocation}</td>
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
      })
      .join("");

    // Sostituisce l’intero contenuto del tbody con il markup generato.
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

  // Costruisce il markup HTML da mostrare nella modale di dettaglio rapido del clinico.
  function detailsBodyHtml(c) {
    // Estrae e normalizza i principali campi del clinico.
    const name = escapeHtml(clinicianName(c));
    const email = escapeHtml(c?.email || "—");
    const phone = escapeHtml(c?.phone || "—");
    const specialty = escapeHtml(c?.specialty || "—");
    const licenseNumber = escapeHtml(c?.licenseNumber || "—");
    const officeLocation = escapeHtml(c?.officeLocation || "—");
    const created = fmtDateTime(c?.createdAtUtc);
    const updated = fmtDateTime(c?.updatedAtUtc);
    const st = c?.isActive ? "Attivo" : "Non attivo";

    // Restituisce il contenuto strutturato della modale.
    return `
      <div class="space-y-4">
        <div>
          <div class="text-xs font-medium text-slate-500">Clinico</div>
          <div class="mt-1 text-lg font-semibold text-slate-900">${name}</div>
          <div class="mt-1 text-sm text-slate-600">${email}</div>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Telefono</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${phone}</div>
          </div>
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Specialità</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${specialty}</div>
          </div>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Numero licenza</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${licenseNumber}</div>
          </div>
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Sede</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${officeLocation}</div>
          </div>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Stato</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(st)}</div>
          </div>
          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Ultimo aggiornamento</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(updated)}</div>
          </div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Inserimento</div>
          <div class="mt-1 text-sm text-slate-700">
            <span class="font-medium">${escapeHtml(created)}</span>
          </div>
        </div>
      </div>
    `;
  }

  // Cerca nei record attualmente visibili il clinico con lo userId specificato.
  function findVisibleByUserId(userId) {
    const id = String(userId || "");
    return (_visibleRows || []).find((x) => String(x.userId) === id) || null;
  }

  // Apre la modale di dettaglio rapido per il clinico selezionato.
  async function openDetailsModal(userId) {
    // Cerca il record tra quelli attualmente visibili.
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

    // Costruisce l’URL della scheda completa del clinico.
    const detailUrl = new URL("./clinician-detail.html", window.location.href);
    if (row.userId) detailUrl.searchParams.set("userId", String(row.userId));

    // Apre la modale con corpo HTML e azioni contestuali.
    APL.ui.modal.open({
      title: "Dettaglio clinico",
      bodyHtml: detailsBodyHtml(row),
      actions: [
        { label: "Chiudi", kind: "secondary", onClick: () => APL.ui.modal.close() },
        { label: "Apri scheda", kind: "primary", onClick: () => (window.location.href = detailUrl.toString()) },
      ],
    });
  }

  // Costruisce il contenuto CSV dell’elenco da esportare.
  function buildCsv(rows) {
    // Definisce l’intestazione del file CSV.
    const header = [
      "Nome",
      "Cognome",
      "Telefono",
      "Email",
      "Specialità",
      "Numero licenza",
      "Sede",
      "Stato",
      "Creato",
      "Aggiornato",
    ];

    const lines = [header];

    // Per ogni record visibile costruisce una riga CSV con escaping corretto.
    for (const c of (Array.isArray(rows) ? rows : [])) {
      const line = [
        String(c?.firstName || ""),
        String(c?.lastName || ""),
        String(c?.phone || ""),
        String(c?.email || ""),
        String(c?.specialty || ""),
        String(c?.licenseNumber || ""),
        String(c?.officeLocation || ""),
        c?.isActive ? "Attivo" : "Non attivo",
        fmtDateTime(c?.createdAtUtc),
        fmtDateTime(c?.updatedAtUtc),
      ].map((v) => {
        // Escapa le virgolette interne e racchiude ogni campo tra doppi apici.
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
    const fileName = `clinicians_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.csv`;

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

  // Carica tutte le pagine disponibili dell’elenco clinici fino a esaurimento o raggiungimento del limite.
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

  // Ricarica l’intero dataset dei clinici e aggiorna la UI.
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
    } finally {
      // Ripristina lo stato UI solo se la richiesta conclusa è ancora quella corrente.
      if (seq === _requestSeq) setLoading(false);
    }
  }

  // Pianifica l’applicazione dei filtri con debounce per evitare aggiornamenti troppo frequenti.
  function scheduleFilter() {
    // Se esiste già un timer attivo, lo annulla.
    if (_debounce) clearTimeout(_debounce);

    // Pianifica un nuovo aggiornamento dopo una breve pausa.
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
    const tbody = $("cliniciansTbody");
    if (tbody) {
      tbody.addEventListener("click", async (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        // Cerca il pulsante azione cliccato risalendo dal target effettivo.
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
    // Verifica che i moduli condivisi richiesti siano disponibili.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Richiede una sessione valida con ruolo Admin.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Collega gli handler UI e carica l’elenco iniziale.
    wireHandlers();
    await reload();
  }

  // Avvia l’inizializzazione della pagina quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
