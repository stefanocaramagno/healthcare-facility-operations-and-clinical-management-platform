/**
 * File: frontend/js/patient/appointments.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina "I tuoi appuntamenti"
 * dell’area Patient, includendo il caricamento della lista degli appuntamenti,
 * l’applicazione dei filtri temporali e testuali, la consultazione dei dettagli,
 * l’annullamento e la ripianificazione degli appuntamenti modificabili.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista agenda personale del
 * paziente. Si integra con i moduli condivisi del front-end per autenticazione,
 * sessione, richieste HTTP, gestione modali, utilità di formattazione e toast,
 * coordinando il recupero dei dati dal backend e la loro traduzione in una
 * tabella interattiva.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Patient;
 * - recuperare gli appuntamenti del paziente in un intervallo temporale;
 * - applicare filtri lato client per stato e ricerca testuale;
 * - mostrare statistiche sintetiche su totale, appuntamenti futuri e passati;
 * - consentire l’accesso al dettaglio del singolo appuntamento;
 * - permettere l’annullamento degli appuntamenti modificabili;
 * - permettere la ripianificazione selezionando un nuovo slot disponibile;
 * - aggiornare la vista dopo ogni operazione completata con successo;
 * - gestire loading, errori globali e feedback utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.session.clearAuth` nei casi di sessione scaduta;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading`,
 *   `APL.utils.toRomeDateInputValue`, `APL.utils.romeTodayDateInputValue`,
 *   `APL.utils.addDaysToDateInput` e `APL.utils.romeDateRangeToUtc`;
 * - utilizza `APL.ui.modal.open` per i flussi di annullamento e ripianificazione;
 * - utilizza `APL.utils.toast` per fornire feedback immediato all’utente;
 * - interagisce con gli endpoint:
 *   `/api/scheduling/patients/me/appointments`
 *   `/api/scheduling/patients/me/availability`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * Le operazioni di annullamento e ripianificazione vengono rese disponibili
 * soltanto per gli appuntamenti futuri in stato prenotato, coerentemente con
 * la logica di business implementata lato client.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla vista appuntamenti.
  const EXPECTED_ROLE = "Patient";

  // Endpoint per il recupero e la gestione degli appuntamenti del paziente autenticato.
  const API_APPOINTMENTS = "/api/scheduling/patients/me/appointments";

  // Endpoint per il recupero delle disponibilità utilizzato nel flusso di ripianificazione.
  const API_AVAILABILITY = "/api/scheduling/patients/me/availability";

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

  // Aggiorna lo stato di caricamento generale della pagina.
  // Oltre al badge, gestisce il pulsante di refresh e disabilita i controlli di filtro.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

    const ids = ["fromDate", "toDate", "statusSelect", "searchInput", "btnNext30", "btnLast30", "btnYear"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Esegue l’escape HTML di una stringa prima dell’inserimento nel markup dinamico.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Converte una data JavaScript nel formato atteso da un input HTML di tipo date,
  // mantenendo il riferimento temporale coerente con il calendario di Roma.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formattta una data/ora ISO UTC in forma leggibile per la tabella e per i modali.
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

  // Formattta un importo espresso in centesimi nella valuta corrispondente.
  function formatMoney(cents, currency) {
    const value = (Number(cents || 0) / 100).toFixed(2);
    return `${value} ${currency || "EUR"}`;
  }

  // Normalizza lo stato proveniente dal backend uniformando formati diversi
  // come camelCase, PascalCase, spazi o trattini.
  function normalizeStatus(raw) {
    return String(raw || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
  }

  // Traduce lo stato applicativo in una coppia label/tone utilizzata dalla UI.
  function mapStatus(raw) {
    const s = normalizeStatus(raw);

    if (s === "BOOKED") return { label: "Prenotato", tone: "blue" };
    if (s === "CHECKED_IN") return { label: "Accettato", tone: "amber" };
    if (s === "COMPLETED") return { label: "Completato", tone: "emerald" };
    if (s === "CANCELED" || s === "CANCELLED") return { label: "Annullato", tone: "slate" };
    if (s === "NO_SHOW") return { label: "Assente", tone: "slate" };

    return { label: raw || "—", tone: "slate" };
  }

  // Costruisce il badge HTML che rappresenta visivamente lo stato dell’appuntamento.
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

  // Mostra o nasconde lo stato vuoto della pagina.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Attende che il sistema modale condiviso sia pronto prima di essere utilizzato.
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
        try {
          APL.session.clearAuth();
        } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Se l’utente non possiede i permessi richiesti, delega il redirect alla vista forbidden.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Negli altri casi costruisce un errore applicativo arricchito con metadati utili.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Legge l’intervallo selezionato nei controlli della pagina.
  // Se i campi sono valorizzati e validi, restituisce il range richiesto.
  // In caso contrario applica un fallback di default sui prossimi 30 giorni.
  function readRangeOrDefault() {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    if (from && to) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) {
        return { fromUtc: range.fromUtc, toUtc: range.toUtc, fromLocal: from, toLocal: to };
      }
    }

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

  // Applica un intervallo temporale rapido ai filtri della pagina.
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

  // Aggiorna i contatori sintetici della vista corrente.
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

  // Determina se un appuntamento può essere modificato lato UI.
  // La regola adottata è: stato BOOKED e orario di inizio futuro.
  function canModify(appt) {
    const status = normalizeStatus(appt?.status);
    if (status !== "BOOKED") return false;

    const start = new Date(appt.startUtc);
    return Number.isFinite(start.getTime()) && start > new Date();
  }

  // Renderizza il contenuto tabellare degli appuntamenti.
  function renderRows(items) {
    const tbody = $("appointmentsTbody");
    if (!tbody) return;

    const list = Array.isArray(items) ? items : [];
    setStats(list);

    // Se non ci sono risultati, mostra stato vuoto e messaggio informativo nella tabella.
    if (!list.length) {
      emptyState(true);
      tbody.innerHTML =
        `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    const rows = list
      .slice()
      .sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc))
      .map((a) => {
        const when = escapeHtml(fmtDateTime(a.startUtc));
        const svc = escapeHtml(a.serviceCode || "—");
        const st = statusPill(a.status);
        const price = escapeHtml(formatMoney(a.quotedPriceCents, a.currency));
        const notes = a.notes ? escapeHtml(String(a.notes)) : "—";

        const can = canModify(a);
        const btnCls =
          "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";
        const btnClsDisabled =
          "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-400 cursor-not-allowed opacity-70";

        return `
          <tr>
            <td class="py-4 pr-4 text-slate-800">${when}</td>
            <td class="py-4 pr-4 text-slate-700">${svc}</td>
            <td class="py-4 pr-4">${st}</td>
            <td class="py-4 pr-4 text-slate-700">${price}</td>
            <td class="py-4 pr-4 text-slate-600 max-w-[360px] truncate" title="${escapeHtml(notes)}">${notes}</td>
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

  // Applica i filtri lato client alla lista già recuperata dal backend.
  // Il backend limita l’intervallo temporale; qui si aggiungono filtro per stato e ricerca testuale.
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

  // Naviga alla pagina di dettaglio dell’appuntamento selezionato.
  function detailsNav(appointmentId) {
    window.location.href = `./appointment-detail.html?appointmentId=${encodeURIComponent(String(appointmentId))}`;
  }

  // Apre il modale di annullamento dell’appuntamento.
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

    // Utility locale del modale per mostrare o nascondere errori contestuali.
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
              await apiJson("POST", `${API_APPOINTMENTS}/${encodeURIComponent(String(appt.id))}/cancel`, { reason });
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

  // Costruisce il markup degli slot disponibili mostrati nel modale di ripianificazione.
  function buildSlotsHtml(slots, selectedId) {
    const list = Array.isArray(slots) ? slots : [];
    if (!list.length) {
      return `<div class="text-sm text-slate-600">Nessuna disponibilità trovata per l’intervallo selezionato.</div>`;
    }

    // Raggruppamento per giorno per rendere la scelta più leggibile.
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

  // Apre il modale di ripianificazione dell’appuntamento.
  async function openRescheduleModal(appt, onDone) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    // Default: da domani a due settimane successive.
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

    const fromDefault = toLocalDateInputValue(start);
    const toDefault = toLocalDateInputValue(end);

    // Stato locale del modale di ripianificazione.
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

    // Utility locale del modale per mostrare o nascondere errori contestuali.
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

    // Recupera dal backend gli slot disponibili per lo stesso clinico dell’appuntamento corrente.
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
        setErr("L’intervallo di date non è valido.");
        return;
      }

      try {
        const url =
          `${API_AVAILABILITY}?clinicianUserId=${encodeURIComponent(String(appt.clinicianUserId))}` +
          `&fromUtc=${encodeURIComponent(range.fromUtc)}&toUtc=${encodeURIComponent(range.toUtc)}`;

        const data = await apiJson("GET", url);

        const now2 = new Date();
        const raw = Array.isArray(data) ? data : [];

        // Vengono mantenuti soltanto gli slot futuri e diversi dallo slot corrente.
        slots = raw.filter((s) => {
          const start = new Date(s.startUtc);
          if (!Number.isFinite(start.getTime())) return false;
          if (start <= now2) return false;
          if (String(s.id) === String(appt.slotId)) return false;
          return true;
        });

        selectedSlotId = null;

        const host = document.getElementById("rsHost");
        if (host) host.innerHTML = buildSlotsHtml(slots, selectedSlotId);
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
          label: "Conferma",
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
              await apiJson(
                "POST",
                `${API_APPOINTMENTS}/${encodeURIComponent(String(appt.id))}/reschedule`,
                { newSlotId: selectedSlotId, reason, notes }
              );

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

    // Collegamento del pulsante di ricerca disponibilità del modale.
    const btn = document.getElementById("btnRsSearch");
    if (btn) btn.addEventListener("click", refreshSlots);

    // Gestione della selezione di uno slot dentro il modale.
    const host = document.getElementById("rsHost");
    if (host) {
      host.addEventListener("click", (ev) => {
        const b = ev.target?.closest?.("button[data-slot-id]");
        if (!b) return;

        const slotId = b.getAttribute("data-slot-id");
        if (!slotId) return;

        const found = slots.find((s) => String(s.id) === String(slotId));
        if (!found) return;

        selectedSlotId = String(found.id);

        // Ulteriore protezione lato client contro slot nel frattempo non più validi.
        const now3 = new Date();
        if (new Date(found.startUtc) <= now3) {
          APL.utils.toast("L’orario selezionato non è più disponibile.", "error");
          selectedSlotId = null;
        }

        host.innerHTML = buildSlotsHtml(slots, selectedSlotId);
      });
    }
  }

  // Dataset completo degli appuntamenti recuperati dal backend.
  let _allAppointments = [];

  // Timer debounce per il filtro testuale lato client.
  let _debounce = null;

  // Carica gli appuntamenti del paziente nell’intervallo attualmente selezionato.
  async function loadAppointments() {
    clearError();
    setLoading(true);

    try {
      const rr = readRangeOrDefault();
      const url = `${API_APPOINTMENTS}?fromUtc=${encodeURIComponent(rr.fromUtc)}&toUtc=${encodeURIComponent(rr.toUtc)}`;
      const data = await apiJson("GET", url);

      _allAppointments = Array.isArray(data) ? data : [];

      const filtered = filterClientSide(_allAppointments);
      renderRows(filtered);
    } catch (err) {
      console.error(err);
      _allAppointments = [];
      renderRows([]);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare gli appuntamenti.");
    } finally {
      setLoading(false);
    }
  }

  // Ricalcola il risultato visibile applicando i filtri client-side al dataset già caricato.
  function reRender() {
    const filtered = filterClientSide(_allAppointments);
    renderRows(filtered);
  }

  // Ricerca un appuntamento nel dataset locale in base all’identificativo.
  function findById(id) {
    return _allAppointments.find((x) => String(x.id) === String(id)) || null;
  }

  // Collega le azioni della tabella appuntamenti tramite event delegation.
  function wireActions() {
    const tbody = $("appointmentsTbody");
    if (!tbody) return;

    tbody.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-action][data-id]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      const appt = findById(id);
      if (!appt) return;

      if (action === "details") {
        detailsNav(appt.id);
        return;
      }

      if (action === "cancel") {
        await openCancelModal(appt, loadAppointments);
        return;
      }

      if (action === "reschedule") {
        await openRescheduleModal(appt, loadAppointments);
        return;
      }
    });
  }

  // Collega i controlli statici della pagina ai relativi comportamenti applicativi.
  function initControls() {
    const btnRefresh = $("btnRefresh");
    const btnNext30 = $("btnNext30");
    const btnLast30 = $("btnLast30");
    const btnYear = $("btnYear");
    const btnReset = $("btnResetFilters");

    const fromDate = $("fromDate");
    const toDate = $("toDate");
    const statusSelect = $("statusSelect");
    const searchInput = $("searchInput");

    // Refresh esplicito della lista.
    if (btnRefresh) btnRefresh.addEventListener("click", loadAppointments);

    // Intervalli rapidi predefiniti.
    if (btnNext30) btnNext30.addEventListener("click", () => { applyQuickRange("next30"); loadAppointments(); });
    if (btnLast30) btnLast30.addEventListener("click", () => { applyQuickRange("last30"); loadAppointments(); });
    if (btnYear) btnYear.addEventListener("click", () => { applyQuickRange("year"); loadAppointments(); });

    // Ripristino completo dei filtri di visualizzazione.
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        if (statusSelect) statusSelect.value = "ALL";
        if (searchInput) searchInput.value = "";
        applyQuickRange("next30");
        loadAppointments();
      });
    }

    // Modifica delle date => nuova richiesta server-side.
    if (fromDate) fromDate.addEventListener("change", loadAppointments);
    if (toDate) toDate.addEventListener("change", loadAppointments);

    // Cambio stato => filtraggio locale sul dataset già caricato.
    if (statusSelect) statusSelect.addEventListener("change", reRender);

    // Ricerca testuale con debounce e conferma immediata su Enter.
    if (searchInput) {
      searchInput.addEventListener("input", () => {
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

  // Inizializza l’intervallo predefinito della pagina sui prossimi 30 giorni.
  function initDefaultRange() {
    const fromEl = $("fromDate");
    const toEl = $("toDate");
    if (!fromEl || !toEl) return;

    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    fromEl.value = toLocalDateInputValue(now);
    toEl.value = toLocalDateInputValue(end);
  }

  // Inizializza l’intera pagina appuntamenti al caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Patient.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    try {
      initDefaultRange();
      initControls();
      wireActions();
      await ensureModalReady(10000);
      await loadAppointments();
    } catch (err) {
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la pagina.");
    }
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
