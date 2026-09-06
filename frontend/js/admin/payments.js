/**
 * File: frontend/js/admin/payments.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina amministrativa dedicata
 * ai pagamenti, comprendendo il caricamento delle operazioni, il filtraggio
 * per periodo/stato/canale, la consultazione del dettaglio, la visualizzazione
 * delle transazioni collegate, la registrazione di pagamenti in sede,
 * la riconciliazione manuale, la simulazione dell’esito provider e
 * l’esportazione di una ricevuta testuale.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Pagamenti" dell’area
 * Admin. Si appoggia ai moduli condivisi del front-end per autenticazione,
 * sessione, richieste HTTP, utilità di formattazione, toast e modali, e dialoga
 * con gli endpoint amministrativi del dominio Payments per rappresentare e
 * governare il ciclo di vita delle operazioni economiche lato back-office.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - inizializzare filtri, scorciatoie temporali ed eventi UI della pagina;
 * - richiedere al backend la lista delle payment intents nel periodo selezionato;
 * - normalizzare le strutture dati ricevute dal backend;
 * - applicare filtri client-side su stato, provider e ricerca libera;
 * - renderizzare tabella, stato vuoto e indicatori statistici;
 * - aprire modali di dettaglio, transazioni, riconciliazione e simulazione provider;
 * - registrare un pagamento avvenuto direttamente in struttura;
 * - costruire e scaricare una ricevuta amministrativa testuale;
 * - gestire caricamenti, errori e feedback utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.toast`,
 *   `APL.utils.toRomeDateInputValue`, `APL.utils.parseApiDate`,
 *   `APL.utils.romeTodayDateInputValue`, `APL.utils.addDaysToDateInput`
 *   e `APL.utils.romeDateRangeToUtc`;
 * - utilizza `APL.ui.modal` per la visualizzazione dei dettagli e per
 *   le conferme/azioni amministrative;
 * - interagisce con gli endpoint:
 *   `/api/payments/admin/intents`,
 *   `/api/payments/admin/intents/{intentId}/transactions`,
 *   `/api/payments/admin/intents/{intentId}/reconcile`,
 *   `/api/payments/admin/intents/{intentId}/simulate-provider-outcome`,
 *   `/api/payments/admin/appointments/{appointmentId}/in-person`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina combina due sotto-flussi distinti:
 * - consultazione e governo delle operazioni di pagamento già esistenti;
 * - registrazione ex-post di pagamenti effettuati fisicamente in sede.
 */

