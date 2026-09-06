/**
 * File: frontend/js/clinician/agenda.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina agenda del clinico,
 * comprendendo il caricamento degli appuntamenti, il filtraggio per periodo,
 * stato e ricerca testuale, la visualizzazione della tabella, l’apertura del
 * dettaglio dell’appuntamento e il passaggio rapido verso la visita clinica.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Agenda" dell’area
 * Clinician. Si integra con i moduli condivisi del front-end per autenticazione,
 * sessione, richieste HTTP, utilità di data, toast e modali, e dialoga con il
 * dominio Scheduling per presentare al professionista sanitario la propria
 * agenda corrente e storica.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Clinician;
 * - inizializzare il range temporale di default dell’agenda;
 * - caricare dal backend gli appuntamenti nel periodo selezionato;
 * - gestire endpoint primario e fallback per il recupero dei dati;
 * - normalizzare i payload ricevuti in una struttura uniforme lato client;
 * - applicare filtri client-side su stato e ricerca testuale;
 * - aggiornare statistiche sintetiche e tabella degli appuntamenti;
 * - mostrare il dettaglio dell’appuntamento in modale;
 * - consentire l’accesso rapido alla visita/encounter associata;
 * - gestire caricamenti, errori globali e feedback utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.session.clearAuth` nei casi di sessione non più valida;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading`,
 *   `APL.utils.toRomeDateInputValue`, `APL.utils.romeTodayDateInputValue`,
 *   `APL.utils.romeDateRangeToUtc` e `APL.utils.addDaysToDateInput`;
 * - utilizza `APL.ui.modal` per mostrare i dettagli dell’appuntamento;
 * - utilizza `APL.utils.toast` per notificare problemi di interfaccia;
 * - interagisce con gli endpoint:
 *   `/api/scheduling/clinicians/me/appointments`
 *   e `/api/scheduling/appointments`;
 * - reindirizza verso `./encounter-detail.html?appointmentId=...` per il flusso
 *   di apertura della visita clinica.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina adotta una strategia mista:
 * - il range temporale viene applicato lato server;
 * - i filtri di stato e ricerca testuale vengono applicati lato client sulla
 *   cache locale degli appuntamenti caricati.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina agenda.
  const EXPECTED_ROLE = "Clinician";

  // Endpoint primario per il recupero dell’agenda personale del clinico.
  const API_AGENDA_PRIMARY = "/api/scheduling/clinicians/me/appointments";

  // Endpoint alternativi usati come fallback per garantire compatibilità con
  // eventuali varianti di routing lato backend o gateway.
  const API_AGENDA_FALLBACKS = [
    "/api/scheduling/appointments",
  ];

  // Utility locale per recuperare rapidamente un elemento DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore globale nel contenitore principale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore degli errori globali.
  function clearError() {
    const box = $("pageError");
    if (!box) return;

    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna lo stato di caricamento globale della pagina.
  // Oltre al badge, gestisce anche lo stato del pulsante di refresh
  // e la disabilitazione temporanea dei controlli rilevanti.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Il pulsante di refresh usa l’utility condivisa per mostrare
    // uno stato visuale coerente con il resto dell’applicazione.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

    // Durante il fetch evita modifiche concorrenti a range e filtri.
    const ids = ["fromDate", "toDate", "statusSelect", "searchInput", "btnToday", "btnNext7", "btnNext30", "btnLast30"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Esegue l’escape HTML di una stringa prima dell’inserimento in markup dinamico.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Converte una data JavaScript nel formato compatibile con gli input date locali.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formattta una data/ora API in una rappresentazione leggibile per un utente italiano.
  function fmtDateTime(isoUtc) {
    if (!isoUtc) return "—";

    const d = new Date(isoUtc);
    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Normalizza uno stato eterogeneo in un formato uniforme confrontabile.
  function normalizeStatus(raw) {
    return String(raw || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
  }

  // Traduce lo stato tecnico dell’appuntamento in una label utente e in una tonalità semantica.
  function mapStatus(raw) {
    const s = normalizeStatus(raw);

    if (s === "BOOKED") return { label: "Prenotato", tone: "blue" };
    if (s === "CHECKED_IN") return { label: "Accettato", tone: "amber" };
    if (s === "COMPLETED") return { label: "Completato", tone: "emerald" };
    if (s === "CANCELED" || s === "CANCELLED") return { label: "Annullato", tone: "slate" };
    if (s === "NO_SHOW") return { label: "Assente", tone: "slate" };

    return { label: raw || "—", tone: "slate" };
  }

  // Restituisce il badge HTML che rappresenta lo stato dell’appuntamento in tabella o in modale.
  function statusPill(raw) {
    const m = mapStatus(raw);

    const tone =
      m.tone === "blue"
        ? "bg-blue-50 text-blue-700"
        : m.tone === "amber"
          ? "bg-amber-50 text-amber-800"
          : m.tone === "emerald"
            ? "bg-emerald-50 text-emerald-700"
            : "bg-slate-100 text-slate-700";

    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${tone}">${escapeHtml(
      m.label
    )}</span>`;
  }

  // Mostra o nasconde lo stato vuoto della tabella agenda.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Attende che il sistema modale condiviso sia pronto prima di usarlo.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();

    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione coerente
  // di sessione scaduta, accesso vietato ed errori applicativi generici.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // Se la sessione è scaduta, ripulisce lo stato locale e delega il redirect
      // alla pagina di sessione scaduta.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Se l’utente non ha il ruolo o il permesso richiesto, reindirizza alla vista forbidden.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Negli altri casi prova a ricostruire un messaggio applicativo leggibile.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Legge l’intervallo temporale dalla UI oppure costruisce un default coerente con la vista agenda.
  function readRangeOrDefault() {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    // Se l’utente ha selezionato un intervallo valido, lo converte in UTC.
    if (from && to && to >= from) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) return range;
    }

    // In assenza di input validi, usa un default "da adesso ai prossimi 7 giorni".
    const today = APL.utils.romeTodayDateInputValue();
    const end = APL.utils.addDaysToDateInput(today, 7);
    const range = APL.utils.romeDateRangeToUtc(today, end);

    return {
      fromUtc: new Date().toISOString(),
      toUtc: range.toUtc,
    };
  }

  // Applica rapidamente un intervallo temporale predefinito ai campi data della pagina.
  function applyQuickRange(kind) {
    const fromEl = $("fromDate");
    const toEl = $("toDate");
    if (!fromEl || !toEl) return;

    const today = APL.utils.romeTodayDateInputValue();

    if (kind === "today") {
      fromEl.value = today;
      toEl.value = today;
    } else if (kind === "next7") {
      fromEl.value = today;
      toEl.value = APL.utils.addDaysToDateInput(today, 7);
    } else if (kind === "next30") {
      fromEl.value = today;
      toEl.value = APL.utils.addDaysToDateInput(today, 30);
    } else if (kind === "last30") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -30);
      toEl.value = today;
    }
  }

  // Normalizza un record appuntamento proveniente dal backend in una struttura uniforme lato client.
  function normalizeAgendaItem(x) {
    const startUtc = x.startUtc || x.start || x.dateTimeUtc || x.whenUtc || x.beginUtc || null;
    const endUtc = x.endUtc || x.end || x.finishUtc || null;

    const serviceName =
      x.serviceName ||
      (x.service && (x.service.name || x.service.title)) ||
      x.serviceTitle ||
      x.serviceCode ||
      x.service ||
      null;

    const serviceCode =
      x.serviceCode ||
      (x.service && (x.service.code || x.service.id)) ||
      x.serviceId ||
      null;

    const patientName =
      x.patientDisplayName ||
      x.patientName ||
      x.patientFullName ||
      (x.patient && (x.patient.fullName || x.patient.name)) ||
      x.patient ||
      null;

    const patientId =
      x.patientUserId ||
      x.patientId ||
      (x.patient && (x.patient.userId || x.patient.id)) ||
      null;

    const notes = x.notes || x.note || x.patientNotes || null;

    return {
      id: x.id ?? x.appointmentId ?? x.bookingId ?? null,
      startUtc,
      endUtc,
      status: x.status || x.state || null,
      serviceName,
      serviceCode,
      patientName,
      patientId,
      notes,
      raw: x,
    };
  }

  // Applica i filtri client-side alla lista completa degli appuntamenti già caricata.
  function filterClientSide(items) {
    const statusSel = String($("statusSelect")?.value || "ALL").toUpperCase();
    const term = String($("searchInput")?.value || "").trim().toLowerCase();

    return (Array.isArray(items) ? items : []).filter((a) => {
      const st = normalizeStatus(a.status);

      // Filtro per stato.
      if (statusSel !== "ALL" && st !== statusSel) return false;

      // Se non è presente ricerca testuale, il record è già compatibile.
      if (!term) return true;

      // La ricerca libera opera su paziente, prestazione e note.
      const p = String(a.patientName || "").toLowerCase();
      const s = String(a.serviceName || a.serviceCode || "").toLowerCase();
      const n = String(a.notes || "").toLowerCase();

      return p.includes(term) || s.includes(term) || n.includes(term);
    });
  }

  // Aggiorna le statistiche sintetiche visibili nella parte alta della pagina.
  function setStats(items) {
    const list = Array.isArray(items) ? items : [];
    const now = new Date();

    const total = list.length;

    // Calcola il numero di appuntamenti che ricadono nel giorno corrente locale.
    const todayKey = new Date().toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
    const todayCount = list.filter((x) => {
      const d = x.startUtc ? new Date(x.startUtc) : null;
      if (!d || !Number.isFinite(d.getTime())) return false;

      const key = d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
      return key === todayKey;
    }).length;

    // Conta gli appuntamenti ancora futuri rispetto al momento corrente.
    const upcoming = list.filter((x) => {
      const d = x.startUtc ? new Date(x.startUtc) : null;
      return d && Number.isFinite(d.getTime()) && d >= now;
    }).length;

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statToday")) $("statToday").textContent = String(todayCount);
    if ($("statUpcoming")) $("statUpcoming").textContent = String(upcoming);
  }

  // Renderizza la tabella agenda e aggiorna stato vuoto e statistiche.
  function renderRows(items) {
    const tbody = $("agendaTbody");
    if (!tbody) return;

    const list = Array.isArray(items) ? items : [];
    setStats(list);

    // In assenza di risultati visibili, attiva lo stato vuoto e mostra una riga placeholder.
    if (!list.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    const rows = list
      .slice()
      // Ordina gli appuntamenti dal più vicino al più lontano rispetto all’inizio dell’intervallo.
      .sort((a, b) => new Date(a.startUtc || 0) - new Date(b.startUtc || 0))
      .map((a) => {
        const when = escapeHtml(fmtDateTime(a.startUtc));
        const patient = escapeHtml(a.patientName || (a.patientId ? `Paziente ${a.patientId}` : "—"));
        const service = escapeHtml(a.serviceName || a.serviceCode || "—");
        const st = statusPill(a.status);

        // Le note vengono mostrate in forma troncata in tabella, con valore completo nel tooltip.
        const notes = a.notes ? escapeHtml(String(a.notes)) : "—";

        const btnCls =
          "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

        return `
          <tr>
            <td class="py-4 pr-4 text-slate-800">${when}</td>
            <td class="py-4 pr-4 text-slate-700">${patient}</td>
            <td class="py-4 pr-4 text-slate-700">${service}</td>
            <td class="py-4 pr-4">${st}</td>
            <td class="py-4 pr-4 text-slate-600 max-w-[360px] truncate" title="${escapeHtml(notes)}">${notes}</td>
            <td class="py-4 text-right">
              <div class="inline-flex items-center gap-2 justify-end">
                <button type="button" data-action="details" data-id="${escapeHtml(String(a.id))}" class="${btnCls}">
                  Dettagli
                </button>
                <button type="button" data-action="open" data-id="${escapeHtml(String(a.id))}" class="${btnCls}">
                  Apri visita
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = rows;
  }

  // Recupera gli appuntamenti dal backend nell’intervallo richiesto.
  // Prova l’endpoint principale e, se necessario, eventuali fallback retrocompatibili.
  async function fetchAgenda(fromUtc, toUtc) {
    const params = new URLSearchParams();
    params.set("fromUtc", fromUtc);
    params.set("toUtc", toUtc);

    const tryUrls = [API_AGENDA_PRIMARY, ...API_AGENDA_FALLBACKS];

    let lastErr = null;
    for (const base of tryUrls) {
      try {
        const url = `${base}?${params.toString()}`;
        const data = await apiJson("GET", url);
        return Array.isArray(data) ? data : [];
      } catch (err) {
        lastErr = err;

        // Alcuni endpoint fallback possono non esistere o non supportare il metodo:
        // in tal caso si prova la variante successiva.
        if (err && typeof err === "object" && (Number(err.status) === 404 || Number(err.status) === 405)) continue;

        throw err;
      }
    }

    throw lastErr || new Error("Impossibile caricare l’agenda.");
  }

  // Costruisce il corpo HTML della modale di dettaglio appuntamento.
  function detailsBodyHtml(a) {
    const when = escapeHtml(fmtDateTime(a.startUtc));
    const patient = escapeHtml(a.patientName || (a.patientId ? `Paziente ${a.patientId}` : "—"));
    const service = escapeHtml(a.serviceName || a.serviceCode || "—");
    const st = statusPill(a.status);
    const notes = a.notes ? escapeHtml(String(a.notes)) : "—";

    return `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Appuntamento</div>
          <div class="mt-2 grid gap-2 text-sm">
            <div class="flex items-start justify-between gap-4">
              <span class="text-slate-500">Data/ora</span>
              <span class="font-medium text-slate-800 text-right">${when}</span>
            </div>
            <div class="flex items-start justify-between gap-4">
              <span class="text-slate-500">Paziente</span>
              <span class="font-medium text-slate-800 text-right">${patient}</span>
            </div>
            <div class="flex items-start justify-between gap-4">
              <span class="text-slate-500">Prestazione</span>
              <span class="font-medium text-slate-800 text-right">${service}</span>
            </div>
            <div class="flex items-start justify-between gap-4">
              <span class="text-slate-500">Stato</span>
              <span class="text-right">${st}</span>
            </div>
          </div>
        </div>

        <div>
          <div class="text-xs font-medium text-slate-500">Note</div>
          <div class="mt-2 text-sm text-slate-700 leading-relaxed">${notes}</div>
        </div>
      </div>
    `;
  }

  // Reindirizza verso la pagina di dettaglio visit/encounter associata all’appuntamento.
  function goToEncounter(appointmentId) {
    window.location.href = `./encounter-detail.html?appointmentId=${encodeURIComponent(String(appointmentId))}`;
  }

  // Stato locale della pagina:
  // - _all: lista completa caricata dal backend;
  // - _debounce: timer usato per ritardare il rerender durante la digitazione.
  let _all = [];
  let _debounce = null;

  // Carica l’agenda dal backend e aggiorna l’interfaccia.
  async function loadAgenda() {
    clearError();
    setLoading(true);

    try {
      const r = readRangeOrDefault();
      const data = await fetchAgenda(r.fromUtc, r.toUtc);

      // Normalizza i dati ricevuti una sola volta e li conserva in cache locale.
      _all = (Array.isArray(data) ? data : []).map(normalizeAgendaItem);

      const filtered = filterClientSide(_all);
      renderRows(filtered);
    } catch (err) {
      console.error(err);

      _all = [];
      renderRows([]);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare l’agenda.");
    } finally {
      setLoading(false);
    }
  }

  // Riapplica i filtri client-side ai dati già caricati senza nuova chiamata remota.
  function reRender() {
    const filtered = filterClientSide(_all);
    renderRows(filtered);
  }

  // Cerca nella cache locale l’appuntamento con l’identificativo richiesto.
  function findById(id) {
    return _all.find((x) => String(x.id) === String(id)) || null;
  }

  // Apre la modale di dettaglio appuntamento con accesso rapido alla visita.
  async function openDetailsModal(item) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    APL.ui.modal.open({
      title: "Dettagli appuntamento",
      bodyHtml: detailsBodyHtml(item),
      actions: [
        { label: "Chiudi", kind: "secondary" },
        {
          label: "Apri visita",
          kind: "primary",
          closeOnClick: true,
          onClick: () => goToEncounter(item.id),
        },
      ],
    });
  }

  // Collega la tabella alle azioni riga tramite event delegation.
  function wireActions() {
    const tbody = $("agendaTbody");
    if (!tbody) return;

    tbody.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-action][data-id]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      const item = findById(id);
      if (!item) return;

      if (action === "details") {
        await openDetailsModal(item);
        return;
      }

      if (action === "open") {
        goToEncounter(item.id);
        return;
      }
    });
  }

  // Collega i controlli della pagina ai relativi comportamenti applicativi.
  function initControls() {
    const btnRefresh = $("btnRefresh");
    const btnToday = $("btnToday");
    const btnNext7 = $("btnNext7");
    const btnNext30 = $("btnNext30");
    const btnLast30 = $("btnLast30");
    const btnReset = $("btnResetFilters");

    const fromDate = $("fromDate");
    const toDate = $("toDate");
    const statusSelect = $("statusSelect");
    const searchInput = $("searchInput");

    if (btnRefresh) btnRefresh.addEventListener("click", loadAgenda);

    if (btnToday) btnToday.addEventListener("click", () => { applyQuickRange("today"); loadAgenda(); });
    if (btnNext7) btnNext7.addEventListener("click", () => { applyQuickRange("next7"); loadAgenda(); });
    if (btnNext30) btnNext30.addEventListener("click", () => { applyQuickRange("next30"); loadAgenda(); });
    if (btnLast30) btnLast30.addEventListener("click", () => { applyQuickRange("last30"); loadAgenda(); });

    if (btnReset) {
      btnReset.addEventListener("click", () => {
        // Ripristina i filtri non temporali e riporta il range al preset standard della pagina.
        if (statusSelect) statusSelect.value = "ALL";
        if (searchInput) searchInput.value = "";
        applyQuickRange("next7");
        loadAgenda();
      });
    }

    // Le variazioni dell’intervallo temporale richiedono una nuova chiamata server-side.
    if (fromDate) fromDate.addEventListener("change", loadAgenda);
    if (toDate) toDate.addEventListener("change", loadAgenda);

    // Il filtro di stato opera solo sulla cache locale già caricata.
    if (statusSelect) statusSelect.addEventListener("change", reRender);

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        // Applica un debounce leggero per evitare rerender continui durante la digitazione.
        if (_debounce) clearTimeout(_debounce);
        _debounce = setTimeout(() => reRender(), 250);
      });

      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (_debounce) clearTimeout(_debounce);
          reRender();
        }
      });
    }
  }

  // Inizializza il range temporale di default all’intervallo "oggi + 7 giorni".
  function initDefaultRange() {
    const fromEl = $("fromDate");
    const toEl = $("toDate");
    if (!fromEl || !toEl) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    fromEl.value = toLocalDateInputValue(today);
    toEl.value = toLocalDateInputValue(end);
  }

  // Inizializza l’intera pagina agenda al caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Clinician.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    try {
      initDefaultRange();
      initControls();
      wireActions();

      // Attende la disponibilità del sistema modale prima del primo utilizzo possibile.
      await ensureModalReady(10000);

      // Carica i dati iniziali della vista.
      await loadAgenda();
    } catch (err) {
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la pagina.");
    }
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
