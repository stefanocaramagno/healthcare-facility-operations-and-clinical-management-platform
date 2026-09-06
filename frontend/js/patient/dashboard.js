/**
 * File: frontend/js/patient/dashboard.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della dashboard del paziente,
 * comprendendo il caricamento dei principali indicatori sintetici,
 * il recupero dei prossimi appuntamenti e la renderizzazione della
 * panoramica iniziale mostrata dopo l’autenticazione.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Dashboard"
 * dell’area Patient. Si integra con i moduli condivisi del front-end
 * per autenticazione, sessione, richieste HTTP e utilità di data,
 * e dialoga con i servizi di Scheduling, Notifications, Payments e
 * Registry per costruire una sintesi aggiornata delle attività del paziente.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Patient;
 * - recuperare i prossimi appuntamenti del paziente;
 * - recuperare il numero di notifiche non lette;
 * - recuperare gli intent di pagamento e calcolare quelli ancora aperti;
 * - recuperare i consensi del paziente e conteggiare quelli attivi;
 * - aggiornare i KPI mostrati nella dashboard;
 * - renderizzare l’elenco sintetico dei prossimi appuntamenti;
 * - gestire eventuali errori globali di caricamento.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.utils.requestJson` per interrogare i servizi backend;
 * - utilizza `APL.utils.parseApiDate`, `APL.utils.romeTodayDateInputValue`
 *   e `APL.utils.romeDateRangeToUtc` per il trattamento delle date;
 * - utilizza `APL.utils.addDaysToDateInput` per costruire l’intervallo
 *   temporale della vista;
 * - utilizza `APL.utils.humanizeError` per rendere più leggibili gli errori.
 *
 * Endpoint utilizzati
 * -------------------
 * - `/api/scheduling/patients/me/appointments`
 * - `/api/notifications/patients/me?onlyUnread=true`
 * - `/api/payments/patients/me/intents`
 * - `/api/registry/patients/me/consents`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La dashboard adotta un caricamento concorrente dei dati tramite `Promise.all`,
 * così da ridurre il tempo complessivo necessario a popolare la vista iniziale.
 */

