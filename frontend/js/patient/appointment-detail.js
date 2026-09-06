/**
 * File: frontend/js/patient/appointment-detail.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina di dettaglio di un singolo
 * appuntamento dell’area Patient, occupandosi del caricamento dei dati,
 * dell’aggiornamento della UI, della valutazione delle azioni consentite e dei
 * flussi operativi di annullamento e ripianificazione.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `appointment-detail.html`. Coordina l’interazione tra interfaccia utente,
 * servizi API dell’area scheduling e componenti condivisi dell’applicazione,
 * traducendo i dati della prenotazione in elementi visuali leggibili e
 * permettendo al paziente di compiere solo le operazioni compatibili con lo
 * stato corrente dell’appuntamento.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Patient;
 * - leggere l’identificativo dell’appuntamento dalla query string;
 * - recuperare dal backend i dettagli della prenotazione richiesta;
 * - mostrare dati principali, stato dell’appuntamento e stato del pagamento;
 * - determinare se annullamento e ripianificazione sono consentiti;
 * - gestire il modale di annullamento con eventuale motivo opzionale;
 * - gestire il modale di ripianificazione con ricerca e selezione di nuovi slot;
 * - aggiornare la pagina dopo le operazioni che modificano l’appuntamento;
 * - gestire loading globale, errori pagina, toast e modali.
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
 * - utilizza `APL.ui.modal.open()` per i flussi modali;
 * - interagisce con gli endpoint:
 *   - `/api/scheduling/patients/me/appointments`
 *   - `/api/scheduling/patients/me/availability`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. La logica è strutturata in utilità di presentazione, helper
 * per le API, funzioni di rendering e flussi operativi specifici della pagina.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Patient";

  // Endpoint per il recupero e la gestione degli appuntamenti del paziente autenticato.
  const API_APPOINTMENTS = "/api/scheduling/patients/me/appointments";

  // Endpoint per il recupero delle disponibilità durante la ripianificazione.
  const API_AVAILABILITY = "/api/scheduling/patients/me/availability";

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel box globale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;
    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Ripristina lo stato normale della pagina nascondendo l’eventuale errore globale.
  function clearError() {
    const box = $("pageError");
    if (!box) return;
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna lo stato di caricamento globale della vista tramite badge dedicato.
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

  // Formatta una data UTC in una rappresentazione estesa leggibile per l’utente.
  function fmtDateTime(isoUtc) {
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

  // Converte un importo espresso in centesimi in una stringa monetaria leggibile.
  function formatMoney(cents, currency) {
    const value = (Number(cents || 0) / 100).toFixed(2);
    return `${value} ${currency || "EUR"}`;
  }

  // Normalizza la rappresentazione dello stato per confronti coerenti lato client.
  function normalizeStatus(raw) {
    return String(raw || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
  }

  // Traduce lo stato tecnico dell’appuntamento in una label utente e in un tono grafico.
  function mapStatus(raw) {
    const s = normalizeStatus(raw);
    if (s === "BOOKED") return { label: "Prenotato", tone: "blue" };
    if (s === "CHECKED_IN") return { label: "Accettato", tone: "amber" };
    if (s === "COMPLETED") return { label: "Completato", tone: "emerald" };
    if (s === "CANCELED" || s === "CANCELLED") return { label: "Annullato", tone: "slate" };
    if (s === "NO_SHOW") return { label: "Assente", tone: "slate" };
    return { label: raw || "—", tone: "slate" };
  }

  // Costruisce la pill HTML che rappresenta visivamente lo stato dell’appuntamento.
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

  // Costruisce la pill HTML che sintetizza lo stato del pagamento associato.
  function paymentPill(appt) {
    const raw =
      appt?.paymentStatus ??
      appt?.paymentState ??
      (typeof appt?.isPaid === "boolean" ? (appt.isPaid ? "PAID" : "PENDING") : "");

    const s = String(raw || "").toUpperCase();

    if (s === "PAID" || s === "COMPLETED" || s === "SETTLED") {
      return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-700">Pagato</span>`;
    }

    if (s === "PENDING" || s === "REQUIRES_ACTION" || s === "OPEN") {
      return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-amber-50 text-amber-800">Pagamento da completare</span>`;
    }

    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-slate-100 text-slate-700">Pagamento</span>`;
  }

  // Attende che il sistema modale condiviso sia disponibile prima di usarlo.
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
      // Sessione non più valida: pulizia locale e redirect alla schermata dedicata.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Accesso vietato: redirect alla schermata di forbidden se disponibile.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Altri errori: costruzione di un oggetto Error arricchito con metadati utili.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Estrae dalla query string l’identificativo dell’appuntamento da caricare.
  function readAppointmentId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("appointmentId");
    return v ? String(v) : null;
  }

  // Determina se l’appuntamento è ancora modificabile lato patient.
  // La regola applicata è: appuntamento in stato BOOKED e collocato nel futuro.
  function canModify(appt) {
    const status = normalizeStatus(appt?.status);
    if (status !== "BOOKED") return false;
    const start = new Date(appt.startUtc);
    return Number.isFinite(start.getTime()) && start > new Date();
  }

  // Abilita o disabilita i pulsanti di gestione e aggiorna il box descrittivo
  // delle regole applicate all’appuntamento corrente.
  function setActionsEnabled(appt) {
    const resBtn = $("btnReschedule");
    const canBtn = $("btnCancel");
    const rules = $("rulesBox");

    const enabled = canModify(appt);

    if (resBtn) resBtn.disabled = !enabled;
    if (canBtn) canBtn.disabled = !enabled;

    if (!rules) return;

    if (enabled) {
      rules.textContent = "È possibile ripianificare o annullare l’appuntamento fino a prima dell’orario previsto.";
    } else {
      const label = mapStatus(appt?.status).label || "—";
      rules.textContent = `Non sono disponibili modifiche per l’appuntamento in stato “${label}”.`;
    }
  }

  // Aggiorna il link alla pagina di pre-triage/pre-visita associandolo all’appuntamento corrente.
  function setPreVisitLink(apptId) {
    const a = $("btnPreVisit");
    if (!a) return;
    a.href = `./pretriage.html?appointmentId=${encodeURIComponent(String(apptId))}`;
  }

  // Aggiorna il link ai pagamenti includendo l’identificativo dell’appuntamento corrente.
  function setPaymentsLink(apptId) {
    const a = $("btnPayments");
    if (!a) return;
    a.href = `./payments.html?appointmentId=${encodeURIComponent(String(apptId))}`;
  }

  // Popola l’interfaccia della pagina con i dati dell’appuntamento recuperato.
  function render(appt) {
    // Riferimento univoco dell’appuntamento.
    if ($("apptRef")) $("apptRef").textContent = appt?.id ? String(appt.id) : "—";

    // Nome e codice della prestazione.
    const name = appt?.serviceName || appt?.serviceCode || "Prestazione";
    const code = appt?.serviceCode ? `Codice: ${appt.serviceCode}` : "Codice: —";

    if ($("svcName")) $("svcName").textContent = String(name);
    if ($("svcCode")) $("svcCode").textContent = String(code);

    // Stato dell’appuntamento e stato del pagamento.
    if ($("statusPill")) $("statusPill").innerHTML = statusPill(appt?.status);
    if ($("paymentPill")) $("paymentPill").innerHTML = paymentPill(appt);

    // Data/ora dell’appuntamento e relativo hint contestuale.
    if ($("whenText")) $("whenText").textContent = fmtDateTime(appt?.startUtc);
    if ($("whenHint")) {
      const d = appt?.startUtc ? new Date(appt.startUtc) : null;
      const now = new Date();
      if (d && Number.isFinite(d.getTime())) {
        $("whenHint").textContent = d > now ? "Appuntamento in programma." : "Appuntamento passato o in corso.";
      } else {
        $("whenHint").textContent = "—";
      }
    }

    // Prezzo quotato o, in fallback, eventuale altro prezzo disponibile.
    const cents = appt?.quotedPriceCents ?? appt?.priceCents ?? 0;
    const cur = appt?.currency || "EUR";
    if ($("priceText")) $("priceText").textContent = formatMoney(cents, cur);

    // Note associate all’appuntamento.
    const notes = appt?.notes ? String(appt.notes) : "Nessuna nota associata.";
    if ($("notesText")) $("notesText").textContent = notes;

    // Aggiornamento dei pulsanti e dei link contestuali.
    setActionsEnabled(appt);
    if (appt?.id) {
      setPreVisitLink(appt.id);
      setPaymentsLink(appt.id);
    }
  }

  // Genera il markup HTML degli slot disponibili per il modale di ripianificazione.
  function slotsHtml(slots, selectedId) {
    const list = Array.isArray(slots) ? slots : [];
    if (!list.length) {
      return `<div class="text-sm text-slate-600">Nessuna disponibilità trovata per l’intervallo selezionato.</div>`;
    }

    // Raggruppamento per giorno per una presentazione più leggibile.
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
            <span class="font-medium">${escapeHtml(appt.serviceName || appt.serviceCode || "Prestazione")}</span>
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

    // Helper locale del modale per la visualizzazione di errori contestuali.
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

  // Apre il modale di ripianificazione dell’appuntamento.
  async function openRescheduleModal(appt, onDone) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    // Intervallo iniziale predefinito: da domani a due settimane.
    const now = new Date();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Conversione locale in formato compatibile con input[type="date"].
    const toLocal = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    const fromDefault = toLocal(start);
    const toDefault = toLocal(end);

    // Stato locale del modale: lista slot trovati e slot attualmente selezionato.
    let slots = [];
    let selectedSlotId = null;

    const bodyHtml = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Appuntamento attuale</div>
          <div class="mt-1 text-sm text-slate-800">
            <span class="font-medium">${escapeHtml(appt.serviceName || appt.serviceCode || "Prestazione")}</span>
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

    // Helper locale del modale per mostrare errori contestuali.
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

    // Effettua la ricerca delle disponibilità sul range selezionato nel modale.
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
        const url =
          `${API_AVAILABILITY}?fromUtc=${encodeURIComponent(range.fromUtc)}` +
          `&toUtc=${encodeURIComponent(range.toUtc)}`;

        const data = await apiJson("GET", url);

        const now2 = new Date();
        const raw = Array.isArray(data) ? data : [];

        // Mantiene soltanto slot futuri e diversi da quello attualmente associato.
        slots = raw.filter((s) => {
          const start2 = new Date(s.startUtc);
          if (!Number.isFinite(start2.getTime())) return false;
          if (start2 <= now2) return false;
          if (appt.slotId && String(s.id) === String(appt.slotId)) return false;
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

    // Collega la ricerca disponibilità al pulsante dedicato nel modale.
    const btn = document.getElementById("btnRsSearch");
    if (btn) btn.addEventListener("click", refreshSlots);

    // Collega la selezione dello slot al contenitore degli slot renderizzati.
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

  // Recupera l’appuntamento desiderato effettuando una ricerca ampia
  // su un intervallo temporale esteso attorno alla data corrente.
  async function fetchAppointmentById(id) {
    const now = new Date();
    const from = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const url =
      `${API_APPOINTMENTS}?fromUtc=${encodeURIComponent(from.toISOString())}` +
      `&toUtc=${encodeURIComponent(to.toISOString())}`;

    const data = await apiJson("GET", url);
    const list = Array.isArray(data) ? data : [];
    return list.find((x) => String(x.id) === String(id)) || null;
  }

  // Collega i pulsanti di gestione appuntamento ai rispettivi flussi modali.
  function wireActions(getAppt, reloadFn) {
    const btnRes = $("btnReschedule");
    const btnCan = $("btnCancel");

    if (btnRes) {
      btnRes.addEventListener("click", async () => {
        const appt = getAppt();
        if (!appt || !canModify(appt)) return;
        await openRescheduleModal(appt, reloadFn);
      });
    }

    if (btnCan) {
      btnCan.addEventListener("click", async () => {
        const appt = getAppt();
        if (!appt || !canModify(appt)) return;
        await openCancelModal(appt, reloadFn);
      });
    }
  }

  // Inizializza la pagina di dettaglio appuntamento.
  async function init() {
    // Verifica disponibilità dei moduli condivisi necessari al funzionamento della pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Verifica autenticazione e ruolo richiesto.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Lettura dell’identificativo dell’appuntamento dalla query string.
    const appointmentId = readAppointmentId();
    if (!appointmentId) {
      showError("Impossibile visualizzare l’appuntamento. Riapra la pagina dall’elenco appuntamenti.");
      return;
    }

    // Stato locale dell’appuntamento corrente visualizzato in pagina.
    let currentAppt = null;

    try {
      setLoading(true);
      await ensureModalReady(10000);

      // Funzione interna di caricamento/ricaricamento dei dati della pagina.
      const load = async () => {
        clearError();
        setLoading(true);

        try {
          const appt = await fetchAppointmentById(appointmentId);
          currentAppt = appt;

          // Se l’appuntamento richiesto non è reperibile, mostra un errore utente.
          if (!appt) {
            showError("Appuntamento non trovato. Verifichi l’elenco appuntamenti.");
            setLoading(false);
            return null;
          }

          // Rendering completo della UI con i dati recuperati.
          render(appt);
          setLoading(false);
          return appt;
        } catch (err) {
          console.error(err);
          showError(APL.utils.humanizeError(err) || "Impossibile caricare i dettagli dell’appuntamento.");
          setLoading(false);
          return null;
        }
      };

      // Primo caricamento della pagina.
      const appt = await load();
      if (!appt) return;

      // Collegamento delle azioni solo dopo aver verificato che l’appuntamento esista.
      wireActions(
        () => currentAppt,
        async () => {
          const updated = await load();
          if (updated) render(updated);
        }
      );
    } catch (err) {
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la pagina.");
    } finally {
      setLoading(false);
    }
  }

  // Avvio dell’inizializzazione al completamento del parsing del DOM.
  document.addEventListener("DOMContentLoaded", init);
})();