(function () {
  "use strict";

  // Ruolo richiesto per l’accesso alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint base per il recupero delle intents lato amministrativo.
  const API_INTENTS = "/api/payments/admin/intents";

  // Endpoint base per il recupero delle transazioni associate a una intent.
  const API_TRANSACTIONS = "/api/payments/admin/intents";

  // Endpoint base per la registrazione dei pagamenti in sede.
  const API_IN_PERSON = "/api/payments/admin/appointments";

  // Endpoint base per la riconciliazione manuale di una intent.
  const API_RECONCILE = "/api/payments/admin/intents";

  // Endpoint base per simulare l’esito finale del provider.
  const API_SIMULATE_PROVIDER = "/api/payments/admin/intents";

  // Utility locale per recuperare rapidamente un nodo del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Esegue l’escape HTML di una stringa prima di inserirla dentro markup dinamico.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Mostra un errore globale di pagina nell’apposito contenitore.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    box.textContent = message || "Errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripristina il contenitore degli errori globali al suo stato nascosto.
  function clearError() {
    const box = $("pageError");
    if (!box) return;

    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna gli indicatori di caricamento e blocca temporaneamente i controlli interattivi.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Elenco dei controlli che vanno disabilitati durante operazioni asincrone,
    // così da evitare doppie azioni o cambi di filtro durante un fetch in corso.
    const ids = [
      "fromDate",
      "toDate",
      "statusSelect",
      "providerSelect",
      "searchInput",
      "btnLast30",
      "btnLast90",
      "btnLast365",
      "btnAll",
      "btnResetFilters",
      "btnEmptyReset",
      "inPersonAppointmentRef",
      "inPersonAmount",
      "inPersonMethod",
      "btnRegisterInPerson",
    ];

    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Converte una data JavaScript nel formato adatto agli input date.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formattta una data/ora API in forma leggibile per un utente italiano.
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

  // Formattta una sola data API in forma breve.
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

  // Converte un importo in centesimi in una stringa moneta leggibile.
  function formatMoney(cents, currency) {
    const value = (Number(cents || 0) / 100).toFixed(2);
    return `${value} ${currency || "EUR"}`;
  }

  // Mostra o nasconde lo stato vuoto della tabella operazioni.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione coerente degli errori.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // Se la sessione non è più valida, svuota l’autenticazione locale
      // e reindirizza verso la pagina di sessione scaduta.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Se il backend rifiuta l’accesso, indirizza l’utente verso la vista forbidden.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Per gli altri casi prova a ricostruire un messaggio applicativo dal payload restituito.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Attende che il sistema modale condiviso sia pronto prima di usarlo.
  async function ensureModalReady(timeoutMs = 9000) {
    const start = Date.now();

    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Verifica se una stringa ha forma compatibile con un UUID/GUID.
  // Serve a validare il riferimento della prestazione prima della registrazione in sede.
  function guidLike(value) {
    const s = String(value || "").trim();
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return re.test(s) ? s : null;
  }

  // Traduce lo stato tecnico del pagamento in una label utente e in una tonalità semantica.
  function statusMeta(status) {
    const s = String(status || "").toLowerCase();

    if (s === "succeeded") return { label: "Completato", tone: "emerald" };
    if (s === "failed") return { label: "Non riuscito", tone: "red" };
    if (s === "canceled" || s === "cancelled") return { label: "Annullato", tone: "slate" };
    if (s === "pending") return { label: "In elaborazione", tone: "amber" };
    if (s === "created") return { label: "Creato", tone: "blue" };

    return { label: status || "—", tone: "slate" };
  }

  // Restituisce il badge HTML che rappresenta visivamente uno stato.
  function pill(label, tone) {
    const cls =
      tone === "emerald"
        ? "bg-emerald-50 text-emerald-700"
        : tone === "red"
          ? "bg-red-50 text-red-700"
          : tone === "amber"
            ? "bg-amber-50 text-amber-800"
            : tone === "blue"
              ? "bg-blue-50 text-blue-700"
              : "bg-slate-100 text-slate-700";

    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}">${escapeHtml(label)}</span>`;
  }

  // Accorcia un riferimento lungo conservandone la parte finale, più utile nel colpo d’occhio.
  function shortRef(s) {
    const x = String(s || "");
    if (!x) return "—";
    if (x.length <= 10) return x;
    return `…${x.slice(-10)}`;
  }

  // Normalizza una payment intent proveniente dal backend in una struttura uniforme lato client.
  // Questo evita di spargere per tutta la UI differenze di naming tra payload diversi.
  function normalizeIntent(x) {
    return {
      id: x?.id || x?.Id || "",
      appointmentId: x?.appointmentId || x?.AppointmentId || "",
      amountCents: x?.amountCents ?? x?.AmountCents ?? 0,
      currency: x?.currency || x?.Currency || "EUR",
      status: x?.status || x?.Status || "",
      provider: x?.provider || x?.Provider || "",
      providerIntentId: x?.providerIntentId || x?.ProviderIntentId || "",
      idempotencyKey: x?.idempotencyKey || x?.IdempotencyKey || "",
      createdAtUtc: x?.createdAtUtc || x?.CreatedAtUtc || "",
      updatedAtUtc: x?.updatedAtUtc || x?.UpdatedAtUtc || "",
      lastTxId: x?.lastTransactionId || x?.LastTransactionId || null,
      lastTxStatus: x?.lastTransactionStatus || x?.LastTransactionStatus || null,
      lastTxProcessedAtUtc: x?.lastTransactionProcessedAtUtc || x?.LastTransactionProcessedAtUtc || null,
      lastTxAmountCents: x?.lastTransactionAmountCents ?? x?.LastTransactionAmountCents ?? null,
      raw: x,
    };
  }

  // Normalizza una transazione collegata a una payment intent.
  function normalizeTx(x) {
    return {
      id: x?.id || x?.Id || "",
      intentId: x?.intentId || x?.IntentId || "",
      providerTransactionId: x?.providerTransactionId || x?.ProviderTransactionId || "",
      status: x?.status || x?.Status || "",
      amountCents: x?.amountCents ?? x?.AmountCents ?? 0,
      processedAtUtc: x?.processedAtUtc || x?.ProcessedAtUtc || "",
      rawResponseJson: x?.rawResponseJson || x?.RawResponseJson || null,
      raw: x,
    };
  }

  // Aggiorna le statistiche sintetiche mostrate nella parte superiore della pagina.
  function setStats(list) {
    const intents = Array.isArray(list) ? list : [];

    // Per "in sospeso" vengono considerate le intents ancora create o pendenti.
    const open = intents.filter((x) => {
      const s = String(x.status || "").toLowerCase();
      return s === "created" || s === "pending";
    }).length;

    // Conta le intents concluse con successo.
    const succ = intents.filter((x) => String(x.status || "").toLowerCase() === "succeeded").length;

    if ($("statOpen")) $("statOpen").textContent = String(open);
    if ($("statSucceeded")) $("statSucceeded").textContent = String(succ);
    if ($("statTotal")) $("statTotal").textContent = String(intents.length);
  }

  // Applica filtri client-side alla lista delle operations già caricata.
  function applyClientFilters(list) {
    const statusSel = String($("statusSelect")?.value || "ALL");
    const providerSel = String($("providerSelect")?.value || "ALL");
    const term = String($("searchInput")?.value || "").trim().toLowerCase();

    let out = Array.isArray(list) ? list.slice() : [];

    // Filtro per stato.
    // Il valore OPEN non corrisponde a uno stato singolo backend, ma a un raggruppamento funzionale.
    if (statusSel !== "ALL") {
      if (statusSel === "OPEN") {
        out = out.filter((x) => {
          const s = String(x.status || "").toLowerCase();
          return s === "created" || s === "pending";
        });
      } else {
        out = out.filter((x) => String(x.status || "") === statusSel);
      }
    }

    // Filtro per provider/canale di pagamento.
    if (providerSel !== "ALL") {
      out = out.filter((x) => String(x.provider || "").toUpperCase() === providerSel.toUpperCase());
    }

    // Ricerca libera su riferimenti e metadati principali esposti all’operatore.
    if (term) {
      out = out.filter((x) => {
        const hay =
          `${x.appointmentId} ${x.providerIntentId} ${x.idempotencyKey} ${x.status} ${x.provider} ${x.lastTxStatus || ""}`.toLowerCase();
        return hay.includes(term);
      });
    }

    // Ordinamento discendente per data di ultimo aggiornamento.
    out.sort((a, b) => {
      const ta = new Date(a.updatedAtUtc || a.createdAtUtc || 0).getTime();
      const tb = new Date(b.updatedAtUtc || b.createdAtUtc || 0).getTime();
      return tb - ta;
    });

    return out;
  }

  // Stabilisce se una intent può ancora ricevere una simulazione di esito provider.
  function canSimulateProviderOutcome(intent) {
    const provider = String(intent?.provider || "").toUpperCase();
    const status = String(intent?.status || "").toUpperCase();

    // La simulazione è ammessa solo sul provider simulato e solo per stati non finali.
    if (provider !== "SIMULATED") return false;
    return status === "CREATED" || status === "PENDING";
  }

  // Renderizza la tabella delle intents e aggiorna stato vuoto e statistiche.
  function renderTable(intents) {
    const tbody = $("intentsTbody");
    if (!tbody) return;

    setStats(intents);

    // In assenza di risultati mostra una riga placeholder e attiva lo stato vuoto.
    if (!intents.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    // Classe riutilizzata dai pulsanti azione presenti in ogni riga.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

    const rows = intents.map((it) => {
      const updated = fmtDateTime(it.updatedAtUtc || it.createdAtUtc);
      const amount = formatMoney(it.amountCents, it.currency);

      const st = statusMeta(it.status);
      const stPill = pill(st.label, st.tone);

      // Costruisce una rappresentazione compatta dell’ultima transazione, se presente.
      let lastTx = "—";
      if (it.lastTxStatus || it.lastTxProcessedAtUtc) {
        const txSt = it.lastTxStatus ? statusMeta(it.lastTxStatus) : { label: "—", tone: "slate" };
        const when = it.lastTxProcessedAtUtc ? fmtDateTime(it.lastTxProcessedAtUtc) : "—";
        lastTx = `${txSt.label} · ${when}`;
      }

      const refFull = String(it.providerIntentId || it.id || "");
      const refShort = shortRef(refFull);

      // Decide se mostrare o meno l’azione di simulazione esito provider.
      const showSimulate = canSimulateProviderOutcome(it);

      return `
        <tr>
          <td class="py-4 pr-4 text-slate-800">${escapeHtml(updated)}</td>
          <td class="py-4 pr-4 text-slate-700">
            <div class="font-medium text-slate-900 truncate max-w-[260px]" title="${escapeHtml(String(it.appointmentId || ""))}">
              ${escapeHtml(String(it.appointmentId || "—"))}
            </div>
            <div class="mt-1 text-xs text-slate-600">Creato: ${escapeHtml(fmtDate(it.createdAtUtc))}</div>
          </td>
          <td class="py-4 pr-4 text-slate-700">${escapeHtml(amount)}</td>
          <td class="py-4 pr-4">${stPill}</td>
          <td class="py-4 pr-4 text-slate-600 truncate max-w-[260px]" title="${escapeHtml(lastTx)}">${escapeHtml(lastTx)}</td>
          <td class="py-4 pr-4 text-slate-600 truncate max-w-[240px]" title="${escapeHtml(refFull)}">${escapeHtml(refShort)}</td>
          <td class="py-4 text-right">
            <div class="inline-flex items-center gap-2 justify-end flex-wrap">
              <button type="button" class="${btnCls}" data-action="details" data-id="${escapeHtml(String(it.id))}">
                Dettagli
              </button>
              <button type="button" class="${btnCls}" data-action="tx" data-id="${escapeHtml(String(it.id))}">
                Transazioni
              </button>
              ${showSimulate ? `<button type="button" class="${btnCls}" data-action="simulate-provider" data-id="${escapeHtml(String(it.id))}">Esito provider</button>` : ""}
              <button type="button" class="${btnCls}" data-action="reconcile" data-id="${escapeHtml(String(it.id))}">
                Riconcilia
              </button>
              <button type="button" class="${btnCls}" data-action="receipt" data-id="${escapeHtml(String(it.id))}">
                Ricevuta
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows.join("");
  }

  // Apre una modale con il dettaglio amministrativo completo della intent selezionata.
  async function openIntentDetails(intent) {
    const ok = await ensureModalReady();
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    const currentStatus = statusMeta(intent.status);
    const lastTxStatus = intent.lastTxStatus ? statusMeta(intent.lastTxStatus) : null;

    const body = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Operazione di pagamento</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">
            ${escapeHtml(intent.providerIntentId || intent.id || "—")}
          </div>
          <div class="mt-2 text-xs text-slate-600">
            Provider: ${escapeHtml(intent.provider || "—")}
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Stato corrente</div>
            <div class="mt-2">${pill(currentStatus.label, currentStatus.tone)}</div>
          </div>

          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Importo</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(formatMoney(intent.amountCents, intent.currency))}</div>
          </div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Prenotazione / appuntamento</div>
          <div class="mt-1 text-sm font-semibold text-slate-900 break-all">${escapeHtml(intent.appointmentId || "—")}</div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Creato il</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(fmtDateTime(intent.createdAtUtc))}</div>
          </div>

          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Ultimo aggiornamento</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(fmtDateTime(intent.updatedAtUtc || intent.createdAtUtc))}</div>
          </div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Ultima transazione registrata</div>
          ${lastTxStatus
        ? `
              <div class="mt-2">${pill(lastTxStatus.label, lastTxStatus.tone)}</div>
              <div class="mt-3 grid gap-2 text-sm text-slate-700">
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Data/ora</span>
                  <span class="font-medium text-slate-900 text-right">${escapeHtml(fmtDateTime(intent.lastTxProcessedAtUtc))}</span>
                </div>
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Importo</span>
                  <span class="font-medium text-slate-900 text-right">${escapeHtml(intent.lastTxAmountCents == null ? "—" : formatMoney(intent.lastTxAmountCents, intent.currency))}</span>
                </div>
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Identificativo</span>
                  <span class="font-mono text-xs text-slate-900 text-right break-all">${escapeHtml(intent.lastTxId || "—")}</span>
                </div>
              </div>
            `
        : `<div class="mt-2 text-sm text-slate-600">Nessuna transazione registrata al momento.</div>`
      }
        </div>
      </div>
    `;

    APL.ui.modal.open({
      title: "Dettagli operazione",
      bodyHtml: body,
      actions: [{ label: "Chiudi", kind: "primary", closeOnClick: true }],
    });
  }

  // Apre una modale con l’elenco delle transazioni associate a una intent.
  async function openTransactions(intentId) {
    const ok = await ensureModalReady();
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    // Recupera tutte le transazioni collegate all’operazione selezionata.
    const data = await apiJson("GET", `${API_TRANSACTIONS}/${encodeURIComponent(String(intentId))}/transactions`);
    const list = (Array.isArray(data) ? data : []).map(normalizeTx);

    const rows = list.length
      ? list
        .slice()
        // Ordina le transazioni partendo dalla più recente.
        .sort((a, b) => new Date(b.processedAtUtc || 0) - new Date(a.processedAtUtc || 0))
        .map((t) => {
          const st = statusMeta(t.status);
          return `
            <tr class="border-b last:border-b-0">
              <td class="px-4 py-3 text-slate-800 whitespace-nowrap">${escapeHtml(fmtDateTime(t.processedAtUtc))}</td>
              <td class="px-4 py-3">${pill(st.label, st.tone)}</td>
              <td class="px-4 py-3 text-slate-700 whitespace-nowrap">${escapeHtml(formatMoney(t.amountCents, "EUR"))}</td>
              <td class="px-4 py-3 text-slate-600 font-mono text-xs break-all" title="${escapeHtml(t.providerTransactionId)}">${escapeHtml(String(t.providerTransactionId || "—"))}</td>
            </tr>
          `;
        })
        .join("")
      : `<tr><td colspan="4" class="px-4 py-6 text-center text-slate-600">Nessuna transazione disponibile.</td></tr>`;

    const body = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
          Elenco delle transazioni associate all’operazione selezionata.
        </div>

        <div class="overflow-x-auto rounded-2xl border bg-white">
          <table class="min-w-full table-auto text-sm">
            <thead class="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th class="px-4 py-3 text-left font-medium whitespace-nowrap">Data/ora</th>
                <th class="px-4 py-3 text-left font-medium whitespace-nowrap">Stato</th>
                <th class="px-4 py-3 text-left font-medium whitespace-nowrap">Importo</th>
                <th class="px-4 py-3 text-left font-medium">Riferimento</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              ${rows}
            </tbody>
          </table>
        </div>
      </div>
    `;

    APL.ui.modal.open({
      title: "Transazioni",
      bodyHtml: body,
      actions: [{ label: "Chiudi", kind: "primary", closeOnClick: true }],
    });
  }

  // Apre la modale che permette di simulare la conclusione del flusso provider.
  async function openSimulateProviderOutcome(intent) {
    const ok = await ensureModalReady();
    if (!ok) return;

    const current = statusMeta(intent.status);

    await new Promise((resolve) => {
      const body = `
        <div class="space-y-4">
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-xs font-medium text-slate-500">Stato corrente</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(current.label)}</div>
            <div class="mt-2 text-xs text-slate-600">Provider: ${escapeHtml(intent.provider || "—")}</div>
            <div class="mt-1 text-xs text-slate-600">Riferimento: ${escapeHtml(intent.providerIntentId || intent.id || "—")}</div>
          </div>

          <div>
            <label class="text-sm font-medium text-slate-700" for="providerOutcome">Esito finale da simulare</label>
            <select id="providerOutcome"
              class="mt-2 h-11 w-full rounded-xl border bg-white px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100">
              <option value="Succeeded">Completato</option>
              <option value="Failed">Non riuscito</option>
              <option value="Canceled">Annullato</option>
            </select>
            <div class="mt-2 text-xs text-slate-600 leading-relaxed">
              Questa azione simula la callback finale del provider digitale e chiude il flusso di pagamento.
            </div>
          </div>
        </div>
      `;

      APL.ui.modal.open({
        title: "Simula esito provider",
        bodyHtml: body,
        actions: [
          { label: "Annulla", kind: "secondary", closeOnClick: true, onClick: () => resolve(false) },
          {
            label: "Conferma",
            kind: "primary",
            closeOnClick: true,
            onClick: async () => {
              try {
                const sel = document.getElementById("providerOutcome");
                const outcome = String(sel?.value || "").trim();

                if (!outcome) {
                  APL.utils.toast("Selezionare un esito per procedere.", "error");
                  resolve(false);
                  return;
                }

                // Applica l’esito simulato alla intent selezionata.
                await apiJson(
                  "POST",
                  `${API_SIMULATE_PROVIDER}/${encodeURIComponent(String(intent.id))}/simulate-provider-outcome`,
                  { outcome }
                );

                APL.utils.toast("Esito provider simulato correttamente.", "success");

                // Ricarica la tabella per riflettere il nuovo stato finale.
                await loadAll();
                resolve(true);
              } catch (e) {
                APL.utils.toast(APL.utils.humanizeError(e) || "Operazione non riuscita.", "error");
                resolve(false);
              }
            },
          },
        ],
      });
    });
  }

  // Apre la modale per la riconciliazione manuale dello stato di una intent.
  async function openReconcile(intent) {
    const ok = await ensureModalReady();
    if (!ok) return;

    const current = statusMeta(intent.status);

    const body = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Stato corrente</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(current.label)}</div>
          <div class="mt-2 text-xs text-slate-600">Aggiornato: ${escapeHtml(fmtDateTime(intent.updatedAtUtc || intent.createdAtUtc))}</div>
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700" for="reconcileNewStatus">Nuovo stato</label>
          <select id="reconcileNewStatus"
            class="mt-2 h-11 w-full rounded-xl border bg-white px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100">
            <option value="Created">Creato</option>
            <option value="Pending">In elaborazione</option>
            <option value="Succeeded">Completato</option>
            <option value="Failed">Non riuscito</option>
            <option value="Canceled">Annullato</option>
          </select>
          <div class="mt-2 text-xs text-slate-600 leading-relaxed">
            La riconciliazione aggiorna direttamente lo stato dell’operazione selezionata.
          </div>
        </div>
      </div>
    `;

    await new Promise((resolve) => {
      APL.ui.modal.open({
        title: "Riconciliazione",
        bodyHtml: body,
        actions: [
          { label: "Annulla", kind: "secondary", closeOnClick: true, onClick: () => resolve(false) },
          {
            label: "Conferma",
            kind: "primary",
            closeOnClick: true,
            onClick: async () => {
              try {
                const sel = document.getElementById("reconcileNewStatus");
                const newStatus = String(sel?.value || "").trim();

                if (!newStatus) {
                  APL.utils.toast("Selezionare uno stato per procedere.", "error");
                  resolve(false);
                  return;
                }

                // Aggiorna manualmente lo stato lato backend.
                await apiJson("POST", `${API_RECONCILE}/${encodeURIComponent(String(intent.id))}/reconcile`, { newStatus });

                APL.utils.toast("Operazione aggiornata.", "success");

                // Ricarica la lista per sincronizzare subito la UI con il nuovo stato.
                await loadAll();
                resolve(true);
              } catch (e) {
                APL.utils.toast(APL.utils.humanizeError(e) || "Operazione non riuscita.", "error");
                resolve(false);
              }
            },
          },
        ],
      });
    });
  }

  // Converte un importo espresso in euro testuali in centesimi interi.
  function eurosToCents(valueStr) {
    const s = String(valueStr || "").trim();
    if (!s) return null;

    const n = Number(s.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;

    return Math.round(n * 100);
  }

  // Registra sul backend un pagamento avvenuto direttamente in sede.
  async function registerInPerson(appointmentId, amountCents, method) {
    setLoading(true);
    clearError();

    try {
      await apiJson(
        "POST",
        `${API_IN_PERSON}/${encodeURIComponent(String(appointmentId))}/in-person`,
        {
          amountCents: amountCents == null ? null : amountCents,
          method: method || null,
        }
      );

      APL.utils.toast("Pagamento registrato.", "success");

      // Ricarica l’elenco per rendere immediatamente visibile l’operazione aggiornata.
      await loadAll();
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");

      // Anche in caso di errore ricarica la vista per riallineare la UI allo stato reale.
      await loadAll();
    } finally {
      setLoading(false);
    }
  }

  // Costruisce una ricevuta testuale sintetica per uso amministrativo interno.
  function buildReceipt(intent) {
    const st = statusMeta(intent.status);
    const lines = [];

    lines.push("Healthcare Portal — Ricevuta (uso amministrativo)");
    lines.push(`Data emissione: ${fmtDateTime(new Date().toISOString())}`);
    lines.push("");
    lines.push(`Riferimento: ${intent.providerIntentId || intent.id || "—"}`);
    lines.push(`Prestazione: ${intent.appointmentId || "—"}`);
    lines.push(`Importo: ${formatMoney(intent.amountCents, intent.currency)}`);
    lines.push(`Stato: ${st.label}`);
    lines.push(`Creato: ${fmtDateTime(intent.createdAtUtc)}`);
    lines.push(`Aggiornato: ${fmtDateTime(intent.updatedAtUtc)}`);

    if (intent.lastTxStatus || intent.lastTxProcessedAtUtc) {
      lines.push("");
      lines.push("Ultima transazione:");
      lines.push(`- Stato: ${statusMeta(intent.lastTxStatus || "").label}`);
      lines.push(`- Data: ${fmtDateTime(intent.lastTxProcessedAtUtc)}`);
    }

    return lines.join("\n");
  }

  // Scarica nel browser un file di testo generato lato client.
  function downloadText(filename, text) {
    const blob = new Blob([String(text || "")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "ricevuta.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // Legge l’intervallo date dalla UI oppure ne costruisce uno di default.
  function readRangeOrDefault(daysBack) {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    if (from && to && to >= from) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) return { fromUtc: range.fromUtc, toUtc: range.toUtc };
    }

    // Se i campi non sono valorizzati, usa una finestra retrospettiva di default.
    const today = APL.utils.romeTodayDateInputValue();
    const startDay = APL.utils.addDaysToDateInput(today, -(daysBack || 90));
    return APL.utils.romeDateRangeToUtc(startDay, today);
  }

  // Applica una delle scorciatoie temporali ai campi filtro della pagina.
  function applyQuickRange(kind) {
    const fromEl = $("fromDate");
    const toEl = $("toDate");
    if (!fromEl || !toEl) return;

    const today = APL.utils.romeTodayDateInputValue();

    if (kind === "last30") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -30);
      toEl.value = today;
    } else if (kind === "last90") {
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

  // Ripristina i filtri della pagina al valore predefinito di lavoro.
  function resetFilters() {
    $("searchInput").value = "";
    $("statusSelect").value = "ALL";
    $("providerSelect").value = "ALL";
    applyQuickRange("last90");
  }

  // Stato locale della pagina:
  // - all: lista completa caricata dal backend;
  // - shown: lista effettivamente visibile dopo i filtri client-side;
  // - byId: indice rapido per recuperare una intent a partire dal suo id.
  const state = {
    all: [],
    shown: [],
    byId: new Map(),
  };

  // Carica dal backend tutte le operazioni coerenti con il perimetro attuale
  // e aggiorna la UI.
  async function loadAll() {
    clearError();
    setLoading(true);

    try {
      const { fromUtc, toUtc } = readRangeOrDefault(90);

      const params = new URLSearchParams();
      params.set("fromUtc", fromUtc);
      params.set("toUtc", toUtc);

      // Solo alcuni filtri vengono propagati lato server.
      // OPEN resta invece una categoria composita gestita lato client.
      const statusSel = String($("statusSelect")?.value || "ALL");
      if (statusSel !== "ALL" && statusSel !== "OPEN") params.set("status", statusSel);

      const providerSel = String($("providerSelect")?.value || "ALL");
      if (providerSel !== "ALL") params.set("provider", providerSel);

      const data = await apiJson("GET", `${API_INTENTS}?${params.toString()}`);
      const list = (Array.isArray(data) ? data : []).map(normalizeIntent);

      // Aggiorna la cache locale e l’indice rapido.
      state.all = list;
      state.byId = new Map(list.filter((x) => x.id).map((x) => [String(x.id), x]));

      // Applica i filtri client-side e renderizza la vista risultante.
      state.shown = applyClientFilters(state.all);
      renderTable(state.shown);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare i pagamenti.");

      const tbody = $("intentsTbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-600">—</td></tr>`;

      // In caso di errore globale non mostra lo stato vuoto funzionale,
      // perché non si tratta di assenza di dati ma di fallimento operativo.
      emptyState(false);
    } finally {
      setLoading(false);
    }
  }

  // Collega tutti i controlli della pagina ai relativi comportamenti.
  function wireEvents() {
    const btnLast30 = $("btnLast30");
    if (btnLast30) btnLast30.addEventListener("click", () => { applyQuickRange("last30"); loadAll(); });

    const btnLast90 = $("btnLast90");
    if (btnLast90) btnLast90.addEventListener("click", () => { applyQuickRange("last90"); loadAll(); });

    const btnLast365 = $("btnLast365");
    if (btnLast365) btnLast365.addEventListener("click", () => { applyQuickRange("last365"); loadAll(); });

    const btnAll = $("btnAll");
    if (btnAll) btnAll.addEventListener("click", () => { applyQuickRange("all"); loadAll(); });

    const btnReset = $("btnResetFilters");
    if (btnReset) btnReset.addEventListener("click", () => { resetFilters(); loadAll(); });

    const btnEmptyReset = $("btnEmptyReset");
    if (btnEmptyReset) btnEmptyReset.addEventListener("click", () => { resetFilters(); loadAll(); });

    // Le variazioni di stato, provider e intervallo richiedono un nuovo fetch dal backend.
    const statusSel = $("statusSelect");
    if (statusSel) statusSel.addEventListener("change", loadAll);

    const providerSel = $("providerSelect");
    if (providerSel) providerSel.addEventListener("change", loadAll);

    const fromDate = $("fromDate");
    const toDate = $("toDate");
    if (fromDate) fromDate.addEventListener("change", loadAll);
    if (toDate) toDate.addEventListener("change", loadAll);

    // La ricerca testuale opera solo sulla cache locale già caricata.
    const search = $("searchInput");
    if (search) {
      search.addEventListener("input", () => {
        state.shown = applyClientFilters(state.all);
        renderTable(state.shown);
      });
    }

    // Gestisce la registrazione di un pagamento effettuato fisicamente in struttura.
    const btnRegister = $("btnRegisterInPerson");
    if (btnRegister) {
      btnRegister.addEventListener("click", async () => {
        const ref = guidLike($("inPersonAppointmentRef")?.value);
        if (!ref) {
          APL.utils.toast("Inserire un riferimento valido per procedere.", "error");
          return;
        }

        const amountCents = eurosToCents($("inPersonAmount")?.value);
        const method = String($("inPersonMethod")?.value || "").trim() || "IN_PERSON";

        // Chiede una conferma finale prima di registrare l’operazione.
        const ok = await (async () => {
          const ready = await ensureModalReady();

          // Fallback minimale nel caso in cui il sistema modale non sia ancora pronto.
          if (!ready) return window.confirm("Confermare la registrazione del pagamento in sede?");

          return await new Promise((resolve) => {
            APL.ui.modal.open({
              title: "Conferma registrazione",
              bodyHtml: `
                <div class="space-y-3">
                  <div class="text-sm text-slate-700 leading-relaxed">
                    Procedere con la registrazione del pagamento in sede?
                  </div>
                  <div class="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-slate-500">Riferimento</span>
                      <span class="font-medium">${escapeHtml(ref)}</span>
                    </div>
                    <div class="mt-2 flex items-center justify-between gap-3">
                      <span class="text-slate-500">Metodo</span>
                      <span class="font-medium">${escapeHtml(method)}</span>
                    </div>
                    <div class="mt-2 flex items-center justify-between gap-3">
                      <span class="text-slate-500">Importo</span>
                      <span class="font-medium">${escapeHtml(amountCents == null ? "Importo predefinito" : formatMoney(amountCents, "EUR"))}</span>
                    </div>
                  </div>
                </div>
              `,
              actions: [
                { label: "Annulla", kind: "secondary", closeOnClick: true, onClick: () => resolve(false) },
                { label: "Conferma", kind: "primary", closeOnClick: true, onClick: () => resolve(true) },
              ],
            });
          });
        })();

        if (!ok) return;

        await registerInPerson(ref, amountCents, method);

        // Ripulisce il form dopo la registrazione.
        $("inPersonAppointmentRef").value = "";
        $("inPersonAmount").value = "";
        $("inPersonMethod").value = "POS";
      });
    }

    // Event delegation sulle azioni tabellari per evitare listener separati su ogni riga.
    const tbody = $("intentsTbody");
    if (tbody) {
      tbody.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-action]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");

        if (action === "details") {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          const it = state.byId.get(String(id));
          if (!it) return;
          await openIntentDetails(it);
          return;
        }

        if (action === "tx") {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          await openTransactions(id);
          return;
        }

        if (action === "simulate-provider") {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          const it = state.byId.get(String(id));
          if (!it) return;
          await openSimulateProviderOutcome(it);
          return;
        }

        if (action === "reconcile") {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          const it = state.byId.get(String(id));
          if (!it) return;
          await openReconcile(it);
          return;
        }

        if (action === "receipt") {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          const it = state.byId.get(String(id));
          if (!it) return;

          // Genera una ricevuta testuale client-side e ne avvia il download.
          const date = fmtDate(it.updatedAtUtc || it.createdAtUtc).replaceAll("/", "-");
          downloadText(`ricevuta_${date}.txt`, buildReceipt(it));
          return;
        }
      });
    }
  }

  // Inizializza la pagina quando il DOM è pronto.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato o non ha il ruolo richiesto.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // All’avvio imposta come default una vista sugli ultimi 90 giorni.
    applyQuickRange("last90");

    // Collega gli eventi della pagina.
    wireEvents();

    // Carica i dati iniziali.
    await loadAll();
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
