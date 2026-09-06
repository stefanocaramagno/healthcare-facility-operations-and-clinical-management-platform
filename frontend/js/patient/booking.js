/**
 * File: frontend/js/patient/booking.js
 *
 * Scopo
 * -----
 * Gestire il flusso client-side della pagina di prenotazione del paziente,
 * includendo il caricamento del catalogo prestazioni, la ricerca delle
 * disponibilità, la selezione di uno slot e la conferma finale della
 * prenotazione con eventuali note aggiuntive.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Prenota una
 * prestazione" dell’area Patient. Si integra con i moduli condivisi del
 * front-end per autenticazione, sessione, richieste HTTP, gestione modali,
 * formattazione date e notifiche toast, coordinando i passaggi che portano
 * dalla scelta di una prestazione alla creazione dell’appuntamento.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Patient;
 * - caricare e filtrare il catalogo delle prestazioni disponibili;
 * - mostrare il riepilogo della prestazione selezionata;
 * - cercare le disponibilità in un intervallo temporale scelto dal paziente;
 * - raggruppare e renderizzare gli slot disponibili per clinico e per giorno;
 * - permettere la selezione di uno slot e aggiornare il riepilogo laterale;
 * - inviare la richiesta di prenotazione al backend;
 * - gestire il caso di consensi mancanti, esponendo il link alla relativa vista;
 * - mostrare un modale di conferma a prenotazione completata;
 * - mantenere coerenti stato, loading, hint contestuali ed errori globali.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.session.clearAuth` nei casi di sessione non più valida;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading`,
 *   `APL.utils.toRomeDateInputValue`, `APL.utils.romeDateRangeToUtc`
 *   e `APL.utils.romeDayKeyFromIso`;
 * - utilizza `APL.ui.modal.open` per mostrare il riepilogo finale della prenotazione;
 * - utilizza `APL.utils.toast` per fornire feedback immediato all’utente;
 * - interagisce con gli endpoint:
 *   `/api/catalog/services`
 *   `/api/scheduling/patients/me/availability`
 *   `/api/scheduling/patients/me/appointments`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La logica della pagina è strutturata attorno a uno stato locale esplicito:
 * prestazione selezionata, slot disponibili, slot selezionato e dataset del
 * catalogo. La UI viene aggiornata progressivamente in funzione delle scelte
 * dell’utente e delle risposte del backend.
 */

