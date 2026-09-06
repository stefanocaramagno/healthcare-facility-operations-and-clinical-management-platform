/**
 * File: frontend/js/admin/check-in.js
 *
 * Scopo
 * -----
 * Gestire il caricamento, il filtraggio, la visualizzazione e le azioni
 * operative della pagina amministrativa di check-in appuntamenti, includendo
 * la consultazione dei dettagli, la conferma del check-in e la marcatura
 * dell’assenza del paziente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della pagina di check-in
 * nell’area Admin. Si integra con i moduli condivisi del front-end per
 * verificare il ruolo dell’utente autenticato, interrogare gli endpoint
 * protetti del dominio Scheduling, popolare la tabella degli appuntamenti,
 * aggiornare le statistiche sintetiche e governare le finestre modali
 * collegate alle azioni amministrative.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - inizializzare i filtri temporali e i controlli di ricerca;
 * - caricare la lista appuntamenti nell’intervallo selezionato;
 * - normalizzare i dati ricevuti dal backend in una forma uniforme;
 * - applicare filtri client-side per stato e ricerca testuale;
 * - renderizzare tabella, stato vuoto e riepilogo statistico;
 * - aprire il dettaglio di un appuntamento in finestra modale;
 * - consentire il check-in amministrativo quando le regole lo permettono;
 * - consentire la marcatura no-show quando l’appuntamento risulta assente;
 * - gestire stati di caricamento, errori globali e messaggi di conferma.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading`,
 *   `APL.utils.toRomeDateInputValue`, `APL.utils.romeTodayDateInputValue`,
 *   `APL.utils.romeDateRangeToUtc`, `APL.utils.addDaysToDateInput`
 *   e `APL.utils.toast`;
 * - utilizza `APL.ui.modal` per la visualizzazione dei dettagli e per le
 *   conferme operative di check-in e no-show;
 * - interagisce con gli endpoint:
 *   `/api/scheduling/admin/appointments`,
 *   `/api/scheduling/admin/agenda`,
 *   `/api/scheduling/appointments`,
 *   `/api/scheduling/admin/appointments/{appointmentId}/check-in`,
 *   `/api/scheduling/admin/appointments/{appointmentId}/no-show`;
 * - aggiorna dinamicamente il DOM della pagina di check-in amministrativo.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * Lo script supporta sia il caricamento standard della lista sia l’apertura
 * automatica del dettaglio di uno specifico appuntamento tramite parametro
 * `appointmentId` nella query string.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint primario per il recupero della lista appuntamenti lato amministrativo.
  const API_LIST_PRIMARY = "/api/scheduling/admin/appointments";

  // Endpoint alternativi usati come fallback se l’endpoint principale non è disponibile.
  const API_LIST_FALLBACKS = [
    "/api/scheduling/admin/agenda",
    "/api/scheduling/appointments",
  ];

  // Restituisce un elemento DOM tramite il suo id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel contenitore globale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    // Imposta il testo del messaggio e rende visibile il contenitore.
    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore globale degli errori.
  function clearError() {
    const box = $("pageError");
    if (!box) return;

    // Ripristina il contenuto e lo stato iniziale.
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Traduce un errore tecnico in un messaggio più adatto all’interfaccia utente.
  function humanize(err) {
    if (window.APL?.utils?.humanizeError) return APL.utils.humanizeError(err);
    return err && err.message ? String(err.message) : "Errore imprevisto.";
  }

  // Aggiorna gli indicatori di caricamento e abilita/disabilita i controlli della pagina.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Aggiorna lo stato del pulsante di refresh usando l’utility condivisa.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

    // Durante il caricamento disabilita i controlli che alterano il perimetro della ricerca.
    const ids = ["fromDate", "toDate", "statusSelect", "searchInput", "btnToday", "btnNext7", "btnResetFilters"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Mostra o nasconde lo stato vuoto della lista appuntamenti.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Esegue l’escape HTML di una stringa per evitare injection nel markup generato.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Converte una data JavaScript nel formato compatibile con un input date locale.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formattta una data/ora UTC in una rappresentazione leggibile per l’utente italiano.
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

  // Normalizza uno stato eterogeneo in un formato confrontabile e uniforme.
  function normalizeStatus(raw) {
    return String(raw || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
  }

  // Associa allo stato grezzo una label utente e una tonalità semantica.
  function mapStatus(raw) {
    const s = normalizeStatus(raw);

    if (s === "BOOKED") return { label: "Prenotato", tone: "blue" };
    if (s === "CHECKED_IN") return { label: "Accettato", tone: "amber" };
    if (s === "COMPLETED") return { label: "Completato", tone: "emerald" };
    if (s === "CANCELED" || s === "CANCELLED") return { label: "Annullato", tone: "slate" };
    if (s === "NO_SHOW") return { label: "Assente", tone: "slate" };

    return { label: raw || "—", tone: "slate" };
  }

  // Restituisce il badge HTML che rappresenta lo stato dell’appuntamento.
  function statusPill(raw) {
    const m = mapStatus(raw);

    // Mappa la tonalità semantica su classi Tailwind coerenti con la UI.
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

  // Attende che il sistema di modali condiviso sia disponibile prima di usarlo.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();

    // Esegue polling breve fino alla disponibilità dell’API di apertura modale.
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Esegue una richiesta JSON autenticata e centralizza la gestione degli errori HTTP principali.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // In caso di sessione scaduta ripulisce lo stato locale e reindirizza alla pagina dedicata.
      if (res.status === 401) {
        try {
          APL.session.clearAuth();
        } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // In caso di accesso vietato forza il redirect alla pagina di forbidden.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Per gli altri errori prova a recuperare un messaggio applicativo dal payload.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Normalizza un record appuntamento proveniente dal backend in una struttura uniforme lato client.
  function normalizeItem(x) {
    const startUtc = x.startUtc || x.start || x.whenUtc || x.beginUtc || null;

    const serviceName =
      x.serviceName ||
      (x.service && (x.service.name || x.service.title)) ||
      x.serviceTitle ||
      x.serviceCode ||
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

    const notes = x.notes || x.note || x.patientNotes || null;

    return {
      id: x.id ?? x.appointmentId ?? x.bookingId ?? null,
      startUtc,
      status: x.status || x.state || null,
      serviceName,
      serviceCode,
      patientName,
      notes,
      raw: x,
    };
  }

  // Legge l’intervallo date dalla UI oppure applica un valore di default centrato su oggi.
  function readRangeOrDefault() {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    // Usa l’intervallo esplicito solo se entrambi i valori sono presenti e coerenti.
    if (from && to && to >= from) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) return range;
    }

    // In assenza di valori validi usa il giorno corrente come intervallo di default.
    const today = APL.utils.romeTodayDateInputValue();
    return APL.utils.romeDateRangeToUtc(today, today);
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
    }
  }

  // Verifica se l’appuntamento è ancora in attesa di check-in.
  function isPending(appt) {
    return normalizeStatus(appt?.status) === "BOOKED";
  }

  // Verifica se l’appuntamento risulta già accettato.
  function isCheckedIn(appt) {
    return normalizeStatus(appt?.status) === "CHECKED_IN";
  }

  // Determina se l’appuntamento rientra nella finestra temporale utile per il check-in.
  function isEligibleForCheckIn(appt) {
    if (!appt || !appt.id) return false;
    if (!isPending(appt)) return false;

    const start = appt.startUtc ? new Date(appt.startUtc) : null;

    // Se la data non è valida, consente l’azione solo sulla base dello stato.
    if (!start || !Number.isFinite(start.getTime())) return true;

    const now = new Date();
    const diffMin = (start.getTime() - now.getTime()) / 60000;

    // Il check-in è consentito da 30 minuti prima fino a 120 minuti dopo l’orario previsto.
    return diffMin <= 30 && diffMin >= -120;
  }

  // Determina se l’appuntamento può essere marcato come no-show.
  function isEligibleForNoShow(appt) {
    if (!appt || !appt.id) return false;
    if (!isPending(appt)) return false;

    const start = appt.startUtc ? new Date(appt.startUtc) : null;
    if (!start || !Number.isFinite(start.getTime())) return false;

    const now = new Date();

    // L’assenza può essere registrata solo dopo due ore dall’orario di inizio.
    return now.getTime() >= start.getTime() + (2 * 60 * 60 * 1000);
  }

  // Aggiorna i contatori statistici sintetici mostrati nella parte alta della pagina.
  function setStats(list) {
    const items = Array.isArray(list) ? list : [];
    const total = items.length;
    const pending = items.filter((x) => isPending(x)).length;
    const checked = items.filter((x) => isCheckedIn(x)).length;

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statPending")) $("statPending").textContent = String(pending);
    if ($("statCheckedIn")) $("statCheckedIn").textContent = String(checked);
  }

  // Applica il filtro lato client per stato e ricerca testuale.
  function filterClientSide(items) {
    const statusSel = String($("statusSelect")?.value || "PENDING").toUpperCase();
    const term = String($("searchInput")?.value || "").trim().toLowerCase();

    return (Array.isArray(items) ? items : []).filter((a) => {
      const normalized = normalizeStatus(a.status);

      // Filtra per stato secondo il valore attualmente selezionato nella UI.
      if (statusSel === "PENDING" && normalized !== "BOOKED") return false;
      if (statusSel === "CHECKED_IN" && normalized !== "CHECKED_IN") return false;
      if (statusSel !== "PENDING" && statusSel !== "CHECKED_IN" && statusSel !== "ALL" && normalized !== statusSel) return false;

      // Se non è presente un termine di ricerca, il record è già compatibile.
      if (!term) return true;

      // La ricerca libera opera su paziente, prestazione, riferimento e note.
      const p = String(a.patientName || "").toLowerCase();
      const s = String(a.serviceName || a.serviceCode || "").toLowerCase();
      const id = String(a.id || "").toLowerCase();
      const n = String(a.notes || "").toLowerCase();

      return p.includes(term) || s.includes(term) || id.includes(term) || n.includes(term);
    });
  }

  // Renderizza la tabella degli appuntamenti e aggiorna stato vuoto e statistiche.
  function renderRows(items) {
    const tbody = $("checkinTbody");
    if (!tbody) return;

    const list = Array.isArray(items) ? items : [];
    setStats(list);

    // Se non sono presenti record da mostrare, espone lo stato vuoto e una riga descrittiva.
    if (!list.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    // Classi CSS riutilizzate per i pulsanti azione attivi e disabilitati.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";
    const btnClsDisabled =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-400 cursor-not-allowed opacity-70";

    const rows = list
      .slice()
      .sort((a, b) => new Date(a.startUtc || 0) - new Date(b.startUtc || 0))
      .map((a) => {
        const when = escapeHtml(fmtDateTime(a.startUtc));
        const patient = escapeHtml(a.patientName || "—");
        const service = escapeHtml(a.serviceName || a.serviceCode || "—");
        const st = statusPill(a.status);
        const notesRaw = a.notes ? String(a.notes) : "—";
        const notesText = escapeHtml(notesRaw);

        // Calcola in anticipo la disponibilità delle azioni per il singolo appuntamento.
        const canCheckIn = isEligibleForCheckIn(a) && !isCheckedIn(a);
        const canNoShow = isEligibleForNoShow(a);

        return `
          <tr>
            <td class="py-4 pr-4 text-slate-800">${when}</td>
            <td class="py-4 pr-4 text-slate-700">${patient}</td>
            <td class="py-4 pr-4 text-slate-700">${service}</td>
            <td class="py-4 pr-4">${st}</td>
            <td class="py-4 pr-4 text-slate-600 max-w-[360px] truncate" title="${notesText}">${notesText}</td>
            <td class="py-4 text-right">
              <div class="inline-flex items-center gap-2 justify-end">
                <button type="button" data-action="details" data-id="${escapeHtml(String(a.id))}" class="${btnCls}">
                  Dettagli
                </button>
                <button type="button" data-action="checkin" data-id="${escapeHtml(String(a.id))}"
                  class="${canCheckIn ? btnCls : btnClsDisabled}" ${canCheckIn ? "" : "disabled"}>
                  Check-in
                </button>
                <button type="button" data-action="noshow" data-id="${escapeHtml(String(a.id))}"
                  class="${canNoShow ? btnCls : btnClsDisabled}" ${canNoShow ? "" : "disabled"}>
                  Segna assente
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = rows;
  }

  // Recupera dal backend la lista appuntamenti nell’intervallo temporale richiesto.
  async function fetchList(fromUtc, toUtc) {
    const params = new URLSearchParams();
    params.set("fromUtc", fromUtc);
    params.set("toUtc", toUtc);

    // Prova l’endpoint principale e, se necessario, eventuali varianti retrocompatibili.
    const tryUrls = [API_LIST_PRIMARY, ...API_LIST_FALLBACKS];

    let lastErr = null;
    for (const base of tryUrls) {
      try {
        const url = `${base}?${params.toString()}`;
        const data = await apiJson("GET", url);
        return Array.isArray(data) ? data : [];
      } catch (err) {
        lastErr = err;

        // Se un endpoint non esiste, passa al fallback successivo senza interrompere il flusso.
        if (err && typeof err === "object" && Number(err.status) === 404) continue;

        throw err;
      }
    }

    throw lastErr || new Error("Impossibile caricare gli appuntamenti.");
  }

  // Costruisce il corpo HTML della modale di dettaglio appuntamento.
  function detailsBodyHtml(a) {
    const when = escapeHtml(fmtDateTime(a.startUtc));
    const patient = escapeHtml(a.patientName || "—");
    const service = escapeHtml(a.serviceName || a.serviceCode || "—");
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

  // Invia al backend la richiesta di conferma check-in per l’appuntamento indicato.
  async function postCheckIn(appointmentId, payload) {
    const url = `${API_LIST_PRIMARY}/${encodeURIComponent(String(appointmentId))}/check-in`;
    await apiJson("POST", url, payload);
    return true;
  }

  // Invia al backend la richiesta di marcatura no-show per l’appuntamento indicato.
  async function postNoShow(appointmentId, payload) {
    const url = `${API_LIST_PRIMARY}/${encodeURIComponent(String(appointmentId))}/no-show`;
    await apiJson("POST", url, payload);
    return true;
  }

  // Apre la modale di dettaglio appuntamento con azioni contestuali coerenti allo stato corrente.
  async function openDetailsModal(item) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    const canCheckIn = isEligibleForCheckIn(item) && !isCheckedIn(item);
    const canNoShow = isEligibleForNoShow(item);

    APL.ui.modal.open({
      title: "Dettagli appuntamento",
      bodyHtml: detailsBodyHtml(item),
      actions: [
        { label: "Chiudi", kind: "secondary" },
        ...(canNoShow
          ? [
            {
              label: "Segna assente",
              kind: "danger",
              closeOnClick: true,
              onClick: async () => openNoShowModal(item),
            },
          ]
          : []),
        ...(canCheckIn
          ? [
            {
              label: "Check-in",
              kind: "primary",
              closeOnClick: true,
              onClick: async () => openCheckInModal(item),
            },
          ]
          : []),
      ],
    });
  }

  // Apre la modale di conferma del check-in amministrativo.
  async function openCheckInModal(item) {
    const ok = await ensureModalReady(10000);
    if (!ok) return;

    // Il corpo della modale raccoglie le verifiche minime richieste prima dell’accettazione.
    const bodyHtml = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Riepilogo</div>
          <div class="mt-2 text-sm text-slate-800">
            <div class="font-medium">${escapeHtml(item.patientName || "Paziente")}</div>
            <div class="mt-1 text-slate-600">
              ${escapeHtml(item.serviceName || item.serviceCode || "Prestazione")} • ${escapeHtml(fmtDateTime(item.startUtc))}
            </div>
          </div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-sm font-semibold text-slate-900">Verifiche</div>
          <p class="mt-1 text-sm text-slate-600">Confermi di aver completato i controlli essenziali.</p>

          <div class="mt-4 grid gap-2">
            <label class="inline-flex items-center gap-2">
              <input id="chkRegistry" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
              <span class="text-sm text-slate-700">Anagrafica verificata</span>
            </label>
            <label class="inline-flex items-center gap-2">
              <input id="chkConsents" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
              <span class="text-sm text-slate-700">Consensi verificati</span>
            </label>
            <label class="inline-flex items-center gap-2">
              <input id="chkPayment" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
              <span class="text-sm text-slate-700">Pagamento verificato (se richiesto)</span>
            </label>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700" for="checkinNotes">Note (opzionale)</label>
          <textarea id="checkinNotes" rows="3" maxlength="500"
            class="mt-2 w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="Aggiungere eventuali note…"></textarea>
        </div>

        <div id="checkinErr" class="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"></div>
      </div>
    `;

    // Aggiorna l’eventuale errore contestuale mostrato all’interno della modale.
    const setErr = (msg) => {
      const box = document.getElementById("checkinErr");
      if (!box) return;

      if (!msg) {
        box.textContent = "";
        box.classList.add("hidden");
        return;
      }

      box.textContent = msg;
      box.classList.remove("hidden");
    };

    APL.ui.modal.open({
      title: "Conferma check-in",
      bodyHtml,
      actions: [
        { label: "Annulla", kind: "secondary" },
        {
          label: "Conferma",
          kind: "primary",
          closeOnClick: false,
          onClick: async () => {
            setErr("");

            const reg = !!document.getElementById("chkRegistry")?.checked;
            const con = !!document.getElementById("chkConsents")?.checked;

            // Richiede almeno la conferma di anagrafica e consensi prima di proseguire.
            if (!reg || !con) {
              setErr("Per procedere, confermi anagrafica e consensi.");
              return;
            }

            const notes = String(document.getElementById("checkinNotes")?.value || "").trim() || null;

            try {
              await postCheckIn(item.id, {
                notes,
                confirmations: {
                  registryVerified: reg,
                  consentsVerified: con,
                  paymentVerified: !!document.getElementById("chkPayment")?.checked,
                },
              });

              APL.utils.toast("Check-in completato.", "success");
              if (APL.ui?.modal?.close) APL.ui.modal.close();

              // Dopo il salvataggio ricarica la lista per riflettere il nuovo stato dell’appuntamento.
              await loadList();
            } catch (err) {
              setErr(humanize(err) || "Operazione non riuscita.");
            }
          },
        },
      ],
    });
  }

  // Apre la modale di conferma per la marcatura dell’appuntamento come assente.
  async function openNoShowModal(item) {
    const ok = await ensureModalReady(10000);
    if (!ok) return;

    const bodyHtml = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Riepilogo</div>
          <div class="mt-2 text-sm text-slate-800">
            <div class="font-medium">${escapeHtml(item.patientName || "Paziente")}</div>
            <div class="mt-1 text-slate-600">
              ${escapeHtml(item.serviceName || item.serviceCode || "Prestazione")} • ${escapeHtml(fmtDateTime(item.startUtc))}
            </div>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700" for="noShowReason">Motivazione (opzionale)</label>
          <textarea id="noShowReason" rows="3" maxlength="300"
            class="mt-2 w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="Inserire una breve motivazione amministrativa…"></textarea>
        </div>

        <div id="noShowErr" class="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"></div>
      </div>
    `;

    // Aggiorna l’eventuale errore contestuale mostrato nella modale no-show.
    const setErr = (msg) => {
      const box = document.getElementById("noShowErr");
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
      title: "Segna appuntamento come assente",
      bodyHtml,
      actions: [
        { label: "Chiudi", kind: "secondary" },
        {
          label: "Conferma assenza",
          kind: "danger",
          closeOnClick: false,
          onClick: async () => {
            setErr("");

            try {
              const reason = document.getElementById("noShowReason")?.value?.trim() || "";
              await postNoShow(item.id, { reason: reason || null });
              APL.ui.modal.close();
              APL.utils.toast("Appuntamento marcato come assente.", "success");

              // Dopo l’aggiornamento ricarica la lista per riflettere il nuovo stato.
              await loadList();
            } catch (err) {
              setErr(humanize(err) || "Impossibile marcare l'appuntamento come assente.");
            }
          },
        },
      ],
    });
  }

  // Legge dalla query string l’eventuale appointmentId richiesto per un’apertura diretta del dettaglio.
  function readQueryAppointmentId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("appointmentId");
    return v ? String(v) : null;
  }

  // Stato locale della pagina: cache degli appuntamenti caricati e timer per il debounce della ricerca.
  let _all = [];
  let _debounce = null;

  // Carica la lista appuntamenti dal backend e aggiorna l’interfaccia.
  async function loadList() {
    clearError();
    setLoading(true);

    try {
      const r = readRangeOrDefault();
      const data = await fetchList(r.fromUtc, r.toUtc);

      // Normalizza i dati ricevuti una sola volta e li conserva in cache locale.
      _all = (Array.isArray(data) ? data : []).map(normalizeItem);

      const filtered = filterClientSide(_all);
      renderRows(filtered);

      // Se la query string contiene un appointmentId, apre automaticamente il dettaglio corrispondente.
      const qId = readQueryAppointmentId();
      if (qId) {
        const found = _all.find((x) => String(x.id) === String(qId)) || null;
        if (found) {
          await openDetailsModal(found);
        }
      }
    } catch (err) {
      console.error(err);
      _all = [];
      renderRows([]);
      showError(humanize(err) || "Impossibile caricare la lista.");
    } finally {
      setLoading(false);
    }
  }

  // Riapplica i filtri client-side ai dati già caricati senza effettuare una nuova chiamata remota.
  function reRender() {
    const filtered = filterClientSide(_all);
    renderRows(filtered);
  }

  // Cerca nella cache locale l’appuntamento con l’identificativo richiesto.
  function findById(id) {
    return _all.find((x) => String(x.id) === String(id)) || null;
  }

  // Collega la tabella agli handler delle azioni contestuali tramite event delegation.
  function wireActions() {
    const tbody = $("checkinTbody");
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

      if (action === "checkin") {
        await openCheckInModal(item);
        return;
      }

      if (action === "noshow") {
        await openNoShowModal(item);
        return;
      }
    });
  }

  // Inizializza l’intervallo date di default al giorno corrente.
  function initDefaultRange() {
    const fromEl = $("fromDate");
    const toEl = $("toDate");
    if (!fromEl || !toEl) return;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    fromEl.value = toLocalDateInputValue(today);
    toEl.value = toLocalDateInputValue(today);
  }

  // Collega i controlli della pagina ai relativi comportamenti applicativi.
  function initControls() {
    const btnRefresh = $("btnRefresh");
    const btnToday = $("btnToday");
    const btnNext7 = $("btnNext7");
    const btnReset = $("btnResetFilters");

    const fromDate = $("fromDate");
    const toDate = $("toDate");
    const statusSelect = $("statusSelect");
    const searchInput = $("searchInput");

    if (btnRefresh) btnRefresh.addEventListener("click", loadList);

    if (btnToday) btnToday.addEventListener("click", () => {
      applyQuickRange("today");
      loadList();
    });

    if (btnNext7) btnNext7.addEventListener("click", () => {
      applyQuickRange("next7");
      loadList();
    });

    if (btnReset) {
      btnReset.addEventListener("click", () => {
        // Ripristina l’assetto iniziale dei filtri della pagina.
        if (statusSelect) statusSelect.value = "PENDING";
        if (searchInput) searchInput.value = "";
        applyQuickRange("today");
        loadList();
      });
    }

    // Le variazioni dell’intervallo temporale richiedono un nuovo caricamento dal backend.
    if (fromDate) fromDate.addEventListener("change", loadList);
    if (toDate) toDate.addEventListener("change", loadList);

    // Il filtro stato opera solo sui dati già presenti in cache locale.
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

  // Inizializza l’intera pagina dopo il caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impedisce l’uso della pagina se l’utente non è autenticato o non appartiene al ruolo previsto.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    try {
      initDefaultRange();
      initControls();
      wireActions();

      // Attende la disponibilità del sistema modale prima del primo utilizzo possibile.
      await ensureModalReady(10000);
      await loadList();
    } catch (err) {
      console.error(err);
      showError(humanize(err) || "Impossibile caricare la pagina.");
    }
  }

  // Avvia l’inizializzazione della pagina quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
