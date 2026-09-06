/**
 * File: frontend/js/delegate/appointments.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina appuntamenti
 * dell’area Delegate, consentendo al delegato di selezionare un assistito,
 * recuperare gli appuntamenti associati alla delega corrente, applicare
 * filtri temporali e testuali, visualizzare statistiche sintetiche e
 * gestire eventuali azioni consentite come dettaglio, ripianificazione
 * e annullamento.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `appointments.html` dell’area Delegate. Coordina l’interazione tra
 * interfaccia utente, servizi API relativi a deleghe, appuntamenti e
 * disponibilità e componenti condivisi dell’applicazione, trasformando
 * i dati restituiti dal backend in una vista consultabile, filtrabile
 * e, quando consentito dai permessi, anche operabile.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Delegate;
 * - recuperare l’elenco delle deleghe disponibili del delegato;
 * - determinare l’assistito selezionato e la delega corrente;
 * - recuperare gli appuntamenti nel range temporale richiesto;
 * - applicare filtri locali per stato e ricerca testuale;
 * - aggiornare le statistiche sintetiche della pagina;
 * - renderizzare la tabella degli appuntamenti e lo stato vuoto;
 * - determinare se ripianificazione e annullamento siano consentiti;
 * - gestire le modali di annullamento e ripianificazione;
 * - sincronizzare query string, link di prenotazione e messaggi guida.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.session.clearAuth()` nei casi di sessione scaduta;
 * - utilizza `APL.utils.requestJson()` come base per le chiamate API;
 * - utilizza `APL.utils.setLoading()` per il pulsante di refresh;
 * - utilizza `APL.utils.parseErrorMessage()` e `APL.utils.humanizeError()`
 *   per normalizzare i messaggi di errore;
 * - utilizza utility temporali come `APL.utils.toRomeDateInputValue()`,
 *   `APL.utils.romeTodayDateInputValue()`, `APL.utils.addDaysToDateInput()`
 *   e `APL.utils.romeDateRangeToUtc()`;
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
 * nel global scope. La pagina mantiene uno stato locale con deleghe,
 * assistito selezionato e dataset completo degli appuntamenti, così da
 * supportare filtri client-side, rendering e azioni contestuali senza
 * richiedere nuove chiamate al backend per ogni interazione locale.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Delegate";

  // Endpoint per il recupero delle deleghe del delegato autenticato.
  const API_DELEGATIONS = "/api/registry/delegates/me/delegations";

  // Endpoint per il recupero degli appuntamenti dell’assistito selezionato.
  const API_APPOINTMENTS = "/api/scheduling/delegates/me/appointments";

  // Endpoint per il recupero delle disponibilità da usare in ripianificazione.
  const API_AVAILABILITY = "/api/scheduling/delegates/me/availability";

  // Stato locale della pagina usato per memorizzare deleghe, assistito
  // selezionato, delega corrente e dataset completo degli appuntamenti caricati.
  const state = {
    delegations: [],
    selectedDelegation: null,
    selectedPatientUserId: "",
    all: [],
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

    // Imposta il testo di errore con un fallback coerente.
    box.textContent = message || "Errore imprevisto.";

    // Rende visibile il contenitore.
    box.classList.remove("hidden");
  }

  // Ripristina lo stato normale della pagina nascondendo l’eventuale errore globale.
  function clearError() {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");
    if (!box) return;

    // Pulisce il testo precedentemente mostrato.
    box.textContent = "";

    // Nasconde nuovamente il contenitore.
    box.classList.add("hidden");
  }

  // Aggiorna lo stato di caricamento della vista.
  // Oltre al badge, blocca temporaneamente i controlli di filtro e navigazione locale.
  function setLoading(loading) {
    // Mostra o nasconde il badge globale di caricamento.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Aggiorna lo stato visuale del pulsante di refresh.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

    // Elenco dei controlli che devono essere temporaneamente disabilitati.
    const ids = [
      "patientSelect",
      "btnReloadDelegations",
      "fromDate",
      "toDate",
      "statusSelect",
      "searchInput",
      "btnNext30",
      "btnLast30",
      "btnYear",
      "btnResetFilters",
    ];

    // Applica lo stato disabled a tutti i controlli presenti.
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
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

  // Converte una data JavaScript nel formato richiesto dagli input date in fuso di Roma.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formatta una data/ora UTC in rappresentazione leggibile per la tabella e le modali.
  function fmtDateTime(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard.
    if (!isoUtc) return "—";

    // Converte il valore in oggetto Date.
    const d = new Date(isoUtc);

    // Restituisce data e ora nel formato locale italiano.
    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
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

  // Mostra o nasconde lo stato vuoto della tabella.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
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
      // Gestione della sessione scaduta con pulizia e redirect.
      if (res.status === 401) {
        try {
          APL.session.clearAuth();
        } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Gestione del caso di accesso non autorizzato.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Costruzione di un errore arricchito per gli altri casi.
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

  // Legge il range temporale corrente dai campi della UI oppure restituisce un fallback di default.
  function readRangeOrDefault() {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    // Se entrambi i campi sono valorizzati, converte il range nel corrispondente intervallo UTC.
    if (from && to) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) {
        return { fromUtc: range.fromUtc, toUtc: range.toUtc, fromLocal: from, toLocal: to };
      }
    }

    // In fallback usa da oggi ai prossimi 30 giorni.
    const today = APL.utils.romeTodayDateInputValue();
    const end = APL.utils.addDaysToDateInput(today, 30);
    const range = APL.utils.romeDateRangeToUtc(today, end);

    return {
      fromUtc: new Date().toISOString(),
      toUtc: range.toUtc,
      fromLocal: "",
      toLocal: "",
    };
  }

  // Applica un preset rapido di intervallo temporale alla UI.
  function applyQuickRange(kind) {
    const fromEl = $("fromDate");
    const toEl = $("toDate");
    if (!fromEl || !toEl) return;

    const today = APL.utils.romeTodayDateInputValue();

    if (kind === "next30") {
      fromEl.value = today;
      toEl.value = APL.utils.addDaysToDateInput(today, 30);
    } else if (kind === "last30") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -30);
      toEl.value = today;
    } else if (kind === "year") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -365);
      toEl.value = today;
    }
  }

  // Aggiorna i riquadri statistici della pagina.
  function setStats(items) {
    const list = Array.isArray(items) ? items : [];
    const now = new Date();

    const total = list.length;
    const upcoming = list.filter((x) => new Date(x.startUtc) >= now).length;
    const past = total - upcoming;

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statUpcoming")) $("statUpcoming").textContent = String(upcoming);
    if ($("statPast")) $("statPast").textContent = String(past);
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

  // Determina se un appuntamento può essere modificato dal delegato corrente.
  function canModify(appt) {
    // Solo appuntamenti prenotati sono eleggibili per annullamento o ripianificazione.
    const status = normalizeStatus(appt?.status);
    if (status !== "BOOKED") return false;

    // Non si può modificare un appuntamento già iniziato o nel passato.
    const start = new Date(appt.startUtc);
    if (!Number.isFinite(start.getTime()) || start <= new Date()) return false;

    // La delega corrente deve essere attiva e con permesso di gestione appuntamenti.
    const d = state.selectedDelegation;
    return !!d && isDelegationActiveNow(d) && canManageAppointments(d);
  }

  // Aggiorna il messaggio guida relativo alla delega selezionata.
  function updateDelegationHint() {
    const el = $("delegationHint");
    if (!el) return;

    const d = state.selectedDelegation;
    if (!d || !state.selectedPatientUserId) {
      el.textContent = "Selezioni un assistito per visualizzare gli appuntamenti.";
      return;
    }

    if (!isDelegationActiveNow(d)) {
      el.textContent = "La delega selezionata non risulta attiva in questo momento.";
      return;
    }

    el.textContent = canManageAppointments(d)
      ? "È possibile consultare e, se necessario, ripianificare o annullare gli appuntamenti in base ai permessi disponibili."
      : "È possibile consultare gli appuntamenti. Alcune azioni potrebbero non essere disponibili.";
  }

  // Aggiorna i link verso la pagina di prenotazione in base alla delega corrente.
  function updateBookingLinks() {
    const top = $("newBookingLink");
    const empty = $("emptyBookingLink");

    const d = state.selectedDelegation;
    const ok = !!d && isDelegationActiveNow(d) && canManageAppointments(d) && !!state.selectedPatientUserId;

    const href = ok
      ? `./booking.html?patientUserId=${encodeURIComponent(String(state.selectedPatientUserId))}`
      : "./booking.html";

    if (top) {
      top.href = href;
      top.classList.toggle("hidden", !ok);
    }

    if (empty) {
      empty.href = href;
      empty.classList.toggle("hidden", !ok);
    }
  }

  // Renderizza la tabella degli appuntamenti e aggiorna statistiche e stato vuoto.
  function renderRows(items) {
    const tbody = $("appointmentsTbody");
    if (!tbody) return;

    const list = Array.isArray(items) ? items : [];
    setStats(list);

    // Se non esiste ancora un assistito selezionato, mostra un placeholder dedicato.
    if (!state.selectedPatientUserId) {
      emptyState(false);
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Selezioni un assistito per iniziare.</td></tr>`;
      return;
    }

    // Se non ci sono risultati filtrati, mostra lo stato vuoto.
    if (!list.length) {
      emptyState(true);
      tbody.innerHTML =
        `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    // Classi CSS riusabili per pulsanti attivi e disabilitati.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";
    const btnClsDisabled =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-400 cursor-not-allowed opacity-70";

    // Costruisce tutte le righe della tabella ordinando cronologicamente gli appuntamenti.
    const rows = list
      .slice()
      .sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc))
      .map((a) => {
        const when = escapeHtml(fmtDateTime(a.startUtc));
        const svc = escapeHtml(a.serviceCode || "—");
        const st = statusPill(a.status);
        const price = escapeHtml(formatMoney(a.quotedPriceCents, a.currency));
        const notes = a.notes ? String(a.notes) : "";
        const notesText = notes ? escapeHtml(notes) : "—";

        const can = canModify(a);

        return `
          <tr>
            <td class="py-4 pr-4 text-slate-800">${when}</td>
            <td class="py-4 pr-4 text-slate-700">${svc}</td>
            <td class="py-4 pr-4">${st}</td>
            <td class="py-4 pr-4 text-slate-700">${price}</td>
            <td class="py-4 pr-4 text-slate-600 max-w-[360px] truncate" title="${notesText}">${notesText}</td>
            <td class="py-4 text-right">
              <div class="inline-flex items-center gap-2 justify-end">
                <button type="button" data-action="details" data-id="${escapeHtml(String(a.id))}"
                  class="${btnCls}">
                  Dettagli
                </button>
                <button type="button" data-action="reschedule" data-id="${escapeHtml(String(a.id))}"
                  class="${can ? btnCls : btnClsDisabled}" ${can ? "" : "disabled"}>
                  Ripianifica
                </button>
                <button type="button" data-action="cancel" data-id="${escapeHtml(String(a.id))}"
                  class="${can ? btnCls : btnClsDisabled}" ${can ? "" : "disabled"}>
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

  // Applica i filtri locali al dataset già caricato dal backend.
  function filterClientSide(items) {
    const statusSel = String($("statusSelect")?.value || "ALL").toUpperCase();
    const term = String($("searchInput")?.value || "").trim().toLowerCase();

    return (Array.isArray(items) ? items : []).filter((a) => {
      if (statusSel !== "ALL" && normalizeStatus(a.status) !== statusSel) return false;
      if (!term) return true;

      const svc = String(a.serviceCode || "").toLowerCase();
      const notes = String(a.notes || "").toLowerCase();
      return svc.includes(term) || notes.includes(term);
    });
  }

  // Esegue la navigazione verso il dettaglio dell’appuntamento mantenendo il contesto del paziente.
  function detailsNav(appointmentId) {
    const patientUserId = state.selectedPatientUserId;
    window.location.href =
      `./appointment-detail.html?appointmentId=${encodeURIComponent(String(appointmentId))}` +
      `&patientUserId=${encodeURIComponent(String(patientUserId))}`;
  }

  // Costruisce l’HTML degli slot disponibili da mostrare nella modale di ripianificazione.
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

    // Utility locale per mostrare o nascondere l’errore della modale.
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
              const patientUserId = state.selectedPatientUserId;
              const url =
                `${API_APPOINTMENTS}/${encodeURIComponent(String(appt.id))}/cancel` +
                `?patientUserId=${encodeURIComponent(String(patientUserId))}`;

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

  // Apre la modale di ripianificazione appuntamento e gestisce la selezione del nuovo slot.
  async function openRescheduleModal(appt, onDone) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    // Prepara un range di default da domani a due settimane in avanti.
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Utility locale per formattare una data in formato input date.
    const toLocal = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    const fromDefault = toLocal(start);
    const toDefault = toLocal(end);

    // Stato locale della modale: slot caricati e slot selezionato.
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

    // Utility locale per mostrare o nascondere l’errore della modale.
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

    // Carica gli slot disponibili per la ripianificazione nel range selezionato.
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
        const params = new URLSearchParams();
        params.set("patientUserId", String(state.selectedPatientUserId));
        if (appt?.clinicianUserId) params.set("clinicianUserId", String(appt.clinicianUserId));
        params.set("fromUtc", range.fromUtc);
        params.set("toUtc", range.toUtc);

        const data = await apiJson("GET", `${API_AVAILABILITY}?${params.toString()}`);

        const now2 = new Date();
        const raw = Array.isArray(data) ? data : [];

        // Esclude slot non validi, passati o coincidenti con lo slot attuale.
        slots = raw.filter((s) => {
          const start2 = new Date(s.startUtc);
          if (!Number.isFinite(start2.getTime())) return false;
          if (start2 <= now2) return false;
          if (String(s.id) === String(appt.slotId)) return false;
          return true;
        });

        selectedSlotId = null;

        const host = document.getElementById("rsHost");
        if (host) host.innerHTML = slotsHtml(slots, selectedSlotId);
      } catch (err) {
        setErr(APL.utils.humanizeError(err) || "Impossibile caricare le disponibilità.");
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

            if (!selectedSlotId) {
              setErr("Selezioni un nuovo orario prima di confermare.");
              return;
            }

            const reason = String(document.getElementById("rsReason")?.value || "").trim() || null;
            const notes = String(document.getElementById("rsNotes")?.value || "").trim() || null;

            try {
              const patientUserId = state.selectedPatientUserId;
              const url =
                `${API_APPOINTMENTS}/${encodeURIComponent(String(appt.id))}/reschedule` +
                `?patientUserId=${encodeURIComponent(String(patientUserId))}`;

              await apiJson("POST", url, { newSlotId: selectedSlotId, reason, notes });
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

    // Collega la ricerca disponibilità all’interno della modale.
    const btn = document.getElementById("btnRsSearch");
    if (btn) btn.addEventListener("click", refreshSlots);

    // Collega la selezione dello slot alla UI della modale tramite event delegation.
    const host = document.getElementById("rsHost");
    if (host) {
      host.addEventListener("click", (ev) => {
        const b = ev.target?.closest?.("button[data-slot-id]");
        if (!b) return;
        const slotId = b.getAttribute("data-slot-id");
        if (!slotId) return;

        const found = slots.find((s) => String(s.id) === String(slotId));
        if (!found) return;

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

  // Carica le deleghe disponibili e popola il selettore degli assistiti.
  async function loadDelegations() {
    const res = await APL.utils.requestJson(API_DELEGATIONS, {
      headers: { Accept: "application/json", ...APL.session.authHeader() },
    });

    const delegations = Array.isArray(res.data) ? res.data : [];
    state.delegations = delegations;

    const select = $("patientSelect");
    if (!select) return;

    select.innerHTML = "";

    // Se non ci sono deleghe disponibili, mostra una sola opzione informativa.
    if (!delegations.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nessuna delega disponibile";
      select.appendChild(opt);

      state.selectedPatientUserId = "";
      state.selectedDelegation = null;

      // Pulisce la query string dall’eventuale patientUserId obsoleto.
      const qs = new URLSearchParams(window.location.search);
      if (qs.has("patientUserId")) {
        qs.delete("patientUserId");
        const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}`;
        window.history.replaceState({}, "", next);
      }

      updateDelegationHint();
      updateBookingLinks();
      return;
    }

    // Inserisce il placeholder iniziale del selettore.
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selezioni un assistito…";
    select.appendChild(placeholder);

    // Popola il selettore con tutte le deleghe disponibili.
    delegations.forEach((d, idx) => {
      const opt = document.createElement("option");
      opt.value = d.patientUserId;

      const name = d.patientDisplayName || d.patientFullName || d.patientName || `Assistito ${idx + 1}`;
      const status = String(d.status || "");
      const scope = String(d.scope || "");

      const suffix = (status || scope) ? ` — ${[status, scope].filter(Boolean).join(", ")}` : "";
      opt.textContent = `${name}${suffix}`;

      select.appendChild(opt);
    });

    // Se presente in query string, tenta di preselezionare l’assistito richiesto.
    const qs = new URLSearchParams(window.location.search);
    const fromQs = String(qs.get("patientUserId") || "").trim();
    const hasValidFromQs = !!fromQs && delegations.some((d) => String(d.patientUserId) === String(fromQs));

    const pick = hasValidFromQs ? fromQs : "";

    select.value = pick;

    if (!pick) {
      state.selectedPatientUserId = "";
      state.selectedDelegation = null;

      if (qs.get("patientUserId")) {
        qs.delete("patientUserId");
        const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}`;
        window.history.replaceState({}, "", next);
      }
    } else {
      state.selectedPatientUserId = pick;
      state.selectedDelegation = delegations.find((x) => String(x.patientUserId) === String(pick)) || null;
    }

    updateDelegationHint();
    updateBookingLinks();
  }

  // Carica gli appuntamenti dell’assistito selezionato nel range temporale corrente.
  async function loadAppointments() {
    clearError();
    setLoading(true);

    try {
      const patientUserId = String(state.selectedPatientUserId || "").trim();
      if (!patientUserId) {
        state.all = [];
        renderRows([]);
        return;
      }

      const rr = readRangeOrDefault();
      const url =
        `${API_APPOINTMENTS}?patientUserId=${encodeURIComponent(patientUserId)}` +
        `&fromUtc=${encodeURIComponent(rr.fromUtc)}&toUtc=${encodeURIComponent(rr.toUtc)}`;

      const data = await apiJson("GET", url);
      state.all = Array.isArray(data) ? data : [];

      const filtered = filterClientSide(state.all);
      renderRows(filtered);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare gli appuntamenti.");
      const tbody = $("appointmentsTbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">—</td></tr>`;
      emptyState(false);
      setStats([]);
    } finally {
      setLoading(false);
    }
  }

  // Collega tutti gli eventi della pagina ai rispettivi controlli UI.
  function wireEvents() {
    // Refresh esplicito degli appuntamenti nel range corrente.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", loadAppointments);

    // Refresh esplicito dell’elenco assistiti/deleghe con successivo ricaricamento appuntamenti.
    const btnReload = $("btnReloadDelegations");
    if (btnReload) {
      btnReload.addEventListener("click", async () => {
        clearError();
        setLoading(true);
        try {
          await loadDelegations();
          await loadAppointments();
        } catch (err) {
          showError(APL.utils.humanizeError(err) || "Impossibile aggiornare l’elenco assistiti.");
        } finally {
          setLoading(false);
        }
      });
    }

    // Cambio dell’assistito selezionato.
    const select = $("patientSelect");
    if (select) {
      select.addEventListener("change", async () => {
        state.selectedPatientUserId = select.value || "";
        state.selectedDelegation = state.delegations.find(
          (x) => String(x.patientUserId) === String(state.selectedPatientUserId)
        ) || null;

        // Propaga il patientUserId nella query string della pagina corrente.
        const qs = new URLSearchParams(window.location.search);
        if (state.selectedPatientUserId) qs.set("patientUserId", state.selectedPatientUserId);
        else qs.delete("patientUserId");
        const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}`;
        window.history.replaceState({}, "", next);

        updateDelegationHint();
        updateBookingLinks();
        await loadAppointments();
      });
    }

    // Preset rapidi di range temporale.
    const btnNext30 = $("btnNext30");
    if (btnNext30) btnNext30.addEventListener("click", async () => { applyQuickRange("next30"); await loadAppointments(); });

    const btnLast30 = $("btnLast30");
    if (btnLast30) btnLast30.addEventListener("click", async () => { applyQuickRange("last30"); await loadAppointments(); });

    const btnYear = $("btnYear");
    if (btnYear) btnYear.addEventListener("click", async () => { applyQuickRange("year"); await loadAppointments(); });

    // Filtri locali per stato e ricerca testuale.
    const statusSel = $("statusSelect");
    if (statusSel) statusSel.addEventListener("change", () => renderRows(filterClientSide(state.all)));

    const search = $("searchInput");
    if (search) search.addEventListener("input", () => renderRows(filterClientSide(state.all)));

    // Modifica del range temporale con ricaricamento backend.
    const fromDate = $("fromDate");
    const toDate = $("toDate");
    if (fromDate) fromDate.addEventListener("change", loadAppointments);
    if (toDate) toDate.addEventListener("change", loadAppointments);

    // Reset dei filtri allo stato base della pagina.
    const btnReset = $("btnResetFilters");
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        $("statusSelect").value = "ALL";
        $("searchInput").value = "";
        applyQuickRange("next30");
        renderRows(filterClientSide(state.all));
      });
    }

    // Event delegation sulle azioni disponibili nella tabella appuntamenti.
    const tbody = $("appointmentsTbody");
    if (tbody) {
      tbody.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-action][data-id]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        if (!id) return;

        const appt = (Array.isArray(state.all) ? state.all : []).find((x) => String(x.id) === String(id));
        if (!appt) return;

        if (action === "details") {
          detailsNav(id);
          return;
        }

        if (action === "reschedule") {
          if (!canModify(appt)) return;
          await openRescheduleModal(appt, loadAppointments);
          return;
        }

        if (action === "cancel") {
          if (!canModify(appt)) return;
          await openCancelModal(appt, loadAppointments);
          return;
        }
      });
    }
  }

  // Inizializza la pagina appuntamenti assistito.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Delegate.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Inizializza il range di default e collega gli eventi della pagina.
    applyQuickRange("next30");
    wireEvents();

    try {
      await loadDelegations();
      updateDelegationHint();
      updateBookingLinks();
      await loadAppointments();
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la pagina.");
    }
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