(function () {
  "use strict";

  // Ruolo richiesto per consentire l’accesso corretto alla pagina di prenotazione.
  const EXPECTED_ROLE = "Patient";

  // Endpoint del catalogo prestazioni.
  const API_SERVICES = "/api/catalog/services";

  // Endpoint per la ricerca degli slot disponibili per il paziente.
  const API_AVAILABILITY = "/api/scheduling/patients/me/availability";

  // Endpoint per la creazione finale della prenotazione/appuntamento.
  const API_BOOK = "/api/scheduling/patients/me/appointments";

  // Utility locale per recuperare rapidamente un elemento DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore globale nel box principale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il box degli errori globali.
  function clearError() {
    const box = $("pageError");
    if (!box) return;

    box.textContent = "";
    box.classList.add("hidden");
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

  // Formattta un importo espresso in centesimi nella valuta corrispondente.
  function formatMoney(cents, currency) {
    const value = (Number(cents || 0) / 100).toFixed(2);
    return `${value} ${currency || "EUR"}`;
  }

  // Formattta una data/ora ISO UTC in forma leggibile per il paziente.
  function fmtDate(isoUtc) {
    if (!isoUtc) return "—";

    const d = new Date(isoUtc);
    return d.toLocaleString("it-IT", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Converte una data JavaScript nel valore atteso da un input HTML di tipo date,
  // mantenendo il riferimento al calendario di Roma.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Applica i vincoli minimi e la sincronizzazione tra data iniziale e finale.
  // L’obiettivo è impedire date nel passato e garantire coerenza dell’intervallo.
  function setDateInputConstraints() {
    const from = $("fromDate");
    const to = $("toDate");
    if (!from || !to) return;

    const todayStr = toLocalDateInputValue(new Date());

    from.min = todayStr;
    to.min = todayStr;

    const sync = () => {
      const fromVal = String(from.value || "").trim();

      if (fromVal) {
        to.min = fromVal >= todayStr ? fromVal : todayStr;
        if (to.value && to.value < to.min) to.value = to.min;
      } else {
        to.min = todayStr;
      }
    };

    from.addEventListener("change", sync);

    to.addEventListener("change", () => {
      if (from.value && to.value && to.value < from.value) {
        to.value = from.value;
      }
    });

    sync();
  }

  // Converte un intervallo di date locali nel corrispondente intervallo UTC
  // atteso dal backend per la ricerca delle disponibilità.
  function dateRangeToUtc(fromDateStr, toDateStr) {
    const range = APL.utils.romeDateRangeToUtc(fromDateStr, toDateStr);
    return range || { fromUtc: "", toUtc: "" };
  }

  // Attende che il sistema modale condiviso sia pronto prima del suo utilizzo.
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
      // Se la sessione non è più valida, ripulisce l’autenticazione locale
      // e delega il redirect alla vista di sessione scaduta.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // In caso di accesso non autorizzato costruisce un errore arricchito
      // così da poter intercettare eventuali codici applicativi lato UI.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();

        const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non consentita.";
        const err = new Error(msg);
        err.status = res.status;
        err.data = res.data;
        throw err;
      }

      // Negli altri casi costruisce un errore applicativo generico arricchito con metadati.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Costruisce una label leggibile del clinico associato a uno slot.
  // Se disponibili, combina email e specializzazione.
  function clinicianLabelFromSlot(slot) {
    if (!slot) return "—";

    const email = String(slot.clinicianEmail || "").trim();
    const spec = String(slot.clinicianSpecialty || "").trim();

    if (email && spec) return `${email} — ${spec}`;
    if (email) return email;
    if (spec) return spec;
    return "—";
  }

  // Garantisce l’esistenza della riga "Clinico" nel riepilogo laterale.
  // La riga viene creata dinamicamente se non è già presente nel markup.
  function ensureSummaryClinicianRow() {
    if ($("sumClinician")) return;

    const anchor = $("sumService") || $("sumWhen");
    if (!anchor) return;

    const row = anchor.closest("div.flex");
    const container = row?.parentElement;
    if (!row || !container) return;

    const el = document.createElement("div");
    el.className = "flex items-start justify-between gap-4";
    el.innerHTML = `
      <span class="text-slate-500">Clinico</span>
      <span id="sumClinician" class="font-medium text-slate-800 text-right">—</span>
    `;
    container.insertBefore(el, row.nextSibling);
  }

  // Restituisce una chiave giornaliera coerente per il raggruppamento degli slot.
  function dayKeyLocal(isoUtc) {
    return APL.utils.romeDayKeyFromIso(isoUtc);
  }

  // Gestisce il loading relativo al caricamento del catalogo prestazioni.
  function setSvcLoading(loading) {
    const badge = $("svcLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const select = $("serviceSelect");
    if (select) select.disabled = !!loading;

    const search = $("serviceSearch");
    if (search) search.disabled = !!loading;
  }

  // Gestisce il loading relativo alla ricerca delle disponibilità.
  function setAvLoading(loading) {
    const badge = $("avLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const btn = $("btnSearchAvailability");
    if (btn) APL.utils.setLoading(btn, loading, "Ricerca…");

    const from = $("fromDate");
    const to = $("toDate");
    if (from) from.disabled = !!loading;
    if (to) to.disabled = !!loading;
  }

  // Gestisce il loading relativo alla conferma finale della prenotazione.
  function setConfirmLoading(loading) {
    const btn = $("btnConfirm");
    if (btn) APL.utils.setLoading(btn, loading, "Conferma…");

    const notes = $("notes");
    if (notes) notes.disabled = !!loading;
  }

  // Aggiorna il riepilogo laterale della prenotazione in base
  // alla prestazione selezionata e allo slot selezionato.
  function setSummary(service, slot) {
    ensureSummaryClinicianRow();

    const sumService = $("sumService");
    const sumClinician = $("sumClinician");
    const sumWhen = $("sumWhen");
    const sumPrice = $("sumPrice");

    if (sumService) sumService.textContent = service ? String(service.name || "—") : "—";
    if (sumClinician) sumClinician.textContent = slot ? clinicianLabelFromSlot(slot) : "—";
    if (sumWhen) sumWhen.textContent = slot ? fmtDate(slot.startUtc) : "—";
    if (sumPrice) sumPrice.textContent = service ? formatMoney(service.basePriceCents, service.currency) : "—";
  }

  // Aggiorna il riquadro di anteprima della prestazione selezionata.
  function setServicePreview(service) {
    const name = $("svcName");
    const code = $("svcCode");
    const price = $("svcPrice");
    const desc = $("svcDesc");

    if (!service) {
      if (name) name.textContent = "—";
      if (code) code.textContent = "—";
      if (price) price.textContent = "—";
      if (desc) desc.textContent = "Selezioni una prestazione per visualizzare i dettagli.";
      return;
    }

    if (name) name.textContent = service.name || "Prestazione";
    if (code) code.textContent = service.code ? `Codice: ${service.code}` : "Codice: —";
    if (price) price.textContent = formatMoney(service.basePriceCents, service.currency);
    if (desc) desc.textContent = service.description ? String(service.description) : "Descrizione non disponibile.";
  }

  // Abilita o disabilita il pulsante di conferma finale e aggiorna
  // l’hint contestuale mostrato nel pannello laterale.
  function setConfirmEnabled(enabled) {
    const btn = $("btnConfirm");
    if (btn) btn.disabled = !enabled;

    const hint = $("asideHint");
    if (!hint) return;

    if (enabled) {
      hint.textContent = "Verifichi i dettagli e confermi la prenotazione.";
    } else {
      hint.textContent = "Selezioni una prestazione e uno slot disponibile per abilitare la conferma.";
    }
  }

  // Mostra o nasconde il link verso la gestione consensi.
  // Viene attivato in particolare quando il backend segnala consensi mancanti.
  function toggleConsentsLink(show) {
    const a = $("consentsLink");
    if (a) a.classList.toggle("hidden", !show);
  }

  // Raggruppa gli slot disponibili per clinico, così da rendere la visualizzazione
  // più chiara e organizzata per il paziente.
  function groupSlotsByClinician(slots) {
    const groups = new Map();

    for (const s of (Array.isArray(slots) ? slots : [])) {
      const key = String(s.clinicianUserId || "").trim() || "__unknown";
      const label = clinicianLabelFromSlot(s);

      if (!groups.has(key)) {
        groups.set(key, { clinicianKey: key, clinicianLabel: label, slots: [] });
      }

      groups.get(key).slots.push(s);
    }

    return Array.from(groups.values())
      .sort((a, b) => String(a.clinicianLabel || "").localeCompare(String(b.clinicianLabel || ""), "it"));
  }

  // Renderizza gli slot disponibili raggruppandoli per clinico e per giorno.
  // Evidenzia inoltre l’eventuale slot attualmente selezionato.
  function renderAvailability(slots, selectedSlotId) {
    const host = $("availabilityHost");
    const empty = $("availabilityEmpty");
    if (!host) return;

    const list = Array.isArray(slots) ? slots : [];

    if (!list.length) {
      if (empty) empty.classList.remove("hidden");
      host.innerHTML = "";
      return;
    }

    if (empty) empty.classList.add("hidden");

    const groups = groupSlotsByClinician(list);

    host.innerHTML = groups.map((g) => {
      const clinicianHeader = (g.clinicianLabel && g.clinicianLabel !== "—")
        ? g.clinicianLabel
        : "Clinico non specificato";

      const byDay = new Map();
      for (const s of g.slots) {
        const k = dayKeyLocal(s.startUtc);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(s);
      }

      const dayKeys = Array.from(byDay.keys()).sort();

      const dayCards = dayKeys.map((k) => {
        const daySlots = byDay.get(k) || [];
        daySlots.sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));

        const headerDate = (() => {
          const sample = new Date(daySlots[0].startUtc);
          return sample.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" });
        })();

        const buttons = daySlots.map((s) => {
          const id = String(s.id);
          const start = new Date(s.startUtc);
          const end = new Date(s.endUtc);

          const label =
            `${start.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` +
            `–${end.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`;

          const isSel = selectedSlotId && String(selectedSlotId) === id;

          const cls = isSel
            ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 focus:ring-blue-100"
            : "bg-white text-slate-700 border hover:bg-slate-50 focus:ring-blue-100";

          return `
            <button type="button" data-slot-id="${escapeHtml(id)}"
              class="h-11 inline-flex items-center justify-center rounded-xl border px-3 text-sm font-medium focus:outline-none focus:ring-4 ${cls}">
              ${escapeHtml(label)}
            </button>
          `;
        }).join("");

        return `
          <div class="rounded-2xl border bg-white p-4">
            <div class="text-sm font-semibold text-slate-900 capitalize">${escapeHtml(headerDate)}</div>
            <div class="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              ${buttons}
            </div>
          </div>
        `;
      }).join("");

      return `
        <div class="rounded-2xl border bg-slate-50 p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-xs font-medium text-slate-500">Clinico</div>
              <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(clinicianHeader)}</div>
            </div>
            <div class="text-xs text-slate-500">${escapeHtml(String(g.slots.length))} slot</div>
          </div>

          <div class="mt-4 grid gap-4">
            ${dayCards}
          </div>
        </div>
      `;
    }).join("");
  }

  // Legge l’eventuale serviceId presente in query string per preselezionare
  // automaticamente una prestazione proveniente, ad esempio, dal catalogo.
  function readQueryServiceId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("serviceId");
    return v ? String(v) : null;
  }

  // Dataset completo del catalogo servizi.
  let _services = [];

  // Dataset filtrato in base alla ricerca testuale del catalogo.
  let _filteredServices = [];

  // Prestazione attualmente selezionata dal paziente.
  let _selectedService = null;

  // Elenco degli slot disponibili risultanti dall’ultima ricerca.
  let _slots = [];

  // Slot attualmente selezionato dal paziente.
  let _selectedSlot = null;

  // Timer debounce per il filtro del catalogo prestazioni.
  let _debounce = null;

  // Applica il filtro testuale locale al catalogo servizi già caricato.
  function applyServiceFilter() {
    const term = String($("serviceSearch")?.value || "").trim().toLowerCase();

    if (!term) {
      _filteredServices = _services.slice();
    } else {
      _filteredServices = _services.filter((s) => {
        const name = String(s.name || "").toLowerCase();
        const desc = String(s.description || "").toLowerCase();
        const code = String(s.code || "").toLowerCase();
        return name.includes(term) || desc.includes(term) || code.includes(term);
      });
    }

    renderServiceSelect();
  }

  // Renderizza la select delle prestazioni in base al dataset filtrato,
  // cercando di preservare la selezione corrente quando possibile.
  function renderServiceSelect() {
    const sel = $("serviceSelect");
    if (!sel) return;

    const current = _selectedService ? String(_selectedService.id) : String(sel.value || "");
    const options =
      `<option value="">Selezioni una prestazione…</option>` +
      _filteredServices
        .slice()
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "it"))
        .map((s) => `<option value="${escapeHtml(String(s.id))}">${escapeHtml(String(s.name || "Prestazione"))}</option>`)
        .join("");

    sel.innerHTML = options;

    if (current && _filteredServices.some((x) => String(x.id) === current)) {
      sel.value = current;
    } else if (_selectedService) {
      sel.value = String(_selectedService.id);
    }
  }

  // Gestisce il cambio di prestazione selezionata.
  // Ogni cambio invalida la disponibilità e la selezione slot corrente.
  function onServiceChanged(serviceId) {
    _selectedService = _services.find((s) => String(s.id) === String(serviceId)) || null;
    setServicePreview(_selectedService);

    // Cambio prestazione => reset completo della parte disponibilità/prenotazione.
    _slots = [];
    _selectedSlot = null;
    renderAvailability([], null);

    setSummary(_selectedService, _selectedSlot);
    setConfirmEnabled(!!(_selectedService && _selectedSlot));
    toggleConsentsLink(false);

    const host = $("availabilityHost");
    if (host) {
      host.innerHTML = `<div class="text-sm text-slate-600">Avvii la ricerca delle disponibilità per scegliere la data e l’orario.</div>`;
    }

    const empty = $("availabilityEmpty");
    if (empty) empty.classList.add("hidden");
  }

  // Carica il catalogo prestazioni dal backend e gestisce l’eventuale
  // preselezione automatica di una prestazione passata in query string.
  async function loadServices() {
    clearError();
    setSvcLoading(true);

    try {
      const data = await apiJson("GET", API_SERVICES);
      _services = Array.isArray(data) ? data : [];
      _filteredServices = _services.slice();

      renderServiceSelect();

      const qId = readQueryServiceId();
      if (qId && _services.some((s) => String(s.id) === String(qId))) {
        const sel = $("serviceSelect");
        if (sel) sel.value = qId;
        onServiceChanged(qId);
      } else {
        setServicePreview(null);
        setSummary(null, null);
        setConfirmEnabled(false);
      }
    } catch (err) {
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il catalogo prestazioni.");
    } finally {
      setSvcLoading(false);
    }
  }

  // Valida l’intervallo temporale scelto dal paziente per la ricerca disponibilità.
  function validateRange() {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();
    if (!from || !to) return { ok: false, message: "Selezioni l’intervallo di date." };

    const todayStr = toLocalDateInputValue(new Date());

    if (from < todayStr) return { ok: false, message: "La data di inizio non può essere nel passato." };
    if (to < from) return { ok: false, message: "L’intervallo di date non è valido." };

    return { ok: true, from, to };
  }

  // Carica le disponibilità per la prestazione selezionata nell’intervallo scelto.
  async function loadAvailability() {
    clearError();
    toggleConsentsLink(false);

    if (!_selectedService) {
      APL.utils.toast("Selezioni una prestazione per proseguire.", "error");
      return;
    }

    const vr = validateRange();
    if (!vr.ok) {
      APL.utils.toast(vr.message, "error");
      return;
    }

    setAvLoading(true);

    try {
      const { fromUtc, toUtc } = dateRangeToUtc(vr.from, vr.to);

      const url = `${API_AVAILABILITY}?fromUtc=${encodeURIComponent(fromUtc)}&toUtc=${encodeURIComponent(toUtc)}`;
      const data = await apiJson("GET", url);

      // Vengono mantenuti solo gli slot realmente futuri rispetto al momento corrente.
      const now = new Date();
      const raw = Array.isArray(data) ? data : [];
      _slots = raw.filter((s) => {
        const start = new Date(s.startUtc);
        return Number.isFinite(start.getTime()) && start >= now;
      });

      // Ogni nuova ricerca azzera la selezione corrente dello slot.
      _selectedSlot = null;

      renderAvailability(_slots, null);
      setSummary(_selectedService, _selectedSlot);
      setConfirmEnabled(false);
    } catch (err) {
      console.error(err);
      _slots = [];
      _selectedSlot = null;
      renderAvailability([], null);
      setConfirmEnabled(false);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare le disponibilità.");
    } finally {
      setAvLoading(false);
    }
  }

  // Invia la richiesta di creazione prenotazione al backend.
  async function confirmBooking() {
    clearError();
    toggleConsentsLink(false);

    if (!_selectedService || !_selectedSlot) {
      APL.utils.toast("Selezioni una prestazione e uno slot disponibile.", "error");
      return;
    }

    const notes = String($("notes")?.value || "").trim() || null;
    const clinicianShown = clinicianLabelFromSlot(_selectedSlot);

    setConfirmLoading(true);
    try {
      const payload = {
        slotId: _selectedSlot.id,
        serviceId: _selectedService.id,
        notes,
      };

      const appt = await apiJson("POST", API_BOOK, payload);

      APL.utils.toast("Prenotazione confermata.", "success");

      // Dopo la prenotazione viene mostrato un modale con il riepilogo finale.
      const ok = await ensureModalReady(10000);
      if (ok) {
        const bodyHtml = `
          <div class="space-y-4">
            <div class="rounded-2xl border bg-slate-50 p-4">
              <div class="text-xs font-medium text-slate-500">Dettagli prenotazione</div>
              <div class="mt-2 grid gap-2 text-sm">
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Prestazione</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(_selectedService.name || "—")}</span>
                </div>
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Clinico</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(clinicianShown)}</span>
                </div>
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Data/ora</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(fmtDate(appt.startUtc))}</span>
                </div>
                <div class="flex items-start justify-between gap-4">
                  <span class="text-slate-500">Costo indicativo</span>
                  <span class="font-medium text-slate-800 text-right">${escapeHtml(formatMoney(appt.quotedPriceCents, appt.currency))}</span>
                </div>
              </div>
            </div>

            <div class="text-sm text-slate-600">
              Può consultare l’elenco appuntamenti oppure completare le informazioni richieste prima della visita, se disponibili.
            </div>
          </div>
        `;

        APL.ui.modal.open({
          title: "Prenotazione completata",
          bodyHtml,
          actions: [
            { label: "Chiudi", kind: "secondary" },
            {
              label: "Vedi appuntamenti",
              kind: "primary",
              closeOnClick: true,
              onClick: () => {
                window.location.href = "./appointments.html";
              },
            },
            {
              label: "Compila pre-visita",
              kind: "secondary",
              closeOnClick: true,
              onClick: () => {
                window.location.href = `./pretriage.html?appointmentId=${encodeURIComponent(String(appt.id))}`;
              },
            },
          ],
        });
      }

      // Dopo il successo si resetta la selezione slot, mantenendo però la prestazione
      // così da consentire eventualmente una nuova ricerca o prenotazione.
      _selectedSlot = null;
      renderAvailability(_slots, null);
      setSummary(_selectedService, _selectedSlot);
      setConfirmEnabled(false);
      if ($("notes")) $("notes").value = "";
    } catch (err) {
      console.error(err);

      const msg = APL.utils.humanizeError(err) || "Operazione non riuscita.";
      showError(msg);

      // Gestione esplicita del caso di consensi mancanti.
      const rawCode = err?.data?.code ? String(err.data.code) : "";
      if (String(err?.message || "").toLowerCase().includes("consensi") || rawCode === "missing_required_consents") {
        toggleConsentsLink(true);
        APL.utils.toast("Per completare la prenotazione è necessario aggiornare i consensi.", "error");
      } else {
        APL.utils.toast(msg, "error");
      }
    } finally {
      setConfirmLoading(false);
    }
  }

  // Collega il contenitore disponibilità alla logica di selezione dello slot.
  function wireAvailabilitySelection() {
    const host = $("availabilityHost");
    if (!host) return;

    host.addEventListener("click", (ev) => {
      const btn = ev.target?.closest?.("button[data-slot-id]");
      if (!btn) return;

      const slotId = btn.getAttribute("data-slot-id");
      const slot = _slots.find((s) => String(s.id) === String(slotId)) || null;
      if (!slot) return;

      // Ulteriore protezione lato client: uno slot nel frattempo scaduto
      // non deve poter essere selezionato.
      const now = new Date();
      if (new Date(slot.startUtc) < now) {
        APL.utils.toast("Lo slot selezionato non è più disponibile.", "error");
        return;
      }

      _selectedSlot = slot;
      renderAvailability(_slots, _selectedSlot.id);
      setSummary(_selectedService, _selectedSlot);
      setConfirmEnabled(!!(_selectedService && _selectedSlot));
    });
  }

  // Collega i controlli statici della pagina ai relativi comportamenti applicativi.
  function initControls() {
    const sel = $("serviceSelect");
    const search = $("serviceSearch");
    const btnSearch = $("btnSearchAvailability");
    const btnConfirm = $("btnConfirm");

    // Cambio della prestazione selezionata.
    if (sel) {
      sel.addEventListener("change", () => onServiceChanged(sel.value));
    }

    // Filtro testuale del catalogo con debounce per evitare aggiornamenti troppo frequenti.
    if (search) {
      search.addEventListener("input", () => {
        if (_debounce) clearTimeout(_debounce);
        _debounce = setTimeout(() => applyServiceFilter(), 200);
      });
    }

    // Avvio esplicito della ricerca disponibilità e conferma finale della prenotazione.
    if (btnSearch) btnSearch.addEventListener("click", loadAvailability);
    if (btnConfirm) btnConfirm.addEventListener("click", confirmBooking);
  }

  // Inizializza i valori di default dell’intervallo di ricerca:
  // da domani fino a due settimane dopo.
  function initDefaultDates() {
    const from = $("fromDate");
    const to = $("toDate");

    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

    if (from) from.value = toLocalDateInputValue(start);
    if (to) to.value = toLocalDateInputValue(end);
  }

  // Inizializza l’intera pagina di prenotazione al caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Patient.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    try {
      initDefaultDates();
      setDateInputConstraints();
      initControls();
      wireAvailabilitySelection();
      await ensureModalReady(10000);
      await loadServices();
    } catch (err) {
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Impossibile avviare la prenotazione.");
    }
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
