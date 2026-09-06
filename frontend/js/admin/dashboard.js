/**
 * File: frontend/js/admin/dashboard.js
 *
 * Scopo
 * -----
 * Gestire il caricamento e l’aggiornamento della dashboard amministrativa,
 * recuperando i principali indicatori sintetici, i riepiloghi operativi recenti
 * e gli eventuali messaggi di errore mostrati nella pagina.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della dashboard Admin.
 * Si integra con i moduli condivisi del front-end per verificare il ruolo
 * dell’utente autenticato, interrogare gli endpoint protetti e popolare
 * dinamicamente i KPI e i riquadri informativi della pagina.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - caricare i dati necessari agli indicatori della dashboard;
 * - calcolare i riepiloghi degli ultimi 30 giorni;
 * - distinguere pagamenti confermati, pagamenti gestibili e notifiche pendenti;
 * - aggiornare i riquadri KPI e le aree testuali della pagina;
 * - mostrare un messaggio di errore in caso di problemi di caricamento.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.requestJson`, `APL.utils.romeTodayDateInputValue`,
 *   `APL.utils.addDaysToDateInput`, `APL.utils.romeDateRangeToUtc`
 *   e `APL.utils.humanizeError`;
 * - interagisce con gli endpoint:
 *   `/api/catalog/admin/services`,
 *   `/api/payments/admin/intents`,
 *   `/api/notifications/admin`;
 * - aggiorna dinamicamente il DOM della dashboard amministrativa.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La dashboard lavora su una finestra temporale di 30 giorni per i dati di
 * pagamenti e notifiche, mentre il catalogo prestazioni viene interrogato
 * includendo anche gli elementi non attivi.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere e utilizzare correttamente questa dashboard.
  const EXPECTED_ROLE = "Admin";

  // Restituisce un elemento DOM tramite il suo id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel contenitore dedicato della pagina.
  function showError(message) {
    // Recupera il box errori della dashboard.
    const box = $("pageError");
    if (!box) return;

    // Inserisce il messaggio e rende visibile il contenitore.
    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Converte un importo espresso in centesimi in una stringa leggibile con valuta.
  function formatMoney(cents, currency) {
    // Porta il valore da centesimi a unità monetaria e lo formatta con due decimali.
    const value = (Number(cents || 0) / 100).toFixed(2);

    // Restituisce l’importo con valuta, usando EUR come fallback.
    return `${value} ${currency || "EUR"}`;
  }

  // Verifica se uno stato di pagamento può essere considerato confermato/concluso.
  function isConfirmedPaymentStatus(raw) {
    // Normalizza lo stato per confronti case-insensitive.
    const s = String(raw || "").toLowerCase();

    // Riconosce come confermati gli stati tipici di pagamento completato.
    return ["succeeded", "paid", "completed", "confirmed", "success"].includes(s);
  }

  // Verifica se uno stato di pagamento richiede ancora gestione operativa.
  function isActionablePaymentStatus(raw) {
    // Normalizza lo stato per confronti case-insensitive.
    const s = String(raw || "").toLowerCase();

    // Riconosce come gestibili gli stati non ancora definitivamente chiusi.
    return ["created", "pending", "processing", "requires_action", "failed"].includes(s);
  }

  // Verifica se una notifica è ancora in stato pendente o preparatorio.
  function isPendingNotificationStatus(raw) {
    // Normalizza lo stato per confronti case-insensitive.
    const s = String(raw || "").toLowerCase();

    // Considera pendenti gli stati tipici di preparazione o coda.
    return ["pending", "queued", "draft"].includes(s);
  }

  // Carica tutti i KPI e i riepiloghi operativi della dashboard.
  async function loadKpis() {
    // Recupera l’istante corrente e la data odierna nel fuso di Roma.
    const now = new Date();
    const today = APL.utils.romeTodayDateInputValue();

    // Calcola la data iniziale della finestra di osservazione di 30 giorni.
    const startDay = APL.utils.addDaysToDateInput(today, -30);

    // Converte il range locale in estremi UTC utilizzabili negli endpoint.
    const range30d = APL.utils.romeDateRangeToUtc(startDay, today);

    // Costruisce la query string condivisa per i dati recenti.
    const qs30d = `fromUtc=${encodeURIComponent(range30d.fromUtc)}&toUtc=${encodeURIComponent(now.toISOString())}`;

    // Interroga in parallelo catalogo prestazioni, intenti di pagamento e notifiche.
    const [servicesRes, paymentsRes, notificationsRes] = await Promise.all([
      APL.utils.requestJson("/api/catalog/admin/services?includeInactive=true", {
        headers: { Accept: "application/json", ...APL.session.authHeader() },
      }),
      APL.utils.requestJson(`/api/payments/admin/intents?${qs30d}`, {
        headers: { Accept: "application/json", ...APL.session.authHeader() },
      }),
      APL.utils.requestJson(`/api/notifications/admin?${qs30d}`, {
        headers: { Accept: "application/json", ...APL.session.authHeader() },
      }),
    ]);

    // Estrae l’elenco delle prestazioni dal payload, usando un array vuoto come fallback.
    const services = Array.isArray(servicesRes.data) ? servicesRes.data : [];

    // Aggiorna il KPI relativo al numero totale di prestazioni presenti a catalogo.
    if ($("kpiServices")) $("kpiServices").textContent = String(services.length);

    // Estrae l’elenco degli intenti di pagamento dal payload.
    const intents = Array.isArray(paymentsRes.data) ? paymentsRes.data : [];

    // Filtra i pagamenti che richiedono ancora gestione operativa.
    const actionable = intents.filter((i) => isActionablePaymentStatus(i.status));

    // Aggiorna il KPI dei pagamenti da gestire.
    if ($("kpiPayments")) $("kpiPayments").textContent = String(actionable.length);

    // Filtra i pagamenti confermati per calcolare il totale incassato.
    const confirmed = intents.filter((i) => isConfirmedPaymentStatus(i.status));

    // Somma gli importi confermati espressi in centesimi.
    const revenueCents = confirmed.reduce((sum, p) => sum + Number(p.amountCents || 0), 0);

    // Aggiorna il KPI degli incassi confermati negli ultimi 30 giorni.
    if ($("kpiRevenue")) $("kpiRevenue").textContent = formatMoney(revenueCents, confirmed[0]?.currency || "EUR");

    // Estrae l’elenco delle notifiche dal payload.
    const notifications = Array.isArray(notificationsRes.data) ? notificationsRes.data : [];

    // Filtra le notifiche ancora pendenti o in preparazione.
    const pending = notifications.filter((n) => isPendingNotificationStatus(n.status));

    // Aggiorna il KPI delle notifiche in preparazione.
    if ($("kpiNotifications")) $("kpiNotifications").textContent = String(pending.length);

    // Costruisce il riepilogo testuale delle notifiche recenti da mostrare nella dashboard.
    const recentNotifText = pending
      .slice(0, 3)
      .map((n) => `• ${n.subject || "Notifica"}`)
      .join("\n");

    // Aggiorna il riquadro delle notifiche recenti, con fallback descrittivo in assenza di dati.
    if ($("recentNotifications")) {
      $("recentNotifications").textContent =
        recentNotifText || "Nessuna notifica in preparazione negli ultimi 30 giorni.";
    }

    // Costruisce il riepilogo testuale dei pagamenti ancora da gestire.
    const recentPayText = actionable
      .slice(0, 3)
      .map((p) => `• ${formatMoney(p.amountCents, p.currency)} · ${String(p.status || "Da gestire")}`)
      .join("\n");

    // Aggiorna il riquadro dei pagamenti recenti, con fallback descrittivo in assenza di dati.
    if ($("recentPayments")) {
      $("recentPayments").textContent = recentPayText || "Nessun pagamento da gestire negli ultimi 30 giorni.";
    }
  }

  // Inizializza la dashboard verificando autorizzazione e caricando i dati necessari.
  async function init() {
    // Verifica che i moduli condivisi richiesti siano effettivamente disponibili.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Richiede una sessione valida con ruolo Admin.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    try {
      // Carica i KPI e i riepiloghi della dashboard.
      await loadKpis();
    } catch (err) {
      // Registra l’errore in console per il debug tecnico.
      console.error(err);

      // Mostra un messaggio leggibile all’utente nella pagina.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la dashboard.");
    }
  }

  // Avvia l’inizializzazione della dashboard quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