(function () {
  "use strict";

  // Ruolo richiesto per accedere correttamente alla dashboard del paziente.
  const EXPECTED_ROLE = "Patient";

  // Utility locale per recuperare rapidamente un elemento DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore globale nel box dedicato della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Formattta una data/ora API in una forma leggibile per un utente italiano.
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

  // Restituisce un badge HTML minimale per rappresentare uno stato sintetico
  // all’interno della lista appuntamenti.
  function chip(text) {
    const safe = String(text || "—");
    return `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${safe}</span>`;
  }

  // Traduce gli stati tecnici del pagamento in una label più leggibile per il paziente.
  function mapPaymentStatus(raw) {
    const s = String(raw || "").toLowerCase();

    if (["succeeded", "paid", "completed", "confirmed", "success"].includes(s)) return "Pagato";
    if (["failed", "canceled", "cancelled", "error"].includes(s)) return "Non riuscito";
    if (["pending", "processing"].includes(s)) return "In elaborazione";
    if (["created", "requires_action", "requiresaction"].includes(s)) return "Da completare";

    return raw || "—";
  }

  // Traduce gli stati tecnici dell’appuntamento in una label leggibile in dashboard.
  function mapAppointmentStatus(raw) {
    const s = String(raw || "").toUpperCase();

    if (s === "BOOKED") return "Prenotato";
    if (s === "CHECKED_IN") return "Accettato";
    if (s === "COMPLETED") return "Completato";
    if (s === "CANCELED" || s === "CANCELLED") return "Annullato";
    if (s === "NO_SHOW") return "Assente";

    return raw || "—";
  }

  // Renderizza la lista sintetica dei prossimi appuntamenti nella dashboard.
  function renderAppointments(items) {
    const host = $("appointmentsList");
    if (!host) return;

    // Se non esistono appuntamenti nel periodo considerato, mostra un messaggio informativo.
    if (!items.length) {
      host.innerHTML = '<div class="px-4 py-4 text-sm text-slate-600">Nessun appuntamento nei prossimi 30 giorni.</div>';
      return;
    }

    // Mostra al massimo gli 8 appuntamenti più rilevanti già restituiti dal backend.
    host.innerHTML = items
      .slice(0, 8)
      .map((it) => {
        const when = fmtDateTime(it.startUtc);
        const service = it.serviceCode || "—";
        const status = mapAppointmentStatus(it.status);
        const pay = mapPaymentStatus(it.paymentStatus);

        return `
          <div class="grid grid-cols-12 px-4 py-3 text-sm">
            <div class="col-span-5 text-slate-800">${when}</div>
            <div class="col-span-3 text-slate-700">${service}</div>
            <div class="col-span-2">${chip(status)}</div>
            <div class="col-span-2 text-right">${chip(pay)}</div>
          </div>
        `;
      })
      .join("");
  }

  // Carica tutti i dati necessari alla dashboard del paziente e aggiorna i KPI.
  async function loadDashboardData() {
    const now = new Date();

    // La dashboard considera i prossimi 30 giorni a partire dalla data corrente.
    const today = APL.utils.romeTodayDateInputValue();
    const endDay = APL.utils.addDaysToDateInput(today, 30);
    const range30 = APL.utils.romeDateRangeToUtc(today, endDay);

    // L’intervallo per gli appuntamenti parte dal momento corrente per evitare
    // di includere appuntamenti passati nella vista "prossimi".
    const appointmentsUrl = `/api/scheduling/patients/me/appointments?fromUtc=${encodeURIComponent(
      now.toISOString()
    )}&toUtc=${encodeURIComponent(range30.toUtc)}`;

    // I diversi dataset della dashboard vengono caricati in parallelo per ridurre la latenza complessiva.
    const [appointmentsRes, unreadRes, intentsRes, consentsRes] = await Promise.all([
      APL.utils.requestJson(appointmentsUrl, { headers: { Accept: "application/json", ...APL.session.authHeader() } }),
      APL.utils.requestJson("/api/notifications/patients/me?onlyUnread=true", {
        headers: { Accept: "application/json", ...APL.session.authHeader() },
      }),
      APL.utils.requestJson("/api/payments/patients/me/intents", {
        headers: { Accept: "application/json", ...APL.session.authHeader() },
      }),
      APL.utils.requestJson("/api/registry/patients/me/consents", {
        headers: { Accept: "application/json", ...APL.session.authHeader() },
      }),
    ]);

    // Normalizza i payload in array, proteggendosi da eventuali risposte vuote o inattese.
    const appointments = Array.isArray(appointmentsRes.data) ? appointmentsRes.data : [];
    const unread = Array.isArray(unreadRes.data) ? unreadRes.data : [];
    const intents = Array.isArray(intentsRes.data) ? intentsRes.data : [];
    const consents = Array.isArray(consentsRes.data) ? consentsRes.data : [];

    // KPI: numero di appuntamenti visibili nel periodo considerato.
    if ($("kpiAppointments")) $("kpiAppointments").textContent = String(appointments.length);

    // KPI: numero di notifiche non ancora lette dal paziente.
    if ($("kpiUnread")) $("kpiUnread").textContent = String(unread.length);

    // KPI: pagamenti ancora non completamente chiusi.
    // Sono considerati pendenti sia quelli in attesa sia quelli che richiedono azione o hanno avuto esito negativo.
    const pendingPayments = intents.filter((i) => {
      const s = String(i.status || "").toLowerCase();
      return ["created", "pending", "processing", "requires_action", "failed"].includes(s);
    });
    if ($("kpiPendingPayments")) $("kpiPendingPayments").textContent = String(pendingPayments.length);

    // KPI: consensi attualmente concessi dal paziente.
    const activeConsents = consents.filter((c) => String(c.status || "").toLowerCase() === "granted");
    if ($("kpiConsents")) $("kpiConsents").textContent = String(activeConsents.length);

    // Aggiorna la sezione con l’estratto dei prossimi appuntamenti.
    renderAppointments(appointments);
  }

  // Inizializza la dashboard del paziente al caricamento del DOM.
  async function init() {
    // Verifica la disponibilità dei moduli applicativi condivisi.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Patient.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    try {
      await loadDashboardData();
    } catch (err) {
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la dashboard.");
    }
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
