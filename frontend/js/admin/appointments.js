/**
 * File: frontend/js/admin/appointments.js
 *
 * Scopo
 * -----
 * Gestire la logica client-side della pagina amministrativa dedicata alla
 * consultazione e gestione degli appuntamenti, includendo caricamento dati,
 * filtraggio, esportazione, visualizzazione dei dettagli, annullamento,
 * ripianificazione e reindirizzamento verso il flusso di accettazione.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script coordina il comportamento dinamico della vista
 * `pages/admin/appointments.html`. Si occupa di interrogare gli endpoint
 * amministrativi del dominio scheduling e registry, normalizzare i dati
 * ricevuti dal back-end, renderizzare la tabella degli appuntamenti e
 * governare le principali azioni operative disponibili per l’utente Admin.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso dell’utente al contesto amministrativo;
 * - caricare e popolare il filtro dei clinici;
 * - recuperare l’elenco degli appuntamenti nell’intervallo richiesto;
 * - applicare filtri client-side per stato e ricerca testuale;
 * - renderizzare tabella, contatori statistici ed empty state;
 * - aprire modali di dettaglio, annullamento e ripianificazione;
 * - richiamare gli endpoint di cancel e reschedule;
 * - esportare in formato CSV il dataset attualmente filtrato.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(...)` per garantire l’accesso al ruolo Admin;
 * - usa `APL.session.authHeader()` per allegare il token alle richieste HTTP;
 * - usa `APL.utils.requestJson(...)` come wrapper comune per le chiamate API;
 * - usa `APL.utils.parseErrorMessage(...)` e `APL.utils.humanizeError(...)`
 *   per la gestione coerente degli errori;
 * - usa `APL.utils.setLoading(...)` e `APL.utils.toast(...)` per feedback UI;
 * - usa `APL.ui.modal.open(...)` e `APL.ui.modal.close(...)` per le finestre modali;
 * - interagisce con gli endpoint:
 *   `/api/scheduling/admin/appointments`,
 *   `/api/scheduling/admin/clinicians/{id}/appointments`,
 *   `/api/scheduling/admin/appointments/{id}/cancel`,
 *   `/api/scheduling/admin/appointments/{id}/reschedule`,
 *   `/api/scheduling/admin/availability`,
 *   `/api/registry/admin/clinicians`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. La pagina mantiene cache client-side per appuntamenti e
 * clinici, così da supportare filtri locali, rendering tabellare, apertura
 * di modali operative, esportazione CSV e selezione contestuale del clinico
 * senza dover ricostruire continuamente il dataset lato client.
 */

