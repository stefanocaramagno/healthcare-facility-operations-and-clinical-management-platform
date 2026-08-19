/**
 * File: frontend/js/admin/slots.js
 *
 * Scopo
 * -----
 * Gestire la pagina amministrativa dedicata agli slot clinici, consentendo
 * il caricamento dei clinici, la consultazione degli slot in un intervallo
 * temporale selezionato, la generazione massiva di nuovi slot e
 * l’aggiornamento dello stato dei singoli slot.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della pagina "Gestione slot
 * clinici" dell’area Admin. Coordina l’interazione tra interfaccia utente,
 * endpoint protetti del back-end e componenti condivisi del front-end per
 * governare la disponibilità temporale dei clinici nel processo di scheduling.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso dell’utente con ruolo Admin;
 * - caricare e popolare il selettore dei clinici;
 * - recuperare gli slot del clinico selezionato in base ai filtri impostati;
 * - mostrare statistiche aggregate sugli slot caricati;
 * - generare in modo automatico più slot a partire da parametri temporali;
 * - mostrare i dettagli di uno slot tramite modale;
 * - aggiornare lo stato di uno slot esistente;
 * - mostrare errori, notifiche e stati di caricamento.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.readQuery`, `APL.utils.requestJson`,
 *   `APL.utils.parseApiDate`, `APL.utils.toRomeDateInputValue`,
 *   `APL.utils.romeTodayDateInputValue`, `APL.utils.addDaysToDateInput`,
 *   `APL.utils.weekdayFromDateInput`, `APL.utils.romeDateRangeToUtc`,
 *   `APL.utils.romeDateTimeToUtcIso`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading` e `APL.utils.toast`;
 * - utilizza `APL.ui.modal` per aprire e gestire le finestre modali;
 * - interagisce con gli endpoint:
 *   `/api/registry/admin/clinicians`,
 *   `/api/scheduling/admin/clinicians/{clinicianUserId}/slots`,
 *   `/api/scheduling/admin/slots/{slotId}/status`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina combina due flussi distinti ma coordinati:
 * - consultazione e gestione degli slot esistenti;
 * - generazione massiva di nuovi slot per un clinico selezionato.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint per il recupero dell’elenco dei clinici.
  const API_CLINICIANS_LIST = "/api/registry/admin/clinicians";

  // Parametri di paginazione usati per recuperare tutti i clinici.
  const CLINICIANS_PAGE_SIZE = 500;
  const CLINICIANS_MAX_PAGES = 20;

  // Endpoint per il recupero degli slot di un clinico specifico.
  const API_LIST_SLOTS = (clinicianUserId) =>
    `/api/scheduling/admin/clinicians/${encodeURIComponent(String(clinicianUserId))}/slots`;

  // Endpoint per la creazione di slot per un clinico specifico.
  const API_CREATE_SLOTS = (clinicianUserId) =>
    `/api/scheduling/admin/clinicians/${encodeURIComponent(String(clinicianUserId))}/slots`;

  // Endpoint per l’aggiornamento dello stato di un singolo slot.
  const API_UPDATE_SLOT_STATUS = (slotId) =>
    `/api/scheduling/admin/slots/${encodeURIComponent(String(slotId))}/status`;

  // Restituisce un elemento DOM a partire dal suo id.
  function $(id) { return document.getElementById(id); }

  // Mostra un messaggio di errore nel contenitore globale della pagina.
  function showError(message) {
    // Recupera il box degli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Imposta il testo dell’errore e rende visibile il contenitore.
    box.textContent = message || "Si è verificato un errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore degli errori globali.
  function clearError() {
    // Recupera il box degli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Svuota il contenuto e ripristina lo stato nascosto.
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Mostra o nasconde il messaggio di errore associato alla generazione degli slot.
  function setGenError(msg) {
    // Recupera il box errori del pannello di generazione.
    const box = $("genError");
    if (!box) return;

    // Se non esiste alcun messaggio, svuota e nasconde il box.
    if (!msg) {
      box.textContent = "";
      box.classList.add("hidden");
      return;
    }

    // Altrimenti imposta il testo e rende visibile il box.
    box.textContent = msg;
    box.classList.remove("hidden");
  }

  // Aggiorna lo stato di caricamento della sezione di consultazione slot.
  function setLoading(loading) {
    // Mostra o nasconde il badge di caricamento principale.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Disabilita o riabilita i controlli principali del filtro.
    const ids = ["clinicianSelect", "fromDate", "toDate", "statusSelect", "btnRefresh"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }

    // Aggiorna anche il testo/stato del pulsante refresh.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");
  }

  // Aggiorna lo stato di caricamento del pannello di generazione slot.
  function setGenLoading(loading) {
    // Aggiorna il pulsante di generazione con etichetta contestuale.
    const btn = $("btnGenerate");
    if (btn) APL.utils.setLoading(btn, loading, "Creazione…");

    // Disabilita o riabilita tutti i campi coinvolti nella generazione massiva.
    const ids = ["genFromDate", "genToDate", "dayStartTime", "dayEndTime", "slotDuration", "defaultStatus",
      "wdMon", "wdTue", "wdWed", "wdThu", "wdFri", "wdSat", "wdSun"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Esegue l’escape HTML di una stringa per un inserimento sicuro nel markup.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Restituisce una data nel formato richiesto dagli input date locali.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Converte una data ISO UTC in una stringa data/ora leggibile.
  function fmtDateTime(isoUtc) {
    // Se manca il valore, restituisce il placeholder.
    if (!isoUtc) return "—";

    // Prova a convertire la stringa ISO in oggetto Date.
    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    // Restituisce la rappresentazione localizzata in italiano.
    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Traduce lo stato tecnico di uno slot in etichetta e tono grafico.
  function mapSlotStatus(raw) {
    const s = String(raw || "").toUpperCase();
    if (s === "AVAILABLE") return { label: "Available", tone: "emerald" };
    if (s === "RESERVED") return { label: "Reserved", tone: "amber" };
    if (s === "UNAVAILABLE") return { label: "Unavailable", tone: "slate" };
    return { label: raw || "—", tone: "slate" };
  }

  // Costruisce il badge HTML che rappresenta lo stato di uno slot.
  function statusPill(raw) {
    // Recupera etichetta e tono associati allo stato.
    const m = mapSlotStatus(raw);

    // Seleziona le classi CSS coerenti con il tono individuato.
    const tone =
      m.tone === "emerald"
        ? "bg-emerald-50 text-emerald-700"
        : m.tone === "amber"
          ? "bg-amber-50 text-amber-800"
          : "bg-slate-100 text-slate-700";

    // Restituisce il markup del badge.
    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${tone}">${escapeHtml(m.label)}</span>`;
  }

  // Attende che l’API della modale condivisa sia disponibile nel namespace globale.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();

    // Attende a piccoli intervalli finché la modale non è pronta o finché non scade il timeout.
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    // Restituisce true solo se la modale è disponibile e utilizzabile.
    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Esegue una richiesta JSON autenticata e gestisce i casi di errore applicativo principali.
  async function apiJson(method, url, json) {
    // Invia la richiesta verso il back-end con header autenticati.
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Se la risposta non è positiva, gestisce i principali casi applicativi.
    if (!res.ok) {
      // Se la sessione è scaduta, pulisce lo stato locale e reindirizza.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Se l’utente non è autorizzato, reindirizza alla schermata corretta.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Negli altri casi costruisce un errore arricchito con i dettagli restituiti.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    // Se la risposta è valida, restituisce il payload JSON già elaborato.
    return res.data;
  }

  // Cache locale dell’elenco dei clinici.
  let _clinicians = [];

  // Mappa che indicizza rapidamente i clinici tramite userId.
  const _clinicianById = new Map();

  // Carica tutti i clinici disponibili e popola il selettore di pagina.
  async function loadClinicians() {
    const all = [];
    let skip = 0;

    // Recupera i clinici in modo paginato finché ci sono dati disponibili.
    for (let page = 0; page < CLINICIANS_MAX_PAGES; page++) {
      const url = `${API_CLINICIANS_LIST}?skip=${skip}&take=${CLINICIANS_PAGE_SIZE}`;
      const data = await apiJson("GET", url);
      const chunk = Array.isArray(data) ? data : [];
      all.push(...chunk);

      // Se la pagina ricevuta è incompleta, significa che non ci sono altri risultati.
      if (chunk.length < CLINICIANS_PAGE_SIZE) break;
      skip += CLINICIANS_PAGE_SIZE;
    }

    // Ordina i clinici per email e ricostruisce la mappa per accesso rapido.
    _clinicians = all.slice().sort((a, b) => String(a.email || "").localeCompare(String(b.email || ""), "it"));
    _clinicianById.clear();
    for (const c of _clinicians) _clinicianById.set(String(c.userId), c);

    // Recupera il selettore del clinico.
    const sel = $("clinicianSelect");
    if (!sel) return;

    // Salva il valore corrente per tentare di preservarlo dopo il refresh.
    const current = String(sel.value || "");

    // Reinizializza il contenuto del selettore.
    sel.innerHTML = `<option value="">Selezioni un clinico…</option>`;
    for (const c of _clinicians) {
      const id = String(c.userId || "");
      const email = String(c.email || "").trim();
      const spec = String(c.specialty || "").trim();
      const label = spec ? `${email} — ${spec}` : email;

      // Crea e aggiunge l’opzione del clinico.
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label || id || "Clinico";
      sel.appendChild(opt);
    }

    // Ripristina il valore precedente, se ancora disponibile.
    sel.value = current;
    updateSelectedClinicianPill();
  }

  // Aggiorna la pillola che mostra il clinico attualmente selezionato.
  function updateSelectedClinicianPill() {
    const pill = $("selectedClinicianPill");
    const label = $("selectedClinicianLabel");
    if (!pill || !label) return;

    // Legge l’identificativo del clinico selezionato.
    const clinicianId = String($("clinicianSelect")?.value || "");
    if (!clinicianId) {
      pill.classList.add("hidden");
      label.textContent = "";
      return;
    }

    // Recupera il clinico dalla mappa e costruisce l’etichetta descrittiva.
    const c = _clinicianById.get(clinicianId);
    const email = String(c?.email || "").trim();
    const spec = String(c?.specialty || "").trim();
    label.textContent = spec ? `${email} — ${spec}` : (email || "Clinico selezionato");
    pill.classList.remove("hidden");
  }

  // Cache locale degli slot attualmente caricati.
  let _slots = [];

  // Mostra o nasconde lo stato vuoto della tabella slot.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Aggiorna i contatori statistici mostrati in pagina.
  function setStats(list) {
    const items = Array.isArray(list) ? list : [];
    const total = items.length;

    // Conta quanti slot appartengono a ciascuno stato gestito.
    const av = items.filter((x) => String(x.status || "").toUpperCase() === "AVAILABLE").length;
    const res = items.filter((x) => String(x.status || "").toUpperCase() === "RESERVED").length;
    const un = items.filter((x) => String(x.status || "").toUpperCase() === "UNAVAILABLE").length;

    // Aggiorna i KPI presenti nell’interfaccia.
    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statAvailable")) $("statAvailable").textContent = String(av);
    if ($("statReserved")) $("statReserved").textContent = String(res);
    if ($("statUnavailable")) $("statUnavailable").textContent = String(un);
  }

  // Renderizza la tabella degli slot.
  function renderRows(items) {
    const tbody = $("slotsTbody");
    if (!tbody) return;

    const list = Array.isArray(items) ? items : [];
    setStats(list);

    // Se non è stato selezionato alcun clinico, mostra il messaggio iniziale di guida.
    if (!String($("clinicianSelect")?.value || "").trim()) {
      emptyState(false);
      tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-600">Selezioni un clinico per caricare gli slot…</td></tr>`;
      return;
    }

    // Se il clinico è selezionato ma non ci sono slot, mostra l’empty state.
    if (!list.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    // Definisce le classi CSS riutilizzate per i pulsanti azione.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";
    const btnDanger =
      "h-9 inline-flex items-center rounded-xl bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-100";
    const btnPrimary =
      "h-9 inline-flex items-center rounded-xl bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100";
    const btnDisabled =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-400 cursor-not-allowed opacity-70";

    // Ordina gli slot per data/ora iniziale e genera il markup delle righe.
    const rows = list
      .slice()
      .sort((a, b) => new Date(a.startUtc || 0) - new Date(b.startUtc || 0))
      .map((s) => {
        const when = `${fmtDateTime(s.startUtc)} – ${fmtDateTime(s.endUtc)}`;
        const st = statusPill(s.status);
        const id = String(s.id || "—");

        // Determina quali azioni sono effettivamente consentite per lo stato corrente.
        const statusUp = String(s.status || "").toUpperCase();
        const canDisable = statusUp === "AVAILABLE";
        const canEnable = statusUp === "UNAVAILABLE";

        return `
          <tr>
            <td class="py-4 pr-4 text-slate-800">${escapeHtml(when)}</td>
            <td class="py-4 pr-4">${st}</td>
            <td class="py-4 pr-4 text-slate-600 font-mono text-xs">${escapeHtml(id)}</td>
            <td class="py-4 text-right">
              <div class="inline-flex items-center gap-2 justify-end">
                <button type="button" data-action="details" data-id="${escapeHtml(id)}" class="${btnCls}">
                  Dettagli
                </button>

                <button type="button" data-action="enable" data-id="${escapeHtml(id)}"
                  class="${canEnable ? btnPrimary : btnDisabled}" ${canEnable ? "" : "disabled"}>
                  Abilita
                </button>

                <button type="button" data-action="disable" data-id="${escapeHtml(id)}"
                  class="${canDisable ? btnDanger : btnDisabled}" ${canDisable ? "" : "disabled"}>
                  Disabilita
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = rows;
  }

  // Legge l’intervallo date dai filtri oppure ne costruisce uno di default.
  function readRangeOrDefault(prefixFrom, prefixTo) {
    const from = String($(prefixFrom)?.value || "").trim();
    const to = String($(prefixTo)?.value || "").trim();

    // Se l’utente ha impostato un intervallo valido, lo converte direttamente in UTC.
    if (from && to && to >= from) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) return range;
    }

    // In assenza di valori validi usa come default oggi + i successivi 14 giorni.
    const today = APL.utils.romeTodayDateInputValue();
    const end = APL.utils.addDaysToDateInput(today, 14);
    return APL.utils.romeDateRangeToUtc(today, end);
  }

  // Carica gli slot del clinico selezionato in base ai filtri correnti.
  async function loadSlots() {
    clearError();
    setLoading(true);

    try {
      // Legge l’identificativo del clinico selezionato.
      const clinicianId = String($("clinicianSelect")?.value || "").trim();
      if (!clinicianId) {
        _slots = [];
        renderRows([]);
        return;
      }

      // Costruisce l’intervallo temporale e legge il filtro di stato.
      const r = readRangeOrDefault("fromDate", "toDate");
      const status = String($("statusSelect")?.value || "ALL");

      // Compone la query string per la richiesta GET.
      const params = new URLSearchParams();
      params.set("fromUtc", r.fromUtc);
      params.set("toUtc", r.toUtc);
      params.set("status", status);

      // Richiede gli slot al back-end e aggiorna la cache locale.
      const data = await apiJson("GET", `${API_LIST_SLOTS(clinicianId)}?${params.toString()}`);
      _slots = Array.isArray(data) ? data : [];
      renderRows(_slots);
    } catch (err) {
      // In caso di errore, svuota la cache locale e mostra il messaggio globale.
      console.error(err);
      _slots = [];
      renderRows([]);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare gli slot.");
    } finally {
      setLoading(false);
    }
  }

  // Cerca uno slot per identificativo all’interno della cache locale.
  function findSlotById(id) {
    return (_slots || []).find((x) => String(x.id) === String(id)) || null;
  }

  // Costruisce il corpo HTML della modale di dettaglio di uno slot.
  function slotDetailsBodyHtml(slot) {
    const when = `${fmtDateTime(slot?.startUtc)} – ${fmtDateTime(slot?.endUtc)}`;
    const st = mapSlotStatus(slot?.status).label;

    return `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Slot</div>
          <div class="mt-2 grid gap-2 text-sm">
            <div class="flex items-start justify-between gap-4">
              <span class="text-slate-500">Riferimento</span>
              <span class="font-mono text-xs text-slate-800 text-right">${escapeHtml(String(slot?.id || "—"))}</span>
            </div>
            <div class="flex items-start justify-between gap-4">
              <span class="text-slate-500">Data/ora</span>
              <span class="font-medium text-slate-800 text-right">${escapeHtml(when)}</span>
            </div>
            <div class="flex items-start justify-between gap-4">
              <span class="text-slate-500">Stato</span>
              <span class="font-medium text-slate-800 text-right">${escapeHtml(st)}</span>
            </div>
          </div>
        </div>
        <div class="text-sm text-slate-600">
          Nota: gli slot in stato <span class="font-medium text-slate-800">Available</span> saranno proposti in fase di prenotazione.
        </div>
      </div>
    `;
  }

  // Apre la modale di dettaglio di uno slot selezionato.
  async function openDetailsModal(slot) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    // Mostra la modale informativa con i dettagli principali dello slot.
    APL.ui.modal.open({
      title: "Dettagli slot",
      bodyHtml: slotDetailsBodyHtml(slot),
      actions: [{ label: "Chiudi", kind: "secondary" }],
    });
  }

  // Aggiorna lo stato di uno slot selezionato, previa conferma tramite modale.
  async function updateSlotStatus(slot, newStatus) {
    const ok = await ensureModalReady(10000);
    if (!ok) return;

    // Determina il titolo della modale in base all’azione richiesta.
    const title = newStatus === "Unavailable" ? "Disabilita slot" : "Abilita slot";

    // Prepara il contenuto della finestra di conferma.
    const bodyHtml = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Conferma</div>
          <div class="mt-2 text-sm text-slate-700">
            Conferma l’aggiornamento dello stato dello slot selezionato.
          </div>
          <div class="mt-2 text-xs text-slate-600">
            ${escapeHtml(fmtDateTime(slot.startUtc))} – ${escapeHtml(fmtDateTime(slot.endUtc))}
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700" for="statusReason">Motivazione (opzionale)</label>
          <textarea id="statusReason" rows="3" maxlength="500"
            class="mt-2 w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="Aggiungere una motivazione…"></textarea>
        </div>

        <div id="statusErr" class="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"></div>
      </div>
    `;

    // Funzione locale per mostrare o nascondere gli errori della modale.
    const setErr = (msg) => {
      const box = document.getElementById("statusErr");
      if (!box) return;
      if (!msg) {
        box.textContent = "";
        box.classList.add("hidden");
        return;
      }
      box.textContent = msg;
      box.classList.remove("hidden");
    };

    // Apre la modale di conferma dell’aggiornamento stato.
    APL.ui.modal.open({
      title,
      bodyHtml,
      actions: [
        { label: "Annulla", kind: "secondary" },
        {
          label: "Conferma",
          kind: newStatus === "Unavailable" ? "danger" : "primary",
          closeOnClick: false,
          onClick: async () => {
            setErr("");

            // Legge la motivazione opzionale inserita dall’utente.
            const reason = String(document.getElementById("statusReason")?.value || "").trim() || null;

            try {
              // Invia la richiesta di aggiornamento stato al back-end.
              await apiJson("POST", API_UPDATE_SLOT_STATUS(slot.id), { status: newStatus, reason });

              // Notifica il successo, chiude la modale e ricarica l’elenco.
              APL.utils.toast("Stato slot aggiornato.", "success");
              if (APL.ui?.modal?.close) APL.ui.modal.close();
              await loadSlots();
            } catch (err) {
              // Mostra l’errore direttamente nella modale.
              setErr(APL.utils.humanizeError(err) || "Operazione non riuscita.");
            }
          }
        }
      ]
    });
  }

  // Costruisce la mappa dei giorni della settimana selezionati nel pannello di generazione.
  function getWeekdayMask() {
    const map = new Map([
      [1, !!$("wdMon")?.checked],
      [2, !!$("wdTue")?.checked],
      [3, !!$("wdWed")?.checked],
      [4, !!$("wdThu")?.checked],
      [5, !!$("wdFri")?.checked],
      [6, !!$("wdSat")?.checked],
      [0, !!$("wdSun")?.checked],
    ]);
    return map;
  }

  // Converte una stringa "HH:mm" in minuti complessivi dall’inizio della giornata.
  function parseTimeToMinutes(hhmm) {
    const s = String(hhmm || "").trim();
    const m = s.match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;

    const hh = Number(m[1]);
    const mm = Number(m[2]);

    // Verifica la validità numerica e il range di ore/minuti.
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

    return hh * 60 + mm;
  }

  // Converte un numero di minuti in una stringa "HH:mm".
  function minutesToTimeString(totalMinutes) {
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  // Costruisce l’anteprima della generazione slot e il payload da inviare al back-end.
  function buildSlotsPreviewAndPayload() {
    // Il clinico è obbligatorio per poter generare slot.
    const clinicianId = String($("clinicianSelect")?.value || "").trim();
    if (!clinicianId) return { error: "Selezioni un clinico prima di creare gli slot." };

    // Legge l’intervallo date della generazione.
    const from = String($("genFromDate")?.value || "").trim();
    const to = String($("genToDate")?.value || "").trim();
    if (!from || !to || to < from) return { error: "Impostare un intervallo date valido (Da ≤ A)." };

    // Legge e valida la fascia oraria giornaliera.
    const startMin = parseTimeToMinutes($("dayStartTime")?.value);
    const endMin = parseTimeToMinutes($("dayEndTime")?.value);
    if (startMin == null || endMin == null || endMin <= startMin) {
      return { error: "Impostare una fascia oraria valida (inizio < fine)." };
    }

    // Legge e valida la durata dei singoli slot.
    const duration = Number($("slotDuration")?.value || 30);
    if (!Number.isFinite(duration) || duration < 10) {
      return { error: "Durata slot non valida (minimo 10 minuti)." };
    }

    // Legge lo stato iniziale da assegnare agli slot generati.
    const defaultStatus = String($("defaultStatus")?.value || "Available");

    // Costruisce la maschera dei giorni della settimana selezionati.
    const wdMask = getWeekdayMask();
    if (![...wdMask.values()].some(Boolean)) {
      return { error: "Selezioni almeno un giorno della settimana." };
    }

    const nowMs = Date.now();
    const items = [];

    // Scorre tutte le date dell’intervallo selezionato.
    for (
      let currentDate = from;
      currentDate <= to;
      currentDate = APL.utils.addDaysToDateInput(currentDate, 1)
    ) {
      // Verifica se il giorno corrente rientra tra quelli selezionati.
      const dow = APL.utils.weekdayFromDateInput(currentDate);
      if (dow == null || !wdMask.get(dow)) continue;

      // Per ciascun giorno genera tutti gli slot coerenti con la fascia oraria e la durata.
      for (let t = startMin; t + duration <= endMin; t += duration) {
        const startUtc = APL.utils.romeDateTimeToUtcIso(currentDate, minutesToTimeString(t));
        const endUtc = APL.utils.romeDateTimeToUtcIso(currentDate, minutesToTimeString(t + duration));

        // Converte le stringhe generate in Date per verifiche temporali.
        const startDate = APL.utils.parseApiDate(startUtc);
        const endDate = APL.utils.parseApiDate(endUtc);

        // Se i valori non sono validi, salta lo slot corrente.
        if (!startUtc || !endUtc || !startDate || !endDate) continue;

        // Non genera slot che iniziano nel passato o nel momento corrente.
        if (startDate.getTime() <= nowMs) continue;

        items.push({
          startUtc,
          endUtc,
        });
      }
    }

    // Se nessuno slot è generabile, restituisce un errore descrittivo.
    if (!items.length) {
      return { error: "Nessuno slot generabile con i parametri selezionati (verificare date/orari)." };
    }

    // Impone un limite di sicurezza al numero di slot generabili per richiesta.
    if (items.length > 500) {
      return { error: `Troppi slot (${items.length}). Riduca intervallo o durata. Max 500 per richiesta.` };
    }

    // Restituisce payload completo e conteggio di anteprima.
    return {
      clinicianId,
      defaultStatus,
      slots: items,
      count: items.length,
    };
  }

  // Aggiorna il testo di anteprima relativo alla generazione degli slot.
  function updatePreview() {
    const box = $("genPreview");
    if (!box) return;

    // Costruisce l’anteprima e mostra eventuali errori di validazione.
    const res = buildSlotsPreviewAndPayload();
    if (res.error) {
      box.textContent = res.error;
      return;
    }

    // Se i parametri sono validi, mostra la stima del numero di slot generabili.
    box.textContent = `Stima slot da creare: ${res.count}.`;
  }

  // Invia al back-end la richiesta di generazione massiva degli slot.
  async function createSlots() {
    setGenError("");
    clearError();

    // Costruisce e valida il payload di generazione.
    const res = buildSlotsPreviewAndPayload();
    if (res.error) {
      setGenError(res.error);
      return;
    }

    setGenLoading(true);
    try {
      // Prepara il payload da inviare all’endpoint di creazione.
      const payload = {
        slots: res.slots,
        defaultStatus: res.defaultStatus,
      };

      // Invia la richiesta di creazione.
      await apiJson("POST", API_CREATE_SLOTS(res.clinicianId), payload);
      APL.utils.toast("Slot creati con successo.", "success");

      // Ricarica l’elenco slot per riflettere i nuovi elementi creati.
      await loadSlots();
    } catch (err) {
      // In caso di errore, mostra un messaggio nel pannello di generazione.
      console.error(err);
      setGenError(APL.utils.humanizeError(err) || "Impossibile creare gli slot.");
    } finally {
      setGenLoading(false);
    }
  }

  // Inizializza i valori di default dei filtri e del pannello di generazione.
  function initDefaults() {
    const today = APL.utils.romeTodayDateInputValue();
    const end14 = APL.utils.addDaysToDateInput(today, 14);

    // Imposta il range iniziale di consultazione.
    if ($("fromDate")) $("fromDate").value = today;
    if ($("toDate")) $("toDate").value = end14;

    // Imposta il range iniziale di generazione.
    if ($("genFromDate")) $("genFromDate").value = today;
    if ($("genToDate")) $("genToDate").value = end14;

    // Imposta una fascia oraria predefinita per la generazione.
    if ($("dayStartTime")) $("dayStartTime").value = "09:00";
    if ($("dayEndTime")) $("dayEndTime").value = "13:00";
  }

  // Collega tutti gli handler principali della pagina.
  function wireHandlers() {
    const clinicianSelect = $("clinicianSelect");
    if (clinicianSelect) {
      clinicianSelect.addEventListener("change", async () => {
        // Aggiorna il riepilogo del clinico selezionato.
        updateSelectedClinicianPill();

        // Ricarica gli slot e aggiorna anche la stima di generazione.
        await loadSlots();
        updatePreview();
      });
    }

    // Collega il refresh manuale dell’elenco.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", () => loadSlots());

    // Ricarica gli slot quando cambia il filtro di stato.
    const statusSelect = $("statusSelect");
    if (statusSelect) statusSelect.addEventListener("change", () => loadSlots());

    // Ricarica gli slot quando cambia il range temporale di consultazione.
    const fromDate = $("fromDate");
    const toDate = $("toDate");
    if (fromDate) fromDate.addEventListener("change", () => loadSlots());
    if (toDate) toDate.addEventListener("change", () => loadSlots());

    // Elenco di tutti i controlli che influenzano la generazione massiva.
    const genInputs = ["genFromDate", "genToDate", "dayStartTime", "dayEndTime", "slotDuration", "defaultStatus",
      "wdMon", "wdTue", "wdWed", "wdThu", "wdFri", "wdSat", "wdSun"];
    genInputs.forEach((id) => {
      const el = $(id);
      if (!el) return;

      // Aggiorna la preview sia al change sia all’input.
      el.addEventListener("change", updatePreview);
      el.addEventListener("input", updatePreview);
    });

    // Collega il pulsante di generazione slot.
    const btnGenerate = $("btnGenerate");
    if (btnGenerate) btnGenerate.addEventListener("click", () => createSlots());

    // Collega le azioni presenti nelle righe della tabella slot.
    const tbody = $("slotsTbody");
    if (tbody) {
      tbody.addEventListener("click", async (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        // Individua il pulsante azione cliccato.
        const btn = t.closest("button[data-action][data-id]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        const slot = findSlotById(id);
        if (!slot) return;

        // Smista l’azione verso la funzione corretta.
        if (action === "details") await openDetailsModal(slot);
        if (action === "disable") await updateSlotStatus(slot, "Unavailable");
        if (action === "enable") await updateSlotStatus(slot, "Available");
      });
    }
  }

  // Inizializza la pagina verificando il ruolo e preparando i dati necessari.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Verifica che l’utente autenticato abbia il ruolo richiesto.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Inizializza i valori di default e collega gli eventi della UI.
    initDefaults();
    wireHandlers();

    try {
      // Attende la disponibilità della modale condivisa.
      await ensureModalReady(10000);

      // Carica i clinici disponibili e inizializza la preview di generazione.
      await loadClinicians();
      updatePreview();
    } catch (err) {
      // In caso di errore di bootstrap, mostra un messaggio globale.
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Impossibile inizializzare la pagina.");
    }
  }

  // Avvia l’inizializzazione della pagina quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
