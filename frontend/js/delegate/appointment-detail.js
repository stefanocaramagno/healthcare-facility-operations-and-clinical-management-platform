/**
 * File: frontend/js/delegate/appointment-detail.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina di dettaglio
 * appuntamento dell’area Delegate, consentendo il recupero delle
 * informazioni dell’assistito e dell’appuntamento selezionato, la
 * visualizzazione dei dati principali della prenotazione e, quando
 * consentito dalla delega, l’esecuzione delle operazioni di annullamento
 * e ripianificazione.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `appointment-detail.html` dell’area Delegate. Coordina l’interazione
 * tra interfaccia utente, servizi API relativi a deleghe, appuntamenti e
 * disponibilità e componenti condivisi dell’applicazione, trasformando
 * il dettaglio tecnico dell’appuntamento in una vista leggibile e
 * operabile dal delegato autenticato.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Delegate;
 * - leggere da query string l’identificativo dell’assistito e
 *   dell’appuntamento;
 * - recuperare la delega associata all’assistito selezionato;
 * - recuperare il dettaglio dell’appuntamento richiesto;
 * - mostrare stato dell’appuntamento e stato del pagamento;
 * - aggiornare i link di navigazione contestuale;
 * - determinare se annullamento e ripianificazione siano consentiti;
 * - aprire le modali di annullamento e ripianificazione;
 * - ricaricare il dettaglio dopo eventuali operazioni di modifica;
 * - gestire loading ed errori globali della pagina.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.session.clearAuth()` nei casi di sessione scaduta;
 * - utilizza `APL.utils.requestJson()` come base per le chiamate API;
 * - utilizza `APL.utils.parseErrorMessage()` e `APL.utils.humanizeError()`
 *   per normalizzare i messaggi di errore;
 * - utilizza `APL.utils.toast()` per il feedback all’utente;
 * - utilizza `APL.ui.modal.open()` e `APL.ui.modal.close()` per le modali;
 * - interagisce con gli endpoint:
 *   - `/api/registry/delegates/me/delegations`
 *   - `/api/scheduling/delegates/me/appointments`
 *   - `/api/scheduling/delegates/me/availability`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli
 * nel global scope. La pagina mantiene uno stato locale minimo relativo
 * ad assistito, appuntamento, delega corrente e dettaglio della
 * prenotazione, così da supportare refresh mirati del contenuto e delle
 * azioni contestuali.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Delegate";

  // Endpoint per il recupero delle deleghe del delegato autenticato.
  const API_DELEGATIONS = "/api/registry/delegates/me/delegations";

  // Endpoint per il recupero e la modifica degli appuntamenti dell’assistito.
  const API_APPOINTMENTS = "/api/scheduling/delegates/me/appointments";

  // Endpoint per il recupero delle disponibilità utilizzate nella ripianificazione.
  const API_AVAILABILITY = "/api/scheduling/delegates/me/availability";

  // Stato locale della pagina.
  // Mantiene il contesto dell’assistito, dell’appuntamento richiesto,
  // della delega corrente e del dettaglio caricato.
  const state = {
    patientUserId: "",
    appointmentId: "",
    delegation: null,
    appt: null,
  };

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel box globale della pagina.
  function showError(message) {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Imposta il messaggio di errore con fallback coerente.
    box.textContent = message || "Errore imprevisto.";

    // Rende visibile il contenitore.
    box.classList.remove("hidden");
  }

  // Ripristina lo stato normale della pagina nascondendo l’eventuale errore globale.
  function clearError() {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Pulisce il contenuto testuale.
    box.textContent = "";

    // Nasconde nuovamente il contenitore.
    box.classList.add("hidden");
  }

  // Aggiorna lo stato del badge globale di caricamento.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);
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

  // Formatta una data/ora UTC in rappresentazione estesa e leggibile.
  function fmtDateTime(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard.
    if (!isoUtc) return "—";

    // Converte la stringa ISO in oggetto Date.
    const d = new Date(isoUtc);

    // Restituisce la data localizzata in formato italiano esteso.
    return d.toLocaleString("it-IT", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Formatta un importo monetario espresso in centesimi.
  function formatMoney(cents, currency) {
    // Converte i centesimi in unità monetaria con due decimali.
    const value = (Number(cents || 0) / 100).toFixed(2);

    // Restituisce la stringa finale con valuta di fallback.
    return `${value} ${currency || "EUR"}`;
  }

  // Normalizza una stringa di stato portandola in forma confrontabile.
  function normalizeStatus(raw) {
    return String(raw || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
  }

  // Traduce lo stato tecnico dell’appuntamento in una label leggibile e in un tone visuale.
  function mapStatus(raw) {
    const s = normalizeStatus(raw);
    if (s === "BOOKED") return { label: "Prenotato", tone: "blue" };
    if (s === "CHECKED_IN") return { label: "Accettato", tone: "amber" };
    if (s === "COMPLETED") return { label: "Completato", tone: "emerald" };
    if (s === "CANCELED" || s === "CANCELLED") return { label: "Annullato", tone: "slate" };
    if (s === "NO_SHOW") return { label: "Assente", tone: "slate" };
    return { label: raw || "—", tone: "slate" };
  }

  // Costruisce la pill visuale dello stato appuntamento.
  function statusPill(raw) {
    const m = mapStatus(raw);

    // Mappa il tone logico nelle classi Tailwind usate dalla UI.
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

  // Costruisce la pill visuale relativa allo stato del pagamento dell’appuntamento.
  function paymentPill(appt) {
    // Prova a ricavare lo stato pagamento dai diversi campi possibili esposti dal backend.
    const raw =
      appt?.paymentStatus ??
      appt?.paymentState ??
      (typeof appt?.isPaid === "boolean" ? (appt.isPaid ? "PAID" : "PENDING") : "");

    const s = String(raw || "").toUpperCase();

    // Stato di pagamento completato.
    if (s === "PAID" || s === "COMPLETED" || s === "SETTLED") {
      return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-700">Pagato</span>`;
    }

    // Stato di pagamento ancora aperto o da completare.
    if (s === "PENDING" || s === "REQUIRES_ACTION" || s === "OPEN") {
      return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-amber-50 text-amber-800">Pagamento da completare</span>`;
    }

    // Fallback neutro quando il dettaglio pagamento non è definito.
    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-slate-100 text-slate-700">Pagamento</span>`;
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

  // Wrapper centralizzato per richieste JSON autenticate con gestione uniforme
  // di sessione scaduta, accesso negato ed errori applicativi.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // Sessione non più valida: pulizia locale e redirect dedicato.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Accesso non consentito: redirect alla pagina dedicata.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Per tutti gli altri casi costruisce un errore arricchito.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    // In caso di successo restituisce direttamente il payload JSON.
    return res.data;
  }

  // Legge i parametri necessari dalla query string della pagina.
  function readParams() {
    const q = new URLSearchParams(window.location.search || "");
    const appointmentId = String(q.get("appointmentId") || "").trim();
    const patientUserId = String(q.get("patientUserId") || "").trim();
    return { appointmentId, patientUserId };
  }

  // Determina se una delega è attualmente attiva e temporalmente valida.
  function isDelegationActiveNow(d) {
    if (!d) return false;
    const status = String(d.status || "").toUpperCase();
    if (status !== "ACTIVE") return false;

    const now = Date.now();
    const s = Date.parse(d.startsAtUtc || "");
    const e = Date.parse(d.endsAtUtc || "");
    if (!Number.isFinite(s) || !Number.isFinite(e)) return true;
    return now >= s && now <= e;
  }

  // Verifica se l’ambito della delega consente la gestione appuntamenti.
  function canManageAppointments(d) {
    if (!d) return false;
    const scope = String(d.scope || "").toUpperCase();
    return scope === "MANAGEAPPOINTMENTS";
  }

  // Determina se l’appuntamento può essere modificato dal delegato corrente.
  function canModify(appt) {
    const d = state.delegation;
    if (!d || !isDelegationActiveNow(d) || !canManageAppointments(d)) return false;

    // Solo appuntamenti prenotati possono essere modificati.
    const status = normalizeStatus(appt?.status);
    if (status !== "BOOKED") return false;

    // L’appuntamento deve essere ancora futuro.
    const start = new Date(appt?.startUtc);
    return Number.isFinite(start.getTime()) && start > new Date();
  }

  // Aggiorna tutti i link di navigazione contestuale in base a assistito e appuntamento correnti.
  function setLinks() {
    const patientUserId = state.patientUserId;
    const appointmentId = state.appointmentId;

    const aTop = $("backToAppointments");
    const aPay = $("btnPayments");
    const aRep = $("btnReports");
    const aPre = $("btnPreVisit");

    // Link di ritorno all’elenco appuntamenti dell’assistito corrente.
    const apptsHref = patientUserId
      ? `./appointments.html?patientUserId=${encodeURIComponent(patientUserId)}`
      : "./appointments.html";

    if (aTop) aTop.href = apptsHref;

    // Link alla sezione pre-visita contestualizzata sull’appuntamento.
    if (aPre) {
      aPre.href =
        patientUserId && appointmentId
          ? `./pretriage.html?appointmentId=${encodeURIComponent(appointmentId)}&patientUserId=${encodeURIComponent(patientUserId)}`
          : "./pretriage.html";
    }

    // Link alla sezione pagamenti contestualizzata su assistito e appuntamento.
    if (aPay) {
      aPay.href =
        patientUserId
          ? `./payments.html?patientUserId=${encodeURIComponent(patientUserId)}&appointmentId=${encodeURIComponent(appointmentId)}`
          : "./payments.html";
    }

    // Link alla sezione referti contestualizzata sull’assistito.
    if (aRep) {
      aRep.href =
        patientUserId
          ? `./reports.html?patientUserId=${encodeURIComponent(patientUserId)}`
          : "./reports.html";
    }
  }

  // Aggiorna il nome dell’assistito nella testata della pagina.
  function setPatientName(text) {
    const el = $("patientName");
    if (!el) return;
    el.textContent = text || "Assistito";
  }

  // Aggiorna lo stato dei pulsanti azione e il riquadro esplicativo delle regole operative.
  function setActionsEnabled(appt) {
    const resBtn = $("btnReschedule");
    const canBtn = $("btnCancel");
    const rules = $("rulesBox");

    const enabled = canModify(appt);

    if (resBtn) resBtn.disabled = !enabled;
    if (canBtn) canBtn.disabled = !enabled;

    if (!rules) return;

    // Nessuna delega disponibile nel contesto corrente.
    if (!state.delegation) {
      rules.textContent = "Selezioni l’appuntamento dall’elenco dell’assistito per visualizzare eventuali azioni disponibili.";
      return;
    }

    // Delega non attiva temporalmente.
    if (!isDelegationActiveNow(state.delegation)) {
      rules.textContent = "Non risultano azioni disponibili: la delega selezionata non è attiva in questo momento.";
      return;
    }

    // Delega attiva ma con permessi insufficienti.
    if (!canManageAppointments(state.delegation)) {
      rules.textContent = "È possibile consultare i dettagli. Le modifiche non sono consentite dalla delega.";
      return;
    }

    // Caso pienamente modificabile.
    if (enabled) {
      rules.textContent = "È possibile ripianificare o annullare l’appuntamento fino a prima dell’orario previsto.";
      return;
    }

    // Caso non modificabile per stato dell’appuntamento.
    const label = mapStatus(appt?.status).label || "—";
    rules.textContent = `Non sono disponibili modifiche per l’appuntamento in stato “${label}”.`;
  }

  // Renderizza l’intero contenuto del dettaglio appuntamento nella pagina.
  function render(appt) {
    // Riferimento univoco dell’appuntamento.
    if ($("apptRef")) $("apptRef").textContent = appt?.id ? String(appt.id) : "—";

    // Nome e codice della prestazione.
    const name = appt?.serviceCode ? String(appt.serviceCode) : "Prestazione";
    const code = appt?.serviceCode ? `Codice: ${appt.serviceCode}` : "Codice: —";

    if ($("svcName")) $("svcName").textContent = name;
    if ($("svcCode")) $("svcCode").textContent = code;

    // Badge di stato appuntamento e pagamento.
    if ($("statusPill")) $("statusPill").innerHTML = statusPill(appt?.status);
    if ($("paymentPill")) $("paymentPill").innerHTML = paymentPill(appt);

    // Data/ora dell’appuntamento e hint contestuale rispetto all’istante corrente.
    if ($("whenText")) $("whenText").textContent = fmtDateTime(appt?.startUtc);
    if ($("whenHint")) {
      const d = appt?.startUtc ? new Date(appt.startUtc) : null;
      const now = new Date();
      $("whenHint").textContent =
        d && Number.isFinite(d.getTime())
          ? (d > now ? "Appuntamento in programma." : "Appuntamento passato o in corso.")
          : "—";
    }

    // Prezzo indicativo associato alla prenotazione.
    const cents = appt?.quotedPriceCents ?? 0;
    const cur = appt?.currency || "EUR";
    if ($("priceText")) $("priceText").textContent = formatMoney(cents, cur);

    // Note dell’appuntamento oppure fallback testuale.
    const notes = appt?.notes ? String(appt.notes) : "Nessuna nota associata.";
    if ($("notesText")) $("notesText").textContent = notes;

    // Aggiorna lo stato dei pulsanti di gestione e le relative regole.
    setActionsEnabled(appt);
  }

  // Carica la delega relativa all’assistito corrente e aggiorna il nome mostrato in pagina.
  async function loadDelegation() {
    const res = await APL.utils.requestJson(API_DELEGATIONS, {
      headers: { Accept: "application/json", ...APL.session.authHeader() },
    });

    if (!res.ok) {
      const msg = APL.utils.parseErrorMessage(res.data) || "Impossibile caricare le informazioni dell’assistito.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    const list = Array.isArray(res.data) ? res.data : [];
    const d = list.find((x) => String(x.patientUserId) === String(state.patientUserId)) || null;

    state.delegation = d;

    // Costruisce una label leggibile dell’assistito usando i migliori campi disponibili.
    const idx = Math.max(1, list.findIndex((x) => String(x.patientUserId) === String(state.patientUserId)) + 1);
    const name = d?.patientDisplayName || d?.patientFullName || d?.patientName || `Assistito ${idx}`;
    setPatientName(name);

    return d;
  }

  // Recupera l’appuntamento richiesto cercandolo nell’intervallo esteso di un anno passato e futuro.
  async function fetchAppointmentById() {
    const now = new Date();
    const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const url =
      `${API_APPOINTMENTS}?patientUserId=${encodeURIComponent(state.patientUserId)}` +
      `&fromUtc=${encodeURIComponent(from.toISOString())}` +
      `&toUtc=${encodeURIComponent(to.toISOString())}`;

    const data = await apiJson("GET", url);
    const list = Array.isArray(data) ? data : [];
    return list.find((x) => String(x.id) === String(state.appointmentId)) || null;
  }

  // Costruisce l’HTML degli slot disponibili nella modale di ripianificazione.
  function slotsHtml(slots, selectedId) {
    const list = Array.isArray(slots) ? slots : [];
    if (!list.length) {
      return `<div class="text-sm text-slate-600">Nessuna disponibilità trovata per l’intervallo selezionato.</div>`;
    }

    // Raggruppa gli slot per giorno locale.
    const byDay = new Map();
    for (const s of list) {
      const d = new Date(s.startUtc);
      const key = d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(s);
    }

    const keys = Array.from(byDay.keys()).sort((a, b) => a.localeCompare(b, "it"));

    // Costruisce una card per ciascun giorno e un pulsante per ogni slot disponibile.
    return keys
      .map((key) => {
        const daySlots = byDay.get(key) || [];
        daySlots.sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));

        const header = new Date(daySlots[0].startUtc).toLocaleDateString("it-IT", {
          weekday: "long",
          day: "2-digit",
          month: "long",
        });

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

  // Apre la modale di annullamento appuntamento e gestisce la conferma lato backend.
  async function openCancelModal(appt, onDone) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    const bodyHtml = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Appuntamento</div>
          <div class="mt-1 text-sm text-slate-800">
            <span class="font-medium">${escapeHtml(appt.serviceCode || "Prestazione")}</span>
            <span class="text-slate-500">•</span>
            <span>${escapeHtml(fmtDateTime(appt.startUtc))}</span>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700" for="cancelReason">Motivo (opzionale)</label>
          <textarea id="cancelReason" rows="4" maxlength="400"
            class="mt-2 w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="Inserire un motivo…"></textarea>
        </div>

        <div id="cancelErr" class="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"></div>
      </div>
    `;

    // Utility locale per mostrare o nascondere l’errore specifico della modale.
    const setErr = (msg) => {
      const box = document.getElementById("cancelErr");
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
            const reason = String(document.getElementById("cancelReason")?.value || "").trim() || null;

            try {
              const url =
                `${API_APPOINTMENTS}/${encodeURIComponent(String(appt.id))}/cancel` +
                `?patientUserId=${encodeURIComponent(String(state.patientUserId))}`;

              await apiJson("POST", url, { reason });

              APL.utils.toast("Appuntamento annullato.", "success");
              if (APL.ui?.modal?.close) APL.ui.modal.close();
              if (typeof onDone === "function") await onDone();
            } catch (err) {
              setErr(APL.utils.humanizeError(err) || "Operazione non riuscita.");
            }
          },
        },
      ],
    });
  }

  // Apre la modale di ripianificazione appuntamento e gestisce la scelta del nuovo slot.
  async function openRescheduleModal(appt, onDone) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    // Prepara un intervallo di default da domani a due settimane avanti.
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Utility locale per formattare una data nel formato richiesto dagli input date.
    const toLocal = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    const fromDefault = toLocal(start);
    const toDefault = toLocal(end);

    // Stato locale della modale.
    let slots = [];
    let selectedSlotId = null;

    const bodyHtml = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Appuntamento attuale</div>
          <div class="mt-1 text-sm text-slate-800">
            <span class="font-medium">${escapeHtml(appt.serviceCode || "Prestazione")}</span>
            <span class="text-slate-500">•</span>
            <span>${escapeHtml(fmtDateTime(appt.startUtc))}</span>
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

        <div id="rsSlots" class="space-y-3"></div>
        <div id="rsErr" class="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"></div>
      </div>
    `;

    // Utility locale per mostrare o nascondere l’errore specifico della modale.
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

    // Renderizza la lista degli slot e collega i relativi pulsanti di selezione.
    const renderSlots = () => {
      const box = document.getElementById("rsSlots");
      if (!box) return;
      box.innerHTML = slotsHtml(slots, selectedSlotId);

      box.querySelectorAll("[data-slot-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedSlotId = btn.getAttribute("data-slot-id");
          renderSlots();
        });
      });
    };

    // Esegue la ricerca delle disponibilità alternative per la ripianificazione.
    const searchSlots = async () => {
      setErr("");

      try {
        const fromEl = document.getElementById("rsFrom");
        const toEl = document.getElementById("rsTo");

        const fromVal = String(fromEl?.value || "").trim();
        const toVal = String(toEl?.value || "").trim();

        if (!fromVal || !toVal) {
          setErr("Inserire un intervallo di ricerca valido.");
          return;
        }

        const range = APL.utils.romeDateRangeToUtc(fromVal, toVal);
        if (!range) {
          setErr("Inserire un intervallo di ricerca valido.");
          return;
        }

        const url =
          `${API_AVAILABILITY}?patientUserId=${encodeURIComponent(String(state.patientUserId))}` +
          `&serviceCode=${encodeURIComponent(String(appt.serviceCode || ""))}` +
          `&fromUtc=${encodeURIComponent(range.fromUtc)}` +
          `&toUtc=${encodeURIComponent(range.toUtc)}`;

        const data = await apiJson("GET", url);
        slots = Array.isArray(data) ? data : [];
        selectedSlotId = null;
        renderSlots();
      } catch (err) {
        setErr(APL.utils.humanizeError(err) || "Impossibile recuperare le disponibilità.");
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

            if (!selectedSlotId) {
              setErr("Selezionare uno slot disponibile.");
              return;
            }

            try {
              const url =
                `${API_APPOINTMENTS}/${encodeURIComponent(String(appt.id))}/reschedule` +
                `?patientUserId=${encodeURIComponent(String(state.patientUserId))}`;

              await apiJson("POST", url, { newSlotId: selectedSlotId });

              APL.utils.toast("Appuntamento ripianificato.", "success");
              if (APL.ui?.modal?.close) APL.ui.modal.close();
              if (typeof onDone === "function") await onDone();
            } catch (err) {
              setErr(APL.utils.humanizeError(err) || "Operazione non riuscita.");
            }
          },
        },
      ],
    });

    // Collega il pulsante di ricerca disponibilità all’interno della modale.
    const btnSearch = document.getElementById("btnRsSearch");
    if (btnSearch) {
      btnSearch.addEventListener("click", searchSlots);
    }

    // Esegue subito una ricerca iniziale così da presentare le prime disponibilità.
    await searchSlots();
  }

  // Ricarica il dettaglio corrente dell’appuntamento e sincronizza la UI della pagina.
  async function reloadCurrentAppointment() {
    clearError();
    setLoading(true);

    try {
      const appt = await fetchAppointmentById();
      state.appt = appt;

      if (!appt) {
        showError("Appuntamento non trovato. Verifichi l’elenco appuntamenti dell’assistito.");
        return;
      }

      render(appt);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il dettaglio appuntamento.");
    } finally {
      setLoading(false);
    }
  }

  // Inizializza la pagina di dettaglio appuntamento del delegato.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Delegate.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Legge il contesto minimo necessario dalla query string.
    const params = readParams();
    state.patientUserId = params.patientUserId;
    state.appointmentId = params.appointmentId;

    // Se mancano i parametri obbligatori la pagina non può essere aperta correttamente.
    if (!state.patientUserId || !state.appointmentId) {
      showError("Impossibile aprire questa sezione. Acceda dall’elenco appuntamenti dell’assistito.");
      return;
    }

    // Aggiorna i link contestuali della pagina.
    setLinks();

    try {
      setLoading(true);
      await ensureModalReady(10000);

      // Recupera la delega relativa all’assistito corrente e il dettaglio dell’appuntamento.
      await loadDelegation();
      await reloadCurrentAppointment();

      // Collega il pulsante di annullamento all’azione modale contestuale.
      const btnCancel = $("btnCancel");
      if (btnCancel) {
        btnCancel.addEventListener("click", async () => {
          if (!state.appt || !canModify(state.appt)) return;
          await openCancelModal(state.appt, reloadCurrentAppointment);
        });
      }

      // Collega il pulsante di ripianificazione all’azione modale contestuale.
      const btnReschedule = $("btnReschedule");
      if (btnReschedule) {
        btnReschedule.addEventListener("click", async () => {
          if (!state.appt || !canModify(state.appt)) return;
          await openRescheduleModal(state.appt, reloadCurrentAppointment);
        });
      }
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il dettaglio appuntamento.");
    } finally {
      setLoading(false);
    }
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
