/**
 * File: frontend/js/admin/patients.js
 *
 * Scopo
 * -----
 * Gestire il caricamento, il filtraggio, la visualizzazione e l’esportazione
 * dell’elenco pazienti nell’area amministrativa, includendo anche l’apertura
 * di un dettaglio sintetico in modale.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della pagina amministrativa
 * dedicata ai pazienti. Si integra con i moduli condivisi del front-end per
 * verificare il ruolo dell’utente autenticato, interrogare gli endpoint protetti,
 * applicare filtri lato client, aggiornare i contatori statistici ed esporre
 * azioni operative sull’anagrafica.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - caricare paginando l’elenco completo dei pazienti;
 * - mantenere uno stato locale dei dati completi e dei dati filtrati;
 * - applicare ricerca testuale e filtro per stato;
 * - aggiornare tabella, contatori, empty state e indicatori di caricamento;
 * - aprire una modale con il riepilogo del paziente selezionato;
 * - esportare in CSV l’elenco visibile.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseApiDate`,
 *   `APL.utils.parseErrorMessage`, `APL.utils.humanizeError`,
 *   `APL.utils.setLoading` e `APL.utils.toast`;
 * - interagisce con l’endpoint `/api/registry/admin/patients`;
 * - utilizza `APL.ui.modal` per mostrare il dettaglio rapido del paziente.
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

  // Endpoint base per il recupero dell’anagrafica pazienti lato amministratore.
  const API_LIST = "/api/registry/admin/patients";

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

  // Converte un importo espresso in centesimi in una stringa leggibile con valuta.
  function formatMoney(cents, currency) {
    // Trasforma il valore da centesimi a unità monetaria e lo formatta con due decimali.
    const value = (Number(cents || 0) / 100).toFixed(2);

    // Restituisce l’importo con valuta, usando EUR come fallback.
    return `${value} ${currency || "EUR"}`;
  }

  // Verifica se uno stato di pagamento rappresenta un esito confermato / concluso.
  function isConfirmedPaymentStatus(raw) {
    // Normalizza il valore per confronti case-insensitive.
    const s = String(raw || "").toLowerCase();

    // Considera confermati gli stati tipici di completamento positivo.
    return ["succeeded", "paid", "completed", "confirmed", "success"].includes(s);
  }

  // Verifica se uno stato di pagamento richiede ancora un intervento operativo.
  function isActionablePaymentStatus(raw) {
    // Normalizza il valore per confronti case-insensitive.
    const s = String(raw || "").toLowerCase();

    // Considera “gestibili” gli stati non ancora definitivamente chiusi.
    return ["created", "pending", "processing", "requires_action", "failed"].includes(s);
  }

  // Verifica se una notifica è ancora in stato preparatorio o pendente.
  function isPendingNotificationStatus(raw) {
    // Normalizza il valore per confronti case-insensitive.
    const s = String(raw || "").toLowerCase();

    // Considera pendenti gli stati non ancora finalizzati.
    return ["pending", "queued", "draft"].includes(s);
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

  // Converte un ISO UTC in una data breve leggibile.
  function fmtDate(isoUtc) {
    // Se il valore manca, usa il placeholder standard.
    if (!isoUtc) return "—";

    // Prova a interpretare il timestamp tramite la utility condivisa.
    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    // Restituisce la data formattata nel locale italiano.
    return d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
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

  // Costruisce il badge HTML che rappresenta lo stato attivo/non attivo del paziente.
  function statusPill(isActive) {
    // Se il paziente è attivo, usa una pill verde.
    if (isActive) {
      return (
        `<span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">` +
        `<span class="h-2 w-2 rounded-full bg-emerald-600"></span>` +
        `Attivo</span>`
      );
    }

    // In caso contrario, usa una pill neutra.
    return (
      `<span class="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">` +
      `<span class="h-2 w-2 rounded-full bg-slate-500"></span>` +
      `Non attivo</span>`
    );
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

  // Renderizza le righe della tabella in base alla lista ricevuta.
  function renderRows(list) {
    // Recupera il tbody della tabella.
    const tbody = $("patientsTbody");
    if (!tbody) return;

    // Normalizza l’input come array.
    const rows = Array.isArray(list) ? list : [];

    // Aggiorna sempre i contatori statistici.
    setStats(rows);

    // Se non ci sono righe, mostra l’empty state e una riga descrittiva in tabella.
    if (!rows.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    // Se esistono risultati, nasconde l’empty state.
    emptyState(false);

    // Ordina i record per cognome + nome e costruisce l’HTML della tabella.
    const html = rows
      .slice()
      .sort((a, b) => {
        const an = `${String(a.lastName || "")} ${String(a.firstName || "")}`.trim();
        const bn = `${String(b.lastName || "")} ${String(b.firstName || "")}`.trim();
        return an.localeCompare(bn, "it");
      })
      .map((p) => {
        // Estrae e normalizza i principali campi del paziente.
        const userId = String(p.userId || "");
        const firstName = escapeHtml(p.firstName || "");
        const lastName = escapeHtml(p.lastName || "");
        const fullName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : "—";

        const email = escapeHtml(p.email || "—");
        const phone = p.phone ? escapeHtml(p.phone) : "—";
        const dob = fmtDate(p.dateOfBirthUtc);
        const updated = fmtDateTime(p.updatedAtUtc);

        // Costruisce il badge di stato attivo/non attivo.
        const st = statusPill(!!p.isActive);

        // Costruisce l’URL di dettaglio completo del paziente.
        const detailUrl = new URL("./patient-detail.html", window.location.href);
        if (userId) detailUrl.searchParams.set("userId", userId);

        // Restituisce il markup della singola riga tabellare.
        return `
          <tr>
            <td class="py-4 pr-4">
              <div class="font-medium text-slate-900">${escapeHtml(fullName)}</div>
              <div class="mt-1 text-xs text-slate-500">E-mail: <span class="font-medium text-slate-700">${email}</span></div>
            </td>

            <td class="py-4 pr-4">
              <div class="text-slate-900">${email}</div>
              <div class="mt-1 text-xs text-slate-500">Telefono: <span class="font-medium text-slate-700">${phone}</span></div>
            </td>

            <td class="py-4 pr-4 text-slate-700">${escapeHtml(dob)}</td>
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

  // Normalizza una stringa per la ricerca testuale.
  function normalize(s) {
    return String(s || "").trim().toLowerCase();
  }

  // Verifica se un record paziente soddisfa la query di ricerca.
  function matchesQuery(p, q) {
    // Se la query è vuota, il record è automaticamente compatibile.
    if (!q) return true;

    // Costruisce una stringa unica contenente i campi ricercabili principali.
    const hay = [
      p?.firstName,
      p?.lastName,
      p?.email,
      p?.phone,
    ].map((x) => normalize(x)).join(" ");

    // Verifica la presenza della query normalizzata nei dati concatenati.
    return hay.includes(q);
  }

  // Applica i filtri correnti ai dati completi e aggiorna il rendering.
  function applyFiltersAndRender() {
    // Normalizza la query e recupera il filtro di stato.
    const q = normalize(_state.q);
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

  // Pianifica l’applicazione dei filtri con debounce per evitare aggiornamenti troppo frequenti.
  function scheduleFilter() {
    // Se esiste già un timer attivo, lo annulla.
    if (_debounce) clearTimeout(_debounce);

    // Pianifica un nuovo aggiornamento dopo una breve pausa.
    _debounce = setTimeout(() => {
      applyFiltersAndRender();
    }, 250);
  }

  // Cerca nei record attualmente visibili il paziente con lo userId specificato.
  function findVisibleByUserId(userId) {
    const id = String(userId || "");
    return (_visibleRows || []).find((x) => String(x.userId) === id) || null;
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

  // Costruisce il markup HTML da mostrare nella modale di dettaglio rapido del paziente.
  function detailsBodyHtml(p) {
    // Estrae e normalizza i principali campi del paziente.
    const firstName = escapeHtml(p?.firstName || "");
    const lastName = escapeHtml(p?.lastName || "");
    const fullName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : "—";

    const email = escapeHtml(p?.email || "—");
    const phone = p?.phone ? escapeHtml(p.phone) : "—";
    const dob = fmtDate(p?.dateOfBirthUtc);
    const created = fmtDateTime(p?.createdAtUtc);
    const updated = fmtDateTime(p?.updatedAtUtc);
    const st = p?.isActive ? "Attivo" : "Non attivo";

    // Restituisce il contenuto strutturato della modale.
    return `
      <div class="space-y-4">
        <div>
          <div class="text-xs font-medium text-slate-500">Paziente</div>
          <div class="mt-1 text-lg font-semibold text-slate-900">${fullName}</div>
          <div class="mt-1 text-sm text-slate-600">${email}</div>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Telefono</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${phone}</div>
          </div>
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Data di nascita</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(dob)}</div>
          </div>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Stato</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(st)}</div>
          </div>
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Aggiornato</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(updated)}</div>
          </div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Storico</div>
          <div class="mt-2 text-sm text-slate-700">
            <div>Inserimento: <span class="font-medium">${escapeHtml(created)}</span></div>
            <div class="mt-1">Ultima modifica: <span class="font-medium">${escapeHtml(updated)}</span></div>
          </div>
        </div>
      </div>
    `;
  }

  // Apre la modale di dettaglio rapido per il paziente selezionato.
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

    // Costruisce l’URL della scheda completa del paziente.
    const detailUrl = new URL("./patient-detail.html", window.location.href);
    if (row.userId) detailUrl.searchParams.set("userId", String(row.userId));

    // Apre la modale con corpo HTML e azioni contestuali.
    APL.ui.modal.open({
      title: "Dettaglio paziente",
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
    const header = ["Nome", "Cognome", "Email", "Telefono", "Data di nascita", "Stato", "Creato", "Aggiornato"];
    const lines = [header];

    // Per ogni record visibile costruisce una riga CSV con escaping corretto.
    for (const p of (Array.isArray(rows) ? rows : [])) {
      const line = [
        String(p?.firstName || ""),
        String(p?.lastName || ""),
        String(p?.email || ""),
        String(p?.phone || ""),
        fmtDate(p?.dateOfBirthUtc),
        p?.isActive ? "Attivo" : "Non attivo",
        fmtDateTime(p?.createdAtUtc),
        fmtDateTime(p?.updatedAtUtc),
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

    // Prepara un link temporaneo di download con nome file datato.
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `pazienti_${stamp}.csv`;
    a.href = URL.createObjectURL(blob);

    // Esegue programmaticamente il download.
    document.body.appendChild(a);
    a.click();

    // Rilascia l’object URL e rimuove l’elemento temporaneo.
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 250);
  }

  // Carica tutte le pagine dell’elenco pazienti fino a esaurimento o raggiungimento del limite massimo.
  async function loadAllPatients() {
    // Ripulisce eventuali errori precedenti e attiva lo stato di caricamento.
    clearError();
    setLoading(true);

    // Incrementa il contatore richieste per invalidare eventuali fetch precedenti.
    const seq = ++_requestSeq;

    try {
      const all = [];
      let skip = 0;

      // Carica i dati pagina per pagina fino a esaurimento risultati o superamento del limite configurato.
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = `${API_LIST}?skip=${skip}&take=${PAGE_SIZE}`;
        const data = await apiGet(url);

        // Se nel frattempo è partita una nuova richiesta, interrompe l’elaborazione corrente.
        if (seq !== _requestSeq) return;

        // Normalizza il chunk ricevuto e lo accumula nel dataset complessivo.
        const chunk = Array.isArray(data) ? data : [];
        all.push(...chunk);

        // Se il numero di elementi ricevuti è inferiore alla dimensione di pagina,
        // significa che non ci sono altre pagine da caricare.
        if (chunk.length < PAGE_SIZE) break;
        skip += PAGE_SIZE;
      }

      // Aggiorna il dataset completo e applica subito i filtri correnti.
      _allRows = all;
      applyFiltersAndRender();
    } catch (err) {
      // Se la richiesta corrente non è più valida, non aggiorna la UI.
      if (seq !== _requestSeq) return;

      // Mostra un messaggio errore leggibile all’utente.
      showError(APL.utils.humanizeError(err) || "Si è verificato un errore imprevisto.");
    } finally {
      // Ripristina lo stato UI solo se la richiesta conclusa è ancora quella corrente.
      if (seq === _requestSeq) setLoading(false);
    }
  }

  // Collega tutti gli handler degli eventi UI della pagina.
  function wireHandlers() {
    // Gestisce la ricerca testuale con debounce e invio immediato su Enter.
    const searchInput = $("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        _state.q = String(searchInput.value || "").trim();
        scheduleFilter();
      });

      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (_debounce) clearTimeout(_debounce);
          _state.q = String(searchInput.value || "").trim();
          applyFiltersAndRender();
        }
      });
    }

    // Gestisce il pulsante di pulizia della ricerca.
    const btnClear = $("btnClearSearch");
    if (btnClear) {
      btnClear.addEventListener("click", () => {
        const searchInput = $("searchInput");
        if (searchInput) searchInput.value = "";
        _state.q = "";
        applyFiltersAndRender();
      });
    }

    // Gestisce il cambio del filtro per stato.
    const statusSelect = $("statusSelect");
    if (statusSelect) {
      statusSelect.addEventListener("change", () => {
        _state.status = String(statusSelect.value || "all");
        applyFiltersAndRender();
      });
    }

    // Gestisce i due pulsanti di refresh elenco.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", () => loadAllPatients());

    const btnRefreshEmpty = $("btnRefreshEmpty");
    if (btnRefreshEmpty) btnRefreshEmpty.addEventListener("click", () => loadAllPatients());

    // Gestisce il pulsante di esportazione CSV.
    const btnExport = $("btnExport");
    if (btnExport) btnExport.addEventListener("click", () => downloadCsv());

    // Gestisce il click delegato sui pulsanti azione presenti nelle righe tabellari.
    const tbody = $("patientsTbody");
    if (tbody) {
      tbody.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        // Cerca il pulsante azione cliccato risalendo dal target effettivo.
        const btn = t.closest("button[data-action]");
        if (!btn) return;

        // Estrae azione e userId associati al pulsante.
        const action = btn.getAttribute("data-action") || "";
        const userId = btn.getAttribute("data-userid") || "";

        // Al momento è supportata l’apertura del dettaglio rapido in modale.
        if (action === "details") openDetailsModal(userId);
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
    await loadAllPatients();
  }

  // Avvia l’inizializzazione della pagina quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