(function () {
  "use strict";

  // Ruolo richiesto per accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint per il recupero di tutti gli appuntamenti lato amministratore.
  const API_APPOINTMENTS_ALL = "/api/scheduling/admin/appointments";

  // Endpoint per il recupero degli appuntamenti filtrati per clinico.
  const API_APPOINTMENTS_BY_CLINICIAN = (clinicianUserId) =>
    `/api/scheduling/admin/clinicians/${encodeURIComponent(String(clinicianUserId))}/appointments`;

  // Endpoint per l’annullamento di uno specifico appuntamento.
  const API_CANCEL = (appointmentId) =>
    `/api/scheduling/admin/appointments/${encodeURIComponent(String(appointmentId))}/cancel`;

  // Endpoint per la ricerca delle disponibilità alternative.
  const API_AVAILABILITY = "/api/scheduling/admin/availability";

  // Endpoint per la ripianificazione di uno specifico appuntamento.
  const API_RESCHEDULE = (appointmentId) =>
    `/api/scheduling/admin/appointments/${encodeURIComponent(String(appointmentId))}/reschedule`;

  // Endpoint per il caricamento dei clinici utilizzati nel filtro di pagina.
  const API_CLINICIANS_LIST = "/api/registry/admin/clinicians";

  // Parametri di paginazione per il caricamento dell’elenco clinici.
  const CLINICIANS_PAGE_SIZE = 500;
  const CLINICIANS_MAX_PAGES = 20;

  // Shortcut per recuperare un elemento DOM tramite id.
  function $(id) { return document.getElementById(id); }

  // Mostra un errore globale nella pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    box.textContent = message || "Si è verificato un errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Nasconde e pulisce il contenitore degli errori globali.
  function clearError() {
    const box = $("pageError");
    if (!box) return;

    box.textContent = "";
    box.classList.add("hidden");
  }

  // Trasforma un errore in un messaggio leggibile da mostrare in interfaccia.
  function humanize(err) {
    if (window.APL?.utils?.humanizeError) return APL.utils.humanizeError(err);
    return err && err.message ? String(err.message) : "Errore imprevisto.";
  }

  // Gestisce lo stato di caricamento generale della pagina.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

    const btnRefreshEmpty = $("btnRefreshEmpty");
    if (btnRefreshEmpty) APL.utils.setLoading(btnRefreshEmpty, loading, "Aggiornamento…");

    // Durante il caricamento vengono disabilitati i controlli che potrebbero
    // generare richieste concorrenti o stati incoerenti.
    const ids = [
      "fromDate",
      "toDate",
      "statusSelect",
      "searchInput",
      "btnToday",
      "btnNext7",
      "btnResetFilters",
      "clinicianSelect",
      "btnExport",
    ];

    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Mostra o nasconde l’empty state della tabella.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Esegue l’escape HTML di una stringa per evitare injection nel rendering.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Converte una data JavaScript nel formato richiesto dagli input type="date".
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formattta una data/ora UTC in formato leggibile per l’utente italiano.
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

  // Normalizza lo stato ricevuto dal back-end per facilitare confronti coerenti.
  function normalizeStatus(raw) {
    return String(raw || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
  }

  // Associa a ogni stato una label leggibile e una tonalità grafica.
  function mapStatus(raw) {
    const s = normalizeStatus(raw);

    if (s === "BOOKED") return { label: "Prenotato", tone: "blue" };
    if (s === "CHECKED_IN") return { label: "Accettato", tone: "amber" };
    if (s === "COMPLETED") return { label: "Completato", tone: "emerald" };
    if (s === "CANCELED" || s === "CANCELLED") return { label: "Annullato", tone: "slate" };
    if (s === "NO_SHOW") return { label: "Assente", tone: "slate" };

    return { label: raw || "—", tone: "slate" };
  }

  // Restituisce il badge HTML che rappresenta visivamente lo stato.
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

    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${tone}">${escapeHtml(m.label)}</span>`;
  }

  // Attende che l’API modale condivisa sia stata inizializzata da ui-components.js.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();

    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Wrapper centralizzato per richieste JSON autenticate verso il back-end.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Se la sessione non è più valida, si pulisce lo stato locale e si forza il redirect.
    if (!res.ok) {
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // In caso di accesso non autorizzato si reindirizza alla pagina dedicata.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Per gli altri errori si costruisce un oggetto Error arricchito.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Normalizza un appuntamento proveniente dal back-end in una struttura uniforme.
  function normalizeItem(x) {
    const startUtc = x.startUtc || x.start || x.whenUtc || x.beginUtc || null;
    const endUtc = x.endUtc || x.end || x.finishUtc || null;

    const serviceCode =
      x.serviceCode ||
      (x.service && (x.service.code || x.service.id)) ||
      x.serviceId ||
      null;

    const serviceId =
      x.serviceId ||
      (x.service && (x.service.id || x.service.serviceId)) ||
      null;

    const patientName =
      x.patientDisplayName ||
      x.patientName ||
      x.patientFullName ||
      (x.patient && (x.patient.fullName || x.patient.name)) ||
      x.patient ||
      null;

    const patientUserId =
      x.patientUserId ||
      (x.patient && (x.patient.userId || x.patient.id)) ||
      null;

    const notes = x.notes || x.note || x.patientNotes || null;

    return {
      id: x.appointmentId ?? x.id ?? x.bookingId ?? null,
      slotId: x.slotId ?? x.slotID ?? null,
      patientUserId,
      patientName,
      serviceId,
      serviceCode,
      status: x.status || x.state || null,
      startUtc,
      endUtc,
      notes,
      raw: x,
    };
  }

  // Normalizza uno slot ricevuto dall’endpoint availability.
  function normalizeSlot(x) {
    return {
      id: x.id || x.slotId || null,
      calendarId: x.calendarId || x.calendarID || null,
      clinicianUserId: x.clinicianUserId || x.clinicianId || null,
      startUtc: x.startUtc || x.start || null,
      endUtc: x.endUtc || x.end || null,
      raw: x,
    };
  }

  // Legge l’intervallo di date selezionato, oppure costruisce un default sensato.
  function readRangeOrDefault() {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    // Se l’intervallo è valido, viene convertito in UTC per la query verso il back-end.
    if (from && to && to >= from) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) return range;
    }

    // Fallback: oggi + 7 giorni.
    const today = APL.utils.romeTodayDateInputValue();
    const end = APL.utils.addDaysToDateInput(today, 7);
    return APL.utils.romeDateRangeToUtc(today, end);
  }

  // Applica rapidamente uno dei preset temporali disponibili nella UI.
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
    }
  }

  // Restituisce la chiave normalizzata dello stato di un appuntamento.
  function statusKey(a) {
    return normalizeStatus(a?.status);
  }

  // Utility booleane per classificare gli appuntamenti.
  function isBooked(a) { return statusKey(a) === "BOOKED"; }
  function isCheckedIn(a) { return statusKey(a) === "CHECKED_IN"; }

  // Considera “chiusi” gli appuntamenti conclusi, annullati o no-show.
  function isClosed(a) {
    const s = statusKey(a);
    return s === "COMPLETED" || s === "CANCELED" || s === "CANCELLED" || s === "NO_SHOW";
  }

  // Determina se l’appuntamento può essere inoltrato al flusso di accettazione.
  function canOpenCheckInFlow(a) {
    return isBooked(a);
  }

  // Determina se l’appuntamento è annullabile.
  function isEligibleForCancel(a) {
    return isBooked(a) && !!a.startUtc && new Date(a.startUtc).getTime() > Date.now();
  }

  // Determina se l’appuntamento è ripianificabile.
  function isEligibleForReschedule(a) {
    return isEligibleForCancel(a);
  }

  // Aggiorna i contatori riepilogativi in testata.
  function setStats(list) {
    const items = Array.isArray(list) ? list : [];
    const total = items.length;
    const booked = items.filter((x) => isBooked(x)).length;
    const checked = items.filter((x) => isCheckedIn(x)).length;
    const closed = items.filter((x) => isClosed(x)).length;

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statBooked")) $("statBooked").textContent = String(booked);
    if ($("statCheckedIn")) $("statCheckedIn").textContent = String(checked);
    if ($("statClosed")) $("statClosed").textContent = String(closed);
  }

  // Cache locale dei clinici caricati.
  let _clinicians = [];
  const _clinicianById = new Map();

  // Costruisce una label leggibile per un clinico partendo dal suo identificativo.
  function clinicianDisplayById(clinicianUserId) {
    const id = String(clinicianUserId || "");
    const c = _clinicianById.get(id);

    if (!c) return id ? `Clinico ${id}` : "Clinico";

    const email = String(c.email || "").trim();
    const spec = String(c.specialty || "").trim();
    return spec ? `${email} — ${spec}` : (email || `Clinico ${id}`);
  }

  // Applica i filtri lato client sull’insieme già caricato dal back-end.
  function filterClientSide(items) {
    const statusSel = String($("statusSelect")?.value || "ALL").toUpperCase();
    const term = String($("searchInput")?.value || "").trim().toLowerCase();

    return (Array.isArray(items) ? items : []).filter((a) => {
      const st = statusKey(a);

      // Filtro per stato.
      if (statusSel !== "ALL") {
        if (statusSel === "CANCELED") {
          if (!(st === "CANCELED" || st === "CANCELLED")) return false;
        } else if (st !== statusSel) {
          return false;
        }
      }

      // Filtro testuale su paziente, prestazione, riferimento o note.
      if (!term) return true;

      const p = String(a.patientName || "").toLowerCase();
      const s = String(a.serviceCode || "").toLowerCase();
      const id = String(a.id || "").toLowerCase();
      const n = String(a.notes || "").toLowerCase();

      return p.includes(term) || s.includes(term) || id.includes(term) || n.includes(term);
    });
  }

  // Renderizza le righe della tabella degli appuntamenti.
  function renderRows(items) {
    const tbody = $("appointmentsTbody");
    if (!tbody) return;

    const list = Array.isArray(items) ? items : [];
    setStats(list);

    // Se non ci sono risultati, si mostra l’empty state.
    if (!list.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    // Classi condivise per i diversi pulsanti azione.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";
    const btnDanger =
      "h-9 inline-flex items-center rounded-xl bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-100";
    const btnDisabled =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-400 cursor-not-allowed opacity-70";

    // Ordinamento cronologico crescente degli appuntamenti.
    const rows = list
      .slice()
      .sort((a, b) => new Date(a.startUtc || 0) - new Date(b.startUtc || 0))
      .map((a) => {
        const when = escapeHtml(fmtDateTime(a.startUtc));
        const patient = escapeHtml(a.patientName || "—");
        const service = escapeHtml(a.serviceCode || "—");
        const st = statusPill(a.status);

        const notes = a.notes ? String(a.notes) : "";
        const notesShort = notes ? escapeHtml(notes) : "—";

        const canOpenCheckIn = canOpenCheckInFlow(a);
        const canCancel = isEligibleForCancel(a);
        const canReschedule = isEligibleForReschedule(a);

        return `
          <tr>
            <td class="py-4 pr-4 text-slate-800">${when}</td>
            <td class="py-4 pr-4 text-slate-700">${patient}</td>
            <td class="py-4 pr-4 text-slate-700">${service}</td>
            <td class="py-4 pr-4">${st}</td>
            <td class="py-4 pr-4 text-slate-600 max-w-[360px] truncate" title="${escapeHtml(notes)}">${notesShort}</td>
            <td class="py-4 text-right">
              <div class="inline-flex items-center gap-2 justify-end">
                <button type="button" data-action="details" data-id="${escapeHtml(String(a.id))}" class="${btnCls}">
                  Dettagli
                </button>

                <button type="button" data-action="reschedule" data-id="${escapeHtml(String(a.id))}"
                  class="${canReschedule ? btnCls : btnDisabled}" ${canReschedule ? "" : "disabled"}>
                  Ripianifica
                </button>

                <button type="button" data-action="open-checkin" data-id="${escapeHtml(String(a.id))}"
                  class="${canOpenCheckIn ? btnCls : btnDisabled}" ${canOpenCheckIn ? "" : "disabled"}>
                  Apri accettazione
                </button>

                <button type="button" data-action="cancel" data-id="${escapeHtml(String(a.id))}"
                  class="${canCancel ? btnDanger : btnDisabled}" ${canCancel ? "" : "disabled"}>
                  Annulla
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = rows;
  }

  // Costruisce il contenuto HTML della modale di dettaglio appuntamento.
  function detailsBodyHtml(a) {
    const when = escapeHtml(fmtDateTime(a.startUtc));
    const patient = escapeHtml(a.patientName || "—");
    const service = escapeHtml(a.serviceCode || "—");
    const st = statusPill(a.status);
    const notes = a.notes ? escapeHtml(String(a.notes)) : "—";

    return `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Appuntamento</div>
          <div class="mt-2 grid gap-2 text-sm">
            <div class="flex items-start justify-between gap-4">
              <span class="text-slate-500">Riferimento</span>
              <span class="font-medium text-slate-800 text-right">${escapeHtml(String(a.id || "—"))}</span>
            </div>
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

  // Reindirizza al flusso amministrativo di accettazione per l’appuntamento scelto.
  function goToCheckIn(appointmentId) {
    window.location.href = `./check-in.html?appointmentId=${encodeURIComponent(String(appointmentId))}`;
  }

  // Apre la modale di dettaglio e compone dinamicamente le azioni contestuali.
  async function openDetailsModal(item) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    const canOpenCheckIn = canOpenCheckInFlow(item);
    const canCancel = isEligibleForCancel(item);
    const canReschedule = isEligibleForReschedule(item);
    const hasPatient = !!item.patientUserId;

    APL.ui.modal.open({
      title: "Dettagli appuntamento",
      bodyHtml: detailsBodyHtml(item),
      actions: [
        { label: "Chiudi", kind: "secondary" },

        // Se il paziente è noto, viene offerto l’accesso diretto alla sua scheda.
        ...(hasPatient
          ? [{
            label: "Scheda paziente",
            kind: "secondary",
            onClick: () => {
              const url = new URL("./patient-detail.html", window.location.href);
              url.searchParams.set("userId", String(item.patientUserId));
              window.location.href = url.toString();
            }
          }]
          : []),

        // Le azioni successive vengono abilitate solo se coerenti con lo stato corrente.
        ...(canReschedule ? [{ label: "Ripianifica", kind: "secondary", onClick: () => openRescheduleModal(item) }] : []),
        ...(canOpenCheckIn ? [{ label: "Apri accettazione", kind: "secondary", onClick: () => goToCheckIn(item.id) }] : []),
        ...(canCancel ? [{ label: "Annulla", kind: "danger", onClick: () => openCancelModal(item) }] : []),
      ],
    });
  }

  // Apre la modale di conferma per l’annullamento dell’appuntamento.
  async function openCancelModal(item) {
    const ok = await ensureModalReady(10000);
    if (!ok) return;

    const bodyHtml = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Riepilogo</div>
          <div class="mt-2 text-sm text-slate-800">
            <div class="font-medium">${escapeHtml(item.patientName || "Paziente")}</div>
            <div class="mt-1 text-slate-600">
              ${escapeHtml(item.serviceCode || "Prestazione")} • ${escapeHtml(fmtDateTime(item.startUtc))}
            </div>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700" for="cancelReason">Motivazione (opzionale)</label>
          <textarea id="cancelReason" rows="3" maxlength="300"
            class="mt-2 w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-red-100"
            placeholder="Inserire una breve motivazione amministrativa…"></textarea>
        </div>

        <div id="cancelErr" class="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"></div>
      </div>
    `;

    // Helper locale per mostrare l’errore direttamente nella modale di annullamento.
    const setErr = (msg) => {
      const box = document.getElementById("cancelErr");
      if (!box) return;

      if (!msg) {
        box.textContent = "";
        box.classList.add("hidden");
        return;
      }

      box.textContent = String(msg || "Operazione non riuscita.");
      box.classList.remove("hidden");
    };

    APL.ui.modal.open({
      title: "Annulla appuntamento",
      bodyHtml,
      actions: [
        { label: "Chiudi", kind: "secondary" },
        {
          label: "Conferma annullamento",
          kind: "danger",
          closeOnClick: false,
          onClick: async () => {
            setErr("");

            try {
              // La motivazione è opzionale e viene inviata solo se valorizzata.
              const reason = document.getElementById("cancelReason")?.value?.trim() || "";
              await apiJson("POST", API_CANCEL(item.id), { reason: reason || null });

              APL.ui.modal.close();
              APL.utils.toast("Appuntamento annullato.", "success");

              // Dopo l’annullamento si ricarica la lista per allineare la vista.
              await loadList();
            } catch (err) {
              setErr(humanize(err) || "Impossibile annullare l'appuntamento.");
            }
          },
        },
      ],
    });
  }

  // Recupera gli slot disponibili da usare durante la ripianificazione.
  async function fetchSlotsForReschedule(item, fromUtc, toUtc) {
    const clinicianId = item?.raw?.clinicianUserId || item?.raw?.clinicianId || item?.clinicianUserId || null;

    const params = new URLSearchParams();
    if (clinicianId) params.set("clinicianUserId", String(clinicianId));
    params.set("fromUtc", fromUtc);
    params.set("toUtc", toUtc);

    const data = await apiJson("GET", `${API_AVAILABILITY}?${params.toString()}`);
    return (Array.isArray(data) ? data : []).map(normalizeSlot);
  }

  // Costruisce l’HTML degli slot disponibili nella modale di ripianificazione.
  function slotsHtml(slots, selectedId) {
    const list = Array.isArray(slots) ? slots : [];

    if (!list.length) {
      return `<div class="text-sm text-slate-600">Nessuna disponibilità trovata per l’intervallo selezionato.</div>`;
    }

    // Raggruppa gli slot per giorno per una visualizzazione più leggibile.
    const byDay = new Map();
    for (const s of list) {
      const d = new Date(s.startUtc);
      const key = d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });

      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(s);
    }

    const keys = Array.from(byDay.keys()).sort((a, b) => a.localeCompare(b, "it"));

    return keys
      .map((key) => {
        const daySlots = byDay.get(key) || [];
        daySlots.sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));

        const header = new Date(daySlots[0].startUtc).toLocaleDateString("it-IT", {
          weekday: "long",
          day: "2-digit",
          month: "long",
        });

        // Ogni slot viene reso come bottone selezionabile.
        const buttons = daySlots
          .map((s) => {
            const id = String(s.id);
            const start = new Date(s.startUtc);
            const end = new Date(s.endUtc);

            const label = `${start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;
            const sel = selectedId && String(selectedId) === id;

            const cls = sel
              ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 focus:ring-blue-100"
              : "bg-white text-slate-700 border hover:bg-slate-50 focus:ring-blue-100";

            return `
              <button type="button" data-slot-id="${escapeHtml(id)}"
                class="h-11 inline-flex items-center justify-center rounded-xl border px-3 text-sm font-medium focus:outline-none focus:ring-4 ${cls}">
                ${escapeHtml(label)}
              </button>
            `;
          })
          .join("");

        return `
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="text-sm font-semibold text-slate-900 capitalize">${escapeHtml(header)}</div>
            <div class="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-3">
              ${buttons}
            </div>
          </div>
        `;
      })
      .join("");
  }

  // Apre la modale di ripianificazione dell’appuntamento.
  async function openRescheduleModal(item) {
    const ok = await ensureModalReady(10000);
    if (!ok) return;

    // Intervallo predefinito: da domani ai successivi 14 giorni.
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

    const fromDefault = toLocalDateInputValue(start);
    const toDefault = toLocalDateInputValue(end);

    let slots = [];
    let selectedSlotId = null;

    const bodyHtml = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Appuntamento attuale</div>
          <div class="mt-1 text-sm text-slate-800">
            <span class="font-medium">${escapeHtml(item.serviceCode || "Prestazione")}</span>
            <span class="text-slate-500">•</span>
            <span>${escapeHtml(fmtDateTime(item.startUtc))}</span>
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium text-slate-700" for="rsFrom">Da</label>
            <input id="rsFrom" type="date" value="${escapeHtml(fromDefault)}"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100" />
          </div>
          <div>
            <label class="text-sm font-medium text-slate-700" for="rsTo">A</label>
            <input id="rsTo" type="date" value="${escapeHtml(toDefault)}"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100" />
          </div>
        </div>

        <div class="flex items-center justify-between gap-3">
          <div class="text-sm text-slate-600">Selezioni un nuovo orario tra quelli disponibili.</div>
          <button id="btnRsSearch" type="button"
            class="h-10 inline-flex items-center justify-center rounded-xl border bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
            Cerca disponibilità
          </button>
        </div>

        <div id="rsHost" class="grid gap-3">
          <div class="text-sm text-slate-600">Avvii la ricerca per visualizzare gli orari disponibili.</div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="text-sm font-medium text-slate-700" for="rsReason">Motivo (opzionale)</label>
            <input id="rsReason" type="text" maxlength="200" autocomplete="off"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
              placeholder="Inserire un motivo…" />
          </div>
          <div>
            <label class="text-sm font-medium text-slate-700" for="rsNotes">Note (opzionale)</label>
            <input id="rsNotes" type="text" maxlength="400" autocomplete="off"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
              placeholder="Aggiungere eventuali note…" />
          </div>
        </div>

        <div id="rsErr" class="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"></div>
      </div>
    `;

    // Helper locale per la gestione degli errori nella modale di ripianificazione.
    const setErr = (msg) => {
      const box = document.getElementById("rsErr");
      if (!box) return;

      if (!msg) {
        box.textContent = "";
        box.classList.add("hidden");
        return;
      }

      box.textContent = msg;
      box.classList.remove("hidden");
    };

    // Esegue la ricerca degli slot disponibili nel range scelto dall’utente.
    const refreshSlots = async () => {
      setErr("");

      const from = String(document.getElementById("rsFrom")?.value || "").trim();
      const to = String(document.getElementById("rsTo")?.value || "").trim();

      if (!from || !to) {
        setErr("Selezioni l’intervallo di date.");
        return;
      }

      if (to < from) {
        setErr("L’intervallo di date non è valido.");
        return;
      }

      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (!range) {
        setErr("L’intervallo di ricerca non è valido.");
        return;
      }

      try {
        const rawSlots = await fetchSlotsForReschedule(item, range.fromUtc, range.toUtc);

        // Si escludono slot passati e lo slot già associato all’appuntamento corrente.
        const now2 = new Date();
        slots = rawSlots.filter((s) => {
          const start2 = new Date(s.startUtc);
          if (!Number.isFinite(start2.getTime())) return false;
          if (start2 <= now2) return false;
          if (String(s.id) === String(item.slotId)) return false;
          return true;
        });

        selectedSlotId = null;

        const host = document.getElementById("rsHost");
        if (host) host.innerHTML = slotsHtml(slots, selectedSlotId);
      } catch (err) {
        setErr(humanize(err) || "Impossibile caricare le disponibilità.");

        const host = document.getElementById("rsHost");
        if (host) host.innerHTML = `<div class="text-sm text-slate-600">Nessuna disponibilità da mostrare.</div>`;
      }
    };

    APL.ui.modal.open({
      title: "Ripianifica appuntamento",
      bodyHtml,
      actions: [
        { label: "Chiudi", kind: "secondary" },
        {
          label: "Conferma ripianificazione",
          kind: "primary",
          closeOnClick: false,
          onClick: async () => {
            setErr("");

            // Prima della conferma deve essere selezionato un nuovo slot.
            if (!selectedSlotId) {
              setErr("Selezioni un nuovo orario prima di confermare.");
              return;
            }

            const reason = String(document.getElementById("rsReason")?.value || "").trim() || null;
            const notes = String(document.getElementById("rsNotes")?.value || "").trim() || null;

            try {
              await apiJson("POST", API_RESCHEDULE(item.id), {
                newSlotId: selectedSlotId,
                reason,
                notes
              });

              APL.utils.toast("Appuntamento ripianificato.", "success");

              if (APL.ui?.modal?.close) APL.ui.modal.close();

              // Ricarica la lista per riflettere data/orario aggiornati.
              await loadList();
            } catch (err) {
              setErr(humanize(err) || "Operazione non riuscita.");
            }
          },
        },
      ],
    });

    // Collegamento del pulsante che avvia la ricerca di nuove disponibilità.
    const btn = document.getElementById("btnRsSearch");
    if (btn) btn.addEventListener("click", refreshSlots);

    // Gestione della selezione del nuovo slot direttamente nel contenitore degli orari.
    const host = document.getElementById("rsHost");
    if (host) {
      host.addEventListener("click", (ev) => {
        const b = ev.target?.closest?.("button[data-slot-id]");
        if (!b) return;

        const slotId = b.getAttribute("data-slot-id");
        if (!slotId) return;

        const found = slots.find((s) => String(s.id) === String(slotId));
        if (!found) return;

        // Ulteriore verifica locale per evitare la selezione di slot ormai scaduti.
        const now3 = new Date();
        if (new Date(found.startUtc) <= now3) {
          APL.utils.toast("L’orario selezionato non è più disponibile.", "error");
          selectedSlotId = null;
        } else {
          selectedSlotId = String(found.id);
        }

        host.innerHTML = slotsHtml(slots, selectedSlotId);
      });
    }
  }

  // Carica tutti i clinici necessari per popolare il filtro di pagina.
  async function loadClinicians() {
    const all = [];
    let skip = 0;

    // Paginazione esplicita per gestire dataset potenzialmente ampi.
    for (let page = 0; page < CLINICIANS_MAX_PAGES; page++) {
      const url = `${API_CLINICIANS_LIST}?skip=${skip}&take=${CLINICIANS_PAGE_SIZE}`;
      const data = await apiJson("GET", url);
      const chunk = Array.isArray(data) ? data : [];
      all.push(...chunk);

      if (chunk.length < CLINICIANS_PAGE_SIZE) break;
      skip += CLINICIANS_PAGE_SIZE;
    }

    _clinicians = all.slice().sort((a, b) => String(a.email || "").localeCompare(String(b.email || ""), "it"));
    _clinicianById.clear();

    // Costruzione della mappa per accesso rapido ai dati del clinico.
    for (const c of _clinicians) _clinicianById.set(String(c.userId), c);

    const sel = $("clinicianSelect");
    if (!sel) return;

    const current = String(sel.value || "");

    sel.innerHTML = `<option value="">Tutti i clinici</option>`;
    for (const c of _clinicians) {
      const id = String(c.userId || "");
      const email = String(c.email || "").trim();
      const spec = String(c.specialty || "").trim();
      const label = spec ? `${email} — ${spec}` : email;

      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label || id || "Clinico";
      sel.appendChild(opt);
    }

    // Se possibile, mantiene il valore precedentemente selezionato.
    sel.value = current;
    updateSelectedClinicianPill();
  }

  // Aggiorna la pill informativa del clinico selezionato.
  function updateSelectedClinicianPill() {
    const pill = $("selectedClinicianPill");
    const label = $("selectedClinicianLabel");
    if (!pill || !label) return;

    const clinicianId = String($("clinicianSelect")?.value || "");
    if (!clinicianId) {
      pill.classList.add("hidden");
      label.textContent = "";
      return;
    }

    label.textContent = clinicianDisplayById(clinicianId);
    pill.classList.remove("hidden");
  }

  // Dataset completo attualmente caricato dalla pagina.
  let _all = [];

  // Timer usato per applicare il debounce sulla ricerca testuale.
  let _debounce = null;

  // Recupera dal back-end la lista degli appuntamenti nel range selezionato.
  async function fetchList(fromUtc, toUtc, clinicianUserId) {
    const params = new URLSearchParams();
    params.set("fromUtc", fromUtc);
    params.set("toUtc", toUtc);

    const base = clinicianUserId
      ? API_APPOINTMENTS_BY_CLINICIAN(clinicianUserId)
      : API_APPOINTMENTS_ALL;

    const url = `${base}?${params.toString()}`;
    const data = await apiJson("GET", url);
    return Array.isArray(data) ? data : [];
  }

  // Legge dall’URL un eventuale appointmentId da aprire automaticamente in dettaglio.
  function readQueryAppointmentId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("appointmentId");
    return v ? String(v) : null;
  }

  // Legge dall’URL un eventuale clinico pre-selezionato.
  function readQueryClinicianId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("clinicianUserId") || q.get("clinicianId") || q.get("userId");
    return v ? String(v) : "";
  }

  // Carica l’elenco appuntamenti e ne aggiorna la resa in pagina.
  async function loadList() {
    clearError();
    setLoading(true);

    try {
      // Costruzione dell’intervallo di ricerca e del filtro per clinico.
      const r = readRangeOrDefault();
      const clinicianId = String($("clinicianSelect")?.value || "").trim() || null;

      // Chiamata al back-end e normalizzazione dei risultati.
      const data = await fetchList(r.fromUtc, r.toUtc, clinicianId);
      _all = (Array.isArray(data) ? data : []).map(normalizeItem);

      // Applicazione dei filtri lato client e rendering tabella.
      const filtered = filterClientSide(_all);
      renderRows(filtered);

      // Se l’URL richiede l’apertura di uno specifico appuntamento, si apre la modale.
      const qId = readQueryAppointmentId();
      if (qId) {
        const found = _all.find((x) => String(x.id) === String(qId)) || null;
        if (found) {
          await openDetailsModal(found);

          // Dopo l’apertura, il parametro viene rimosso dall’URL per evitare riaperture successive.
          const url = new URL(window.location.href);
          url.searchParams.delete("appointmentId");
          window.history.replaceState(null, "", url.toString());
        }
      }
    } catch (err) {
      console.error(err);
      _all = [];
      renderRows([]);
      showError(humanize(err) || "Errore imprevisto.");
    } finally {
      setLoading(false);
    }
  }

  // Pianifica il rerender con debounce per evitare aggiornamenti troppo frequenti.
  function scheduleRender() {
    if (_debounce) clearTimeout(_debounce);

    _debounce = setTimeout(() => {
      const filtered = filterClientSide(_all);
      renderRows(filtered);
    }, 250);
  }

  // Costruisce il contenuto CSV da esportare.
  function buildCsv(rows) {
    const header = ["Riferimento", "Data/ora", "Paziente", "Prestazione", "Stato", "Note"];
    const lines = [header];

    for (const a of (Array.isArray(rows) ? rows : [])) {
      const line = [
        String(a?.id || ""),
        fmtDateTime(a?.startUtc),
        String(a?.patientName || ""),
        String(a?.serviceCode || ""),
        mapStatus(a?.status).label,
        String(a?.notes || ""),
      ].map((v) => {
        const s = String(v ?? "");
        const escaped = s.replaceAll('"', '""');
        return `"${escaped}"`;
      });

      lines.push(line);
    }

    return "\uFEFF" + lines.map((r) => r.join(",")).join("\n");
  }

  // Esporta in CSV la lista attualmente filtrata.
  function downloadCsv() {
    const filtered = filterClientSide(_all);

    if (!filtered.length) {
      APL.utils.toast("Nessun dato da esportare.", "info");
      return;
    }

    const csv = buildCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);

    a.download = `appuntamenti_${stamp}.csv`;
    a.href = URL.createObjectURL(blob);

    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 250);
  }

  // Collega tutti gli handler degli elementi interattivi della pagina.
  function wireHandlers() {
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", () => loadList());

    const btnRefreshEmpty = $("btnRefreshEmpty");
    if (btnRefreshEmpty) btnRefreshEmpty.addEventListener("click", () => loadList());

    const btnToday = $("btnToday");
    if (btnToday) btnToday.addEventListener("click", () => {
      applyQuickRange("today");
      loadList();
    });

    const btnNext7 = $("btnNext7");
    if (btnNext7) btnNext7.addEventListener("click", () => {
      applyQuickRange("next7");
      loadList();
    });

    const btnReset = $("btnResetFilters");
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        // Ripristina i valori di default dell’interfaccia.
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

        if ($("fromDate")) $("fromDate").value = toLocalDateInputValue(today);
        if ($("toDate")) $("toDate").value = toLocalDateInputValue(end);
        if ($("statusSelect")) $("statusSelect").value = "ALL";
        if ($("searchInput")) $("searchInput").value = "";
        if ($("clinicianSelect")) $("clinicianSelect").value = "";

        updateSelectedClinicianPill();
        loadList();
      });
    }

    const clinicianSelect = $("clinicianSelect");
    if (clinicianSelect) {
      clinicianSelect.addEventListener("change", () => {
        updateSelectedClinicianPill();
        loadList();
      });
    }

    const statusSelect = $("statusSelect");
    if (statusSelect) statusSelect.addEventListener("change", () => scheduleRender());

    const searchInput = $("searchInput");
    if (searchInput) {
      // La ricerca testuale usa debounce per limitare i ricalcoli della tabella.
      searchInput.addEventListener("input", () => scheduleRender());

      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (_debounce) clearTimeout(_debounce);
          scheduleRender();
        }
      });
    }

    const fromDate = $("fromDate");
    const toDate = $("toDate");
    if (fromDate) fromDate.addEventListener("change", () => loadList());
    if (toDate) toDate.addEventListener("change", () => loadList());

    const btnExport = $("btnExport");
    if (btnExport) btnExport.addEventListener("click", () => downloadCsv());

    const tbody = $("appointmentsTbody");
    if (tbody) {
      tbody.addEventListener("click", async (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        // Individua il pulsante azione cliccato sulla riga.
        const btn = t.closest("button[data-action]");
        if (!btn) return;

        const action = btn.getAttribute("data-action") || "";
        const id = btn.getAttribute("data-id") || "";

        // Recupera l’elemento corrispondente dal dataset corrente.
        const item = _all.find((x) => String(x.id) === String(id)) || null;
        if (!item) {
          APL.utils.toast("Elemento non disponibile.", "error");
          return;
        }

        // Esegue l’azione richiesta.
        if (action === "details") await openDetailsModal(item);
        if (action === "reschedule") await openRescheduleModal(item);
        if (action === "open-checkin") goToCheckIn(item.id);
        if (action === "cancel") await openCancelModal(item);
      });
    }
  }

  // Inizializzazione della pagina.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Verifica che l’utente corrente sia autorizzato ad accedere alla vista Admin.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Imposta l’intervallo iniziale: oggi + 7 giorni.
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    if ($("fromDate")) $("fromDate").value = toLocalDateInputValue(today);
    if ($("toDate")) $("toDate").value = toLocalDateInputValue(end);

    // Attiva tutti gli event listener della pagina.
    wireHandlers();

    try {
      // Carica il filtro dei clinici e applica l’eventuale preselezione da query string.
      await loadClinicians();

      const qClinician = readQueryClinicianId();
      if (qClinician && $("clinicianSelect")) {
        $("clinicianSelect").value = qClinician;
        updateSelectedClinicianPill();
      }
    } catch (_) {
      // Il fallimento nel caricamento dei clinici non blocca l’intera pagina:
      // la lista appuntamenti può comunque essere caricata globalmente.
    }

    // Carica infine l’elenco appuntamenti con i filtri iniziali.
    await loadList();
  }

  // Esegue l’inizializzazione solo quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
