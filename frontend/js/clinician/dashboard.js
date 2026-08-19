/**
 * File: frontend/js/clinician/dashboard.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della dashboard dell’area Clinician,
 * comprendendo il caricamento dei KPI principali, la consultazione sintetica
 * dei prossimi appuntamenti e la rappresentazione immediata delle attività
 * cliniche più rilevanti per il professionista sanitario autenticato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Dashboard" del
 * clinico. Si integra con i moduli condivisi del front-end per autenticazione,
 * sessione, richieste HTTP e utilità di data, e interroga i domini Scheduling
 * e Clinical per costruire una panoramica sintetica dell’agenda e degli
 * incontri clinici recenti.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Clinician;
 * - interrogare gli endpoint necessari per recuperare agenda ed encounters;
 * - calcolare i KPI di dashboard:
 *   appuntamenti nei prossimi 7 giorni,
 *   appuntamenti nella giornata corrente,
 *   pazienti distinti programmati,
 *   incontri clinici negli ultimi 30 giorni;
 * - renderizzare l’estratto dei prossimi appuntamenti;
 * - tradurre gli stati tecnici degli appuntamenti in etichette leggibili;
 * - gestire eventuali errori di caricamento.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseApiDate`,
 *   `APL.utils.toRomeDateInputValue`, `APL.utils.romeTodayDateInputValue`
 *   e `APL.utils.addDaysToDateInput`;
 * - interagisce con gli endpoint:
 *   `/api/scheduling/clinicians/me/appointments`
 *   e `/api/clinical/clinicians/me/encounters`;
 * - aggiorna dinamicamente i placeholder DOM della dashboard clinico.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La dashboard è una vista sintetica: non governa direttamente il workflow
 * clinico completo, ma offre un accesso rapido alle informazioni chiave e
 * alle sezioni operative principali.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla dashboard clinico.
  const EXPECTED_ROLE = "Clinician";

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

  // Restituisce un badge HTML minimale per rappresentare uno stato in tabella.
  function chip(text) {
    const safe = String(text || "—");
    return `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${safe}</span>`;
  }

  // Traduce lo stato tecnico dell’appuntamento in una label leggibile lato UI.
  function mapAppointmentStatus(raw) {
    const s = String(raw || "").toUpperCase();

    if (s === "BOOKED") return "Prenotato";
    if (s === "CHECKED_IN") return "Accettato";
    if (s === "COMPLETED") return "Completato";
    if (s === "CANCELED" || s === "CANCELLED") return "Annullato";
    if (s === "NO_SHOW") return "Assente";

    return raw || "—";
  }

  // Verifica se due date ricadono nello stesso giorno nel fuso orario di Roma.
  // Questo evita errori dovuti a differenze UTC/locali nel conteggio degli appuntamenti odierni.
  function isSameRomeDay(dateA, dateB) {
    return APL.utils.toRomeDateInputValue(dateA) === APL.utils.toRomeDateInputValue(dateB);
  }

  // Renderizza l’estratto dei prossimi appuntamenti nella dashboard.
  function renderAgendaRows(items) {
    const host = $("agendaList");
    if (!host) return;

    // In assenza di dati mostra un placeholder informativo.
    if (!items.length) {
      host.innerHTML = '<div class="px-4 py-4 text-sm text-slate-600">Nessun appuntamento nei prossimi 7 giorni.</div>';
      return;
    }

    // Mostra al massimo un sottoinsieme sintetico della lista completa,
    // coerente con il ruolo di riepilogo rapido della dashboard.
    host.innerHTML = items
      .slice(0, 8)
      .map((it) => {
        const date = fmtDateTime(it.startUtc);
        const patient = it.patientDisplayName || "—";
        const service = it.serviceCode || "—";
        const status = mapAppointmentStatus(it.status);

        return `
          <div class="grid grid-cols-12 px-4 py-3 text-sm">
            <div class="col-span-4 text-slate-800">${date}</div>
            <div class="col-span-4 text-slate-700 truncate" title="${patient}">${patient}</div>
            <div class="col-span-2 text-slate-700">${service}</div>
            <div class="col-span-2 text-right">${chip(status)}</div>
          </div>
        `;
      })
      .join("");
  }

  // Carica i dati necessari alla dashboard e aggiorna i KPI e la lista agenda.
  async function loadDashboardData() {
    const now = new Date();

    // Costruisce il perimetro temporale della dashboard:
    // - agenda: da adesso fino ai prossimi 7 giorni;
    // - incontri clinici: ultimi 30 giorni fino a ora.
    const today = APL.utils.romeTodayDateInputValue();
    const to7Day = APL.utils.addDaysToDateInput(today, 7);
    const from30Day = APL.utils.addDaysToDateInput(today, -30);
    const agendaRange = APL.utils.romeDateRangeToUtc(today, to7Day);
    const encountersRange = APL.utils.romeDateRangeToUtc(from30Day, today);

    const agendaUrl = `/api/scheduling/clinicians/me/appointments?fromUtc=${encodeURIComponent(
      now.toISOString()
    )}&toUtc=${encodeURIComponent(agendaRange.toUtc)}`;

    const encountersUrl = `/api/clinical/clinicians/me/encounters?fromUtc=${encodeURIComponent(
      encountersRange.fromUtc
    )}&toUtc=${encodeURIComponent(now.toISOString())}`;

    // Esegue in parallelo i due caricamenti necessari per ridurre il tempo complessivo di attesa.
    const [agendaRes, encountersRes] = await Promise.all([
      APL.utils.requestJson(agendaUrl, { headers: { Accept: "application/json", ...APL.session.authHeader() } }),
      APL.utils.requestJson(encountersUrl, { headers: { Accept: "application/json", ...APL.session.authHeader() } }),
    ]);

    const agenda = Array.isArray(agendaRes.data) ? agendaRes.data : [];
    const encounters = Array.isArray(encountersRes.data) ? encountersRes.data : [];

    // KPI: numero totale di appuntamenti nel perimetro dei prossimi 7 giorni.
    if ($("kpiAgenda")) $("kpiAgenda").textContent = String(agenda.length);

    // KPI: numero totale di incontri clinici nel perimetro degli ultimi 30 giorni.
    if ($("kpiEncounters")) $("kpiEncounters").textContent = String(encounters.length);

    // KPI: numero di appuntamenti che ricadono nella giornata corrente del fuso di Roma.
    const todayCount = agenda.filter((it) => {
      const d = it.startUtc ? new Date(it.startUtc) : null;
      return d ? isSameRomeDay(d, now) : false;
    }).length;

    if ($("kpiToday")) $("kpiToday").textContent = String(todayCount);

    // KPI: numero di pazienti distinti nel perimetro dell’agenda.
    // Si usa l’id utente quando disponibile, altrimenti il nome come fallback.
    const patientKeys = new Set(
      agenda
        .map((it) => it.patientUserId || it.patientDisplayName || "")
        .filter((x) => String(x).trim().length > 0)
        .map((x) => String(x).trim())
    );

    if ($("kpiPatients")) $("kpiPatients").textContent = String(patientKeys.size);

    // Aggiorna l’estratto visuale dei prossimi appuntamenti.
    renderAgendaRows(agenda);
  }

  // Inizializza la dashboard del clinico al caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impedisce l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Clinician.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    try {
      // Carica tutti i dati necessari alla vista iniziale della dashboard.
      await loadDashboardData();
    } catch (err) {
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la dashboard.");
    }
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
