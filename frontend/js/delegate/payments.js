/**
 * File: frontend/js/delegate/payments.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina pagamenti dell’area
 * Delegate, comprendendo il caricamento delle deleghe disponibili,
 * la selezione dell’assistito, il recupero di appuntamenti e payment intent,
 * l’applicazione dei filtri, la costruzione del riepilogo di pagamento,
 * l’avvio del pagamento in-app e la gestione delle azioni disponibili
 * sulle operazioni registrate nel perimetro della delega selezionata.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `payments.html` dell’area Delegate. Coordina l’interazione tra
 * interfaccia utente, servizi API delle aree registry, scheduling e payments
 * e componenti condivisi dell’applicazione, traducendo i dati di delega,
 * appuntamenti e operazioni economiche in una UI consultabile e operativa
 * per il delegato autorizzato.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Delegate;
 * - recuperare le deleghe del delegato autenticato;
 * - consentire la selezione dell’assistito nel perimetro delle deleghe disponibili;
 * - recuperare appuntamenti e payment intent dell’assistito selezionato;
 * - applicare filtri per intervallo temporale, stato e ricerca testuale;
 * - aggiornare le statistiche sintetiche mostrate nella pagina;
 * - popolare la select delle prestazioni pagabili;
 * - costruire il riepilogo della prestazione selezionata;
 * - verificare se la delega corrente consente la gestione dei pagamenti;
 * - consentire l’avvio del pagamento in-app per una prestazione;
 * - consentire il riavvio di un intent fallito o ancora creato;
 * - mostrare i dettagli dell’operazione in modale;
 * - generare una ricevuta testuale scaricabile;
 * - gestire loading, errori globali, stato vuoto e feedback all’utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.session.clearAuth()` nei casi di sessione scaduta;
 * - utilizza `APL.utils.requestJson()` come base per le chiamate API;
 * - utilizza `APL.utils.parseErrorMessage()` e `APL.utils.humanizeError()`
 *   per normalizzare i messaggi di errore;
 * - utilizza `APL.utils.setLoading()` per aggiornare lo stato visuale del pulsante refresh;
 * - utilizza `APL.utils.toast()` per il feedback all’utente;
 * - utilizza utility temporali come `APL.utils.toRomeDateInputValue()`,
 *   `APL.utils.parseApiDate()`, `APL.utils.romeTodayDateInputValue()`,
 *   `APL.utils.addDaysToDateInput()` e `APL.utils.romeDateRangeToUtc()`;
 * - utilizza `APL.ui.modal.open()` per conferme e dettaglio operazioni;
 * - interagisce con gli endpoint:
 *   - `/api/registry/delegates/me/delegations`
 *   - `/api/scheduling/delegates/me/appointments`
 *   - `/api/payments/delegates/me/intents`
 *   - `/api/payments/delegates/me/appointments`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. La pagina mantiene uno stato client-side con deleghe,
 * appuntamenti, payment intent e mappe di lookup per supportare filtro locale,
 * rendering tabellare, riepilogo della prestazione selezionata, verifica dei
 * permessi della delega e azioni rapide senza dover ricostruire continuamente
 * il dataset lato client.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Delegate";

  // Endpoint per il recupero delle deleghe del delegato autenticato.
  const API_DELEGATIONS = "/api/registry/delegates/me/delegations";

  // Endpoint per il recupero degli appuntamenti dell’assistito selezionato.
  const API_APPOINTMENTS = "/api/scheduling/delegates/me/appointments";

  // Endpoint per il recupero dello storico dei payment intent nel contesto delegato.
  const API_INTENTS = "/api/payments/delegates/me/intents";

  // Endpoint base per la creazione di un nuovo intent associato a un appuntamento.
  const API_CREATE_INTENT = "/api/payments/delegates/me/appointments";

  // Endpoint base per l’avvio o il riavvio dell’elaborazione di un intent esistente.
  const API_PROCESS_INTENT = "/api/payments/delegates/me/intents";

  // Stato locale della pagina usato per conservare deleghe, dataset correnti,
  // sottoinsieme filtrato e mappe di lookup rapido per appuntamenti e payment intent.
  const state = {
    delegations: [],
    selectedDelegation: null,
    selectedPatientUserId: "",
    selectedAppointmentIdFromQuery: "",

    appointments: [],
    intents: [],
    shownIntents: [],
    apptById: new Map(),
    intentById: new Map(),
    latestIntentByAppt: new Map(),
  };

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
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

  // Mostra un messaggio di errore nel box globale della pagina.
  function showError(message) {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");

    // In assenza del nodo DOM non è possibile mostrare il messaggio.
    if (!box) return;

    // Scrive il testo di errore usando un fallback di sicurezza.
    box.textContent = message || "Errore imprevisto.";

    // Rende visibile il contenitore.
    box.classList.remove("hidden");
  }

  // Ripristina lo stato normale della pagina nascondendo l’eventuale errore globale.
  function clearError() {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");

    // Se il box non esiste non c’è nulla da resettare.
    if (!box) return;

    // Pulisce il testo precedentemente mostrato.
    box.textContent = "";

    // Nasconde nuovamente il contenitore.
    box.classList.add("hidden");
  }

  // Mostra o nasconde lo stato vuoto della pagina in base alla presenza di risultati.
  function emptyState(show) {
    // Recupera il pannello predisposto per lo stato vuoto.
    const box = $("emptyState");

    // Alterna la visibilità in base al valore richiesto.
    if (box) box.classList.toggle("hidden", !show);
  }

  // Aggiorna lo stato di caricamento della vista.
  // Oltre al badge, blocca temporaneamente i controlli che alterano il filtro,
  // il dataset visualizzato, la selezione dell’assistito o l’avvio di nuove operazioni.
  function setLoading(loading) {
    // Mostra o nasconde il badge globale di caricamento della pagina.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Aggiorna il pulsante di refresh con lo stato visuale di loading condiviso.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

    // Elenco dei controlli che devono essere temporaneamente disabilitati
    // per evitare richieste concorrenti o modifiche incoerenti della UI.
    const ids = [
      "patientSelect",
      "btnReloadDelegations",
      "fromDate",
      "toDate",
      "statusSelect",
      "searchInput",
      "btnLast90",
      "btnLast365",
      "btnAll",
      "btnResetFilters",
      "btnEmptyReset",
      "appointmentSelect",
      "btnPayNow",
    ];

    // Applica lo stato disabled a tutti i controlli effettivamente presenti.
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Converte una data nel formato richiesto dagli input HTML usando il fuso di Roma.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formatta una data API in rappresentazione breve per tabella e riferimenti sintetici.
  function fmtDate(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard di pagina.
    if (!isoUtc) return "—";

    // Prova a convertire il valore API in oggetto Date tramite utility condivisa.
    const d = APL.utils.parseApiDate(isoUtc);

    // Se il parsing fallisce mantiene il placeholder.
    if (!d) return "—";

    // Restituisce la data in formato italiano compatto.
    return d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  // Formatta una data API in rappresentazione estesa per riepiloghi, select e modali.
  function fmtDateTime(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard di pagina.
    if (!isoUtc) return "—";

    // Prova a convertire il valore API in oggetto Date tramite utility condivisa.
    const d = APL.utils.parseApiDate(isoUtc);

    // Se il parsing fallisce mantiene il placeholder.
    if (!d) return "—";

    // Restituisce data e ora in formato italiano.
    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Converte un importo espresso in centesimi in una stringa leggibile per l’utente.
  function formatMoney(cents, currency) {
    // Trasforma i centesimi in valore decimale a due cifre.
    const value = (Number(cents || 0) / 100).toFixed(2);

    // Compone la stringa finale con la valuta disponibile o con fallback EUR.
    return `${value} ${currency || "EUR"}`;
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione uniforme
  // di sessione scaduta, accesso negato ed errori applicativi.
  async function apiJson(method, url, json) {
    // Invia la richiesta HTTP JSON includendo l’header di autenticazione utente.
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Se la risposta non è positiva, viene applicata una gestione errori coerente.
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

      // Per tutti gli altri casi costruisce un oggetto Error arricchito
      // con metadati utili per logging e gestione a livello superiore.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    // In caso di successo restituisce direttamente il payload deserializzato.
    return res.data;
  }

  // Attende che il sistema modale condiviso sia disponibile prima di utilizzarlo.
  async function ensureModalReady(timeoutMs = 10000) {
    // Registra l’istante iniziale per applicare un timeout massimo di attesa.
    const start = Date.now();

    // Attende finché l’infrastruttura modale non risulta disponibile.
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    // Restituisce true solo se la modale è effettivamente pronta all’uso.
    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Applica uno dei preset temporali disponibili nella UI.
  function applyQuickRange(kind) {
    // Recupera i due input data che rappresentano il filtro temporale.
    const fromEl = $("fromDate");
    const toEl = $("toDate");

    // Se i controlli non sono presenti non è possibile applicare il preset.
    if (!fromEl || !toEl) return;

    // Data odierna nel fuso di Roma usata come estremo superiore.
    const today = APL.utils.romeTodayDateInputValue();

    // Preset ultimi 90 giorni.
    if (kind === "last90") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -90);
      toEl.value = today;
    } else if (kind === "last365") {
      // Preset ultimi 365 giorni.
      fromEl.value = APL.utils.addDaysToDateInput(today, -365);
      toEl.value = today;
    } else if (kind === "all") {
      // Preset senza limitazione temporale esplicita.
      fromEl.value = "";
      toEl.value = "";
    }
  }

  // Legge l’intervallo temporale selezionato dall’utente.
  // In assenza di un intervallo valido, applica una finestra predefinita retroattiva.
  function readRangeOrDefault(daysBack) {
    // Recupera le due date inserite dall’utente nei controlli di filtro.
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    // Se entrambe le date sono valorizzate e coerenti, usa l’intervallo esplicito.
    if (from && to && to >= from) {
      const range = APL.utils.romeDateRangeToUtc(from, to);
      if (range) return { fromUtc: range.fromUtc, toUtc: range.toUtc };
    }

    // In assenza di intervallo valido, costruisce una finestra retroattiva
    // rispetto alla data odierna nel fuso di Roma.
    const today = APL.utils.romeTodayDateInputValue();
    const startDay = APL.utils.addDaysToDateInput(today, -(daysBack || 365));
    return APL.utils.romeDateRangeToUtc(startDay, today);
  }

  // Traduce lo stato tecnico di un payment intent in una label leggibile e in un tone visuale.
  function mapIntentStatus(status) {
    // Normalizza il valore in maiuscolo per confronti stabili.
    const s = String(status || "").toUpperCase();

    // Mappa gli stati noti verso etichetta utente e tono grafico.
    if (s === "SUCCEEDED") return { label: "Completato", tone: "emerald" };
    if (s === "FAILED") return { label: "Non riuscito", tone: "red" };
    if (s === "CANCELED" || s === "CANCELLED") return { label: "Annullato", tone: "slate" };
    if (s === "PENDING") return { label: "In elaborazione", tone: "amber" };
    if (s === "CREATED") return { label: "In sospeso", tone: "blue" };

    // Mantiene comunque una rappresentazione leggibile anche per stati inattesi.
    return { label: status || "—", tone: "slate" };
  }

  // Costruisce la pill visuale per lo stato del payment intent.
  function pill(label, tone) {
    // Seleziona la combinazione di classi CSS in base al tone richiesto.
    const cls =
      tone === "emerald"
        ? "bg-emerald-50 text-emerald-700"
        : tone === "red"
          ? "bg-red-50 text-red-700"
          : tone === "amber"
            ? "bg-amber-50 text-amber-800"
            : tone === "blue"
              ? "bg-blue-50 text-blue-700"
              : "bg-slate-100 text-slate-700";

    // Restituisce il frammento HTML pronto per essere inserito nella tabella.
    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}">${escapeHtml(label)}</span>`;
  }

  // Riduce la lunghezza del riferimento tecnico mantenendo leggibili gli ultimi caratteri.
  function shortRef(s) {
    // Converte il valore in stringa per gestire id o riferimenti nulli.
    const x = String(s || "");

    // In assenza di valore, usa il placeholder standard.
    if (!x) return "—";

    // Se la lunghezza è già contenuta, non tronca nulla.
    if (x.length <= 10) return x;

    // Mantiene soltanto la parte finale, più utile per riconoscere il riferimento.
    return `…${x.slice(-10)}`;
  }

  // Normalizza il payload di un appuntamento per gestire differenze di naming
  // tra proprietà camelCase e PascalCase provenienti dal backend.
  function normalizeAppointment(a) {
    return {
      id: a?.id || a?.Id || null,
      serviceCode: a?.serviceCode || a?.ServiceCode || "",
      quotedPriceCents: a?.quotedPriceCents ?? a?.QuotedPriceCents ?? 0,
      currency: a?.currency || a?.Currency || "EUR",
      status: a?.status || a?.Status || "",
      startUtc: a?.startUtc || a?.StartUtc || "",
      endUtc: a?.endUtc || a?.EndUtc || "",
      notes: a?.notes || a?.Notes || null,
    };
  }

  // Normalizza il payload di un payment intent per gestire differenze di naming
  // tra proprietà camelCase e PascalCase provenienti dal backend.
  function normalizeIntent(i) {
    return {
      id: i?.id || i?.Id || null,
      appointmentId: i?.appointmentId || i?.AppointmentId || null,
      amountCents: i?.amountCents ?? i?.AmountCents ?? 0,
      currency: i?.currency || i?.Currency || "EUR",
      status: i?.status || i?.Status || "",
      provider: i?.provider || i?.Provider || "",
      providerIntentId: i?.providerIntentId || i?.ProviderIntentId || "",
      createdAtUtc: i?.createdAtUtc || i?.CreatedAtUtc || "",
      updatedAtUtc: i?.updatedAtUtc || i?.UpdatedAtUtc || "",
    };
  }

  // Determina se lo stato dell’appuntamento lo rende non più rilevante per il pagamento digitale.
  function isClosedAppointmentStatus(status) {
    // Normalizza il valore per confronti affidabili.
    const s = String(status || "").toUpperCase();

    // Gli stati chiusi escludono la prestazione dal flusso di pagamento.
    return s === "CANCELED" || s === "CANCELLED" || s === "NO_SHOW";
  }

  // Costruisce una mappa che associa a ogni appuntamento il payment intent più recente.
  function latestIntentByAppointment(intents) {
    // Mappa finale indicizzata per appointmentId.
    const m = new Map();

    // Analizza tutti gli intent disponibili.
    for (const it of intents) {
      const key = String(it.appointmentId || "");

      // Gli intent privi di appointmentId non sono associabili alla select delle prestazioni.
      if (!key) continue;

      const prev = m.get(key);

      // Se non esiste ancora un intent per quell’appuntamento, memorizza il primo trovato.
      if (!prev) {
        m.set(key, it);
        continue;
      }

      // Confronta le date di aggiornamento/creazione per conservare quello più recente.
      const tPrev = new Date(prev.updatedAtUtc || prev.createdAtUtc || 0).getTime();
      const tNow = new Date(it.updatedAtUtc || it.createdAtUtc || 0).getTime();
      if (tNow >= tPrev) m.set(key, it);
    }

    // Restituisce la mappa finale appointment -> latest intent.
    return m;
  }

  // Aggiorna i riquadri statistici mostrati nella pagina.
  // Le statistiche sono calcolate sul sottoinsieme di intent attualmente mostrato.
  function setStats(intents) {
    // Garantisce di lavorare sempre su un array.
    const list = Array.isArray(intents) ? intents : [];

    // Conta gli intent ancora aperti, cioè creati o in elaborazione.
    const open = list.filter((x) => {
      const s = String(x.status || "").toUpperCase();
      return s === "CREATED" || s === "PENDING";
    }).length;

    // Conta gli intent completati con successo.
    const succ = list.filter((x) => String(x.status || "").toUpperCase() === "SUCCEEDED").length;

    // Aggiorna i tre indicatori sintetici presenti nella vista.
    if ($("statOpen")) $("statOpen").textContent = String(open);
    if ($("statSucceeded")) $("statSucceeded").textContent = String(succ);
    if ($("statTotal")) $("statTotal").textContent = String(list.length);
  }

  // Costruisce il testo su cui applicare la ricerca client-side.
  function buildSearchHaystack(intent, appt) {
    // Inserisce nel testo ricercabile la data della prestazione, il codice servizio,
    // il riferimento del pagamento e lo stato dell’operazione.
    const when = appt?.startUtc ? fmtDate(appt.startUtc) : "";
    const svc = appt?.serviceCode || "";
    const ref = intent?.providerIntentId || intent?.id || "";
    return `${when} ${svc} ${ref} ${intent?.status || ""}`.toLowerCase();
  }

  // Applica i filtri client-side sul dataset degli intent già caricato dal backend.
  function applyClientFilters(intents) {
    // Legge i criteri attualmente selezionati dall’utente.
    const statusFilter = String($("statusSelect")?.value || "ALL").toUpperCase();
    const term = String($("searchInput")?.value || "").trim().toLowerCase();

    // Lavora su una copia del dataset per non mutare lo stato originale.
    let list = Array.isArray(intents) ? intents.slice() : [];

    // Applica il filtro per stato.
    if (statusFilter !== "ALL") {
      if (statusFilter === "OPEN") {
        list = list.filter((x) => {
          const s = String(x.status || "").toUpperCase();
          return s === "CREATED" || s === "PENDING";
        });
      } else {
        list = list.filter((x) => String(x.status || "").toUpperCase() === statusFilter);
      }
    }

    // Applica la ricerca testuale sul testo costruito combinando intent e appuntamento.
    if (term) {
      list = list.filter((x) => {
        const appt = state.apptById.get(String(x.appointmentId || ""));
        return buildSearchHaystack(x, appt).includes(term);
      });
    }

    // Ordina il risultato in ordine decrescente di aggiornamento/creazione,
    // così da mostrare in alto le operazioni più recenti.
    list.sort((a, b) => {
      const ta = new Date(a.updatedAtUtc || a.createdAtUtc || 0).getTime();
      const tb = new Date(b.updatedAtUtc || b.createdAtUtc || 0).getTime();
      return tb - ta;
    });

    return list;
  }

  // Verifica se la delega selezionata risulta attiva nel momento corrente.
  function isDelegationActiveNow(d) {
    // In assenza di delega non è possibile considerare il contesto attivo.
    if (!d) return false;

    // Lo stato logico deve risultare ACTIVE.
    const status = String(d.status || "").toUpperCase();
    if (status !== "ACTIVE") return false;

    // Valuta l’eventuale finestra temporale di validità.
    const now = Date.now();
    const s = Date.parse(d.startsAtUtc || "");
    const e = Date.parse(d.endsAtUtc || "");

    // Se gli estremi non sono valorizzati in modo interpretabile,
    // si considera valido il solo stato della delega.
    if (!Number.isFinite(s) || !Number.isFinite(e)) return true;
    return now >= s && now <= e;
  }

  // Verifica se la delega selezionata consente la gestione dei pagamenti.
  function canManagePayments(d) {
    // In assenza di delega il permesso non può essere concesso.
    if (!d) return false;

    // Solo lo scope MANAGEPAYMENTS abilita le operazioni economiche.
    const scope = String(d.scope || "").toUpperCase();
    return scope === "MANAGEPAYMENTS";
  }

  // Aggiorna il testo contestuale che descrive lo stato della delega selezionata.
  function updateDelegationHint() {
    // Recupera il contenitore informativo dedicato al contesto delega.
    const el = $("delegationHint");
    if (!el) return;

    const d = state.selectedDelegation;

    // Nessun assistito selezionato: mostra un messaggio introduttivo.
    if (!d || !state.selectedPatientUserId) {
      el.textContent = "Selezioni un assistito per visualizzare lo storico dei pagamenti.";
      return;
    }

    // Delega non attiva: informa il delegato del vincolo temporale o logico.
    if (!isDelegationActiveNow(d)) {
      el.textContent = "La delega selezionata non risulta attiva in questo momento.";
      return;
    }

    // Messaggio differenziato in base al perimetro autorizzativo della delega.
    el.textContent = canManagePayments(d)
      ? "È possibile consultare lo storico ed effettuare pagamenti in base ai permessi disponibili."
      : "È possibile consultare lo storico. Le operazioni di pagamento potrebbero non essere disponibili.";
  }

  // Aggiorna i link contestuali verso la pagina appuntamenti mantenendo
  // il riferimento all’assistito attualmente selezionato.
  function updateContextLinks() {
    const patientUserId = String(state.selectedPatientUserId || "");
    const a = $("appointmentsLink");
    const e = $("emptyAppointmentsLink");

    const href = patientUserId
      ? `./appointments.html?patientUserId=${encodeURIComponent(patientUserId)}`
      : "./appointments.html";

    if (a) a.href = href;
    if (e) e.href = href;
  }

  // Aggiorna il riquadro informativo relativo ai permessi di pagamento
  // e allinea lo stato operativo dei controlli di quick pay.
  function updatePayPermissionsBox() {
    const box = $("payPermissionsBox");
    const btn = $("btnPayNow");
    const sel = $("appointmentSelect");

    const d = state.selectedDelegation;

    if (!box) return;

    // Nessun assistito selezionato: la sezione resta puramente informativa.
    if (!d || !state.selectedPatientUserId) {
      box.textContent = "Selezioni un assistito per verificare le operazioni disponibili.";
      if (btn) btn.disabled = true;
      if (sel) sel.disabled = true;
      updateQuickPayButtonState();
      return;
    }

    // Delega non attiva: blocca ogni operazione economica.
    if (!isDelegationActiveNow(d)) {
      box.textContent = "La delega selezionata non risulta attiva in questo momento.";
      if (btn) btn.disabled = true;
      if (sel) sel.disabled = true;
      updateQuickPayButtonState();
      return;
    }

    // Delega priva del permesso pagamenti: consente la sola consultazione dello storico.
    if (!canManagePayments(d)) {
      box.textContent = "La delega selezionata non consente di effettuare pagamenti. È comunque possibile consultare lo storico.";
      if (btn) btn.disabled = true;
      if (sel) sel.disabled = true;
      updateQuickPayButtonState();
      return;
    }

    // Delega pienamente abilitata: la select può essere utilizzata per il pagamento.
    box.textContent = "Per la delega selezionata è possibile effettuare pagamenti in-app, oltre a consultare lo storico.";
    if (sel) sel.disabled = false;
    updateQuickPayButtonState();
  }

  // Popola la select con le sole prestazioni ancora candidabili al pagamento.
  // Gli appuntamenti già pagati vengono esclusi dalla selezione.
  function renderAppointmentSelect(appointments, intentByAppt) {
    // Recupera la select dell’area pagamento.
    const sel = $("appointmentSelect");
    if (!sel) return;

    // Costruisce l’elenco delle sole prestazioni non chiuse e non già pagate.
    const eligible = (appointments || [])
      .filter((a) => a && a.id && !isClosedAppointmentStatus(a.status))
      .map((a) => {
        const it = intentByAppt.get(String(a.id));
        const st = String(it?.status || "").toUpperCase();
        const paid = st === "SUCCEEDED";
        const labelStatus = paid
          ? "Pagato"
          : (st === "FAILED" ? "Non riuscito" : (st === "PENDING" ? "In elaborazione" : (st === "CREATED" ? "In sospeso" : "Da pagare")));

        return {
          id: String(a.id),
          label: `${fmtDateTime(a.startUtc)} · ${a.serviceCode || "Prestazione"} · ${formatMoney(a.quotedPriceCents, a.currency)} · ${labelStatus}`,
          paid,
        };
      })
      .filter((x) => !x.paid);

    // Memorizza l’eventuale selezione corrente per tentare di preservarla dopo il rerender.
    const current = String(sel.value || "");

    // Rigenera tutte le opzioni della select.
    sel.innerHTML = [
      `<option value="">Selezionare…</option>`,
      ...eligible.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.label)}</option>`),
    ].join("");

    // Se presente un appuntamento passato da query string, gli viene data priorità.
    const fromQuery = String(state.selectedAppointmentIdFromQuery || "").trim();
    if (fromQuery && eligible.some((x) => x.id === fromQuery)) {
      sel.value = fromQuery;
    } else if (current && eligible.some((x) => x.id === current)) {
      // In alternativa tenta di preservare il valore precedente se ancora valido.
      sel.value = current;
    } else {
      // Se nessun valore è più disponibile, azzera la selezione.
      sel.value = "";
    }

    // La query string viene consumata una sola volta.
    state.selectedAppointmentIdFromQuery = "";

    // Riallinea permessi e riepilogo dopo il rerender della select.
    updatePayPermissionsBox();
    renderPaySummary();
  }

  // Calcola lo stato operativo della prestazione selezionata nella sezione pagamento.
  // Il risultato determina se il pulsante può essere usato e quale label mostrare.
  function selectedAppointmentState() {
    // Legge l’appuntamento attualmente selezionato nella UI.
    const apptId = String($("appointmentSelect")?.value || "");

    // In assenza di selezione non è possibile avviare alcuna operazione.
    if (!apptId) {
      return { appointment: null, latestIntent: null, status: "", canStart: false, buttonLabel: "Avvia pagamento" };
    }

    // Recupera appuntamento e ultimo intent associato dalla cache client-side.
    const appointment = state.apptById.get(apptId) || null;
    const latestIntent = state.latestIntentByAppt.get(apptId) || null;
    const status = String(latestIntent?.status || "").toUpperCase();

    // Se per qualche motivo l’appuntamento non è disponibile, blocca il flusso.
    if (!appointment) {
      return { appointment: null, latestIntent, status, canStart: false, buttonLabel: "Avvia pagamento" };
    }

    // Se non esiste ancora un intent, il pagamento può essere avviato da zero.
    if (!latestIntent) {
      return { appointment, latestIntent: null, status: "", canStart: true, buttonLabel: "Avvia pagamento" };
    }

    // Dopo un fallimento è consentito un nuovo tentativo.
    if (status === "FAILED") {
      return { appointment, latestIntent, status, canStart: true, buttonLabel: "Riprova pagamento" };
    }

    // Se l’intent è soltanto creato, è ancora possibile avviarne il processamento.
    if (status === "CREATED") {
      return { appointment, latestIntent, status, canStart: true, buttonLabel: "Avvia pagamento" };
    }

    // Tutti gli altri stati bloccano l’avvio di una nuova azione dalla select.
    return { appointment, latestIntent, status, canStart: false, buttonLabel: "Avvia pagamento" };
  }

  // Aggiorna lo stato abilitato/disabilitato del pulsante di pagamento e la sua etichetta.
  function updateQuickPayButtonState() {
    // Recupera il pulsante principale dell’area pagamento.
    const btn = $("btnPayNow");
    if (!btn) return;

    // Calcola lo stato operativo in base alla selezione corrente.
    const d = state.selectedDelegation;
    const info = selectedAppointmentState();
    const hasSelection = !!$("appointmentSelect")?.value;
    const allowed = !!d && isDelegationActiveNow(d) && canManagePayments(d);

    // Il pulsante è attivo solo in presenza di una selezione valida,
    // di una delega autorizzata e di uno stato che consente l’azione.
    btn.disabled = !(allowed && hasSelection && info.canStart);

    // Se non è stata scelta alcuna prestazione, mostra la label standard.
    if (!hasSelection) {
      btn.textContent = "Avvia pagamento";
      return;
    }

    // In caso contrario usa la label derivata dallo stato dell’operazione.
    btn.textContent = info.buttonLabel || "Avvia pagamento";
  }

  // Costruisce il riepilogo della prestazione selezionata e del relativo stato di pagamento più recente.
  function renderPaySummary() {
    // Recupera il contenitore del riepilogo.
    const box = $("paySummary");
    if (!box) return;

    const patientOk = !!state.selectedPatientUserId;

    // Legge lo stato calcolato della selezione corrente.
    const info = selectedAppointmentState();
    const appt = info.appointment;
    const it = info.latestIntent;
    const itStatus = it ? mapIntentStatus(it.status) : null;

    // In assenza di assistito selezionato, mostra un messaggio introduttivo.
    if (!patientOk) {
      box.textContent = "Selezioni un assistito e una prestazione per visualizzare il riepilogo.";
      updateQuickPayButtonState();
      return;
    }

    // In assenza di appuntamento valido, mostra un testo semplice di fallback.
    if (!appt) {
      box.textContent = $("appointmentSelect")?.value
        ? "Informazioni non disponibili."
        : "Selezioni una prestazione per visualizzare il riepilogo.";
      updateQuickPayButtonState();
      return;
    }

    // Costruisce i blocchi HTML con data, servizio, importo e stato corrente.
    const lines = [];
    lines.push(`<div class="text-xs font-medium text-slate-500">Riepilogo</div>`);
    lines.push(`<div class="mt-2 grid gap-2 text-sm text-slate-700">`);
    lines.push(`<div class="flex items-center justify-between gap-3"><span class="text-slate-500">Data e ora</span><span class="font-medium">${escapeHtml(fmtDateTime(appt.startUtc))}</span></div>`);
    lines.push(`<div class="flex items-center justify-between gap-3"><span class="text-slate-500">Prestazione</span><span class="font-medium">${escapeHtml(appt.serviceCode || "—")}</span></div>`);
    lines.push(`<div class="flex items-center justify-between gap-3"><span class="text-slate-500">Importo</span><span class="font-medium">${escapeHtml(formatMoney(appt.quotedPriceCents, appt.currency))}</span></div>`);
    if (it) {
      lines.push(`<div class="flex items-center justify-between gap-3"><span class="text-slate-500">Stato corrente</span><span class="font-medium">${escapeHtml(itStatus?.label || "—")}</span></div>`);
    }
    lines.push(`</div>`);

    // Messaggio contestuale dipendente dallo stato più recente dell’operazione di pagamento.
    let footer = `La richiesta di pagamento sarà inviata al canale digitale disponibile per la delega selezionata.`;
    if (info.status === "PENDING") {
      footer = `Per questa prestazione è già presente una richiesta in elaborazione. Attendere l’aggiornamento finale nello storico oppure contattare la struttura.`;
    } else if (info.status === "SUCCEEDED") {
      footer = `Per questa prestazione risulta già registrato un pagamento completato.`;
    } else if (info.status === "FAILED") {
      footer = `L’ultimo tentativo non è andato a buon fine. Se la delega lo consente, è possibile riprovare.`;
    } else if (info.status === "CREATED") {
      footer = `Esiste già un intent creato per questa prestazione. È possibile avviare l’elaborazione digitale.`;
    }

    // Inserisce il riepilogo finale nel DOM.
    box.innerHTML = `<div class="space-y-2">${lines.join("")}<div class="rounded-xl border bg-white px-4 py-3 text-xs text-slate-600 leading-relaxed">${escapeHtml(footer)}</div></div>`;

    // Riallinea anche il pulsante principale con lo stato appena renderizzato.
    updateQuickPayButtonState();
  }

  // Renderizza la tabella dello storico pagamenti e aggiorna stato vuoto e statistiche.
  function renderIntentsTable(intents) {
    // Recupera il tbody che ospita dinamicamente le righe dello storico.
    const tbody = $("intentsTbody");
    if (!tbody) return;

    const list = Array.isArray(intents) ? intents : [];

    // Aggiorna i contatori sintetici sulla base del dataset mostrato.
    setStats(list);

    // Se non è stato ancora selezionato un assistito, mostra un placeholder contestuale.
    if (!state.selectedPatientUserId) {
      emptyState(false);
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Selezioni un assistito per iniziare.</td></tr>`;
      return;
    }

    // Se non ci sono elementi, attiva lo stato vuoto e mostra una riga placeholder.
    if (!list.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    // In presenza di dati nasconde lo stato vuoto.
    emptyState(false);

    // Classi CSS riusabili per i pulsanti azione della tabella.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

    // Solo una delega attiva con scope adeguato abilita azioni economiche dalla tabella.
    const allowPay = !!state.selectedDelegation && isDelegationActiveNow(state.selectedDelegation) && canManagePayments(state.selectedDelegation);

    // Costruisce tutte le righe HTML partendo dagli intent filtrati.
    const rows = list.map((it) => {
      const appt = state.apptById.get(String(it.appointmentId || "")) || null;

      // Data mostrata: preferibilmente quella della prestazione, altrimenti quella dell’intent.
      const when = appt?.startUtc ? fmtDate(appt.startUtc) : fmtDate(it.updatedAtUtc || it.createdAtUtc);

      // Prestazione associata oppure fallback generico.
      const svc = appt?.serviceCode || "Prestazione";

      // Importo formattato per la vista.
      const amount = formatMoney(it.amountCents, it.currency);

      // Stato dell’intent in forma visuale.
      const st = mapIntentStatus(it.status);
      const stPill = pill(st.label, st.tone);

      // Riferimento corto per la tabella e riferimento completo per il tooltip.
      const ref = shortRef(it.providerIntentId || it.id);
      const fullRef = String(it.providerIntentId || it.id || "");

      // Solo alcuni stati consentono un nuovo tentativo di pagamento
      // e solo se la delega selezionata è autorizzata.
      const s = String(it.status || "").toUpperCase();
      const canPay = allowPay && (s === "CREATED" || s === "FAILED");
      const payLabel = s === "FAILED" ? "Riprova" : "Avvia";

      return `
        <tr>
          <td class="py-4 pr-4 text-slate-800">${escapeHtml(when)}</td>
          <td class="py-4 pr-4 text-slate-700">${escapeHtml(svc)}</td>
          <td class="py-4 pr-4 text-slate-700">${escapeHtml(amount)}</td>
          <td class="py-4 pr-4">${stPill}</td>
          <td class="py-4 pr-4 text-slate-600 truncate max-w-[240px]" title="${escapeHtml(fullRef)}">${escapeHtml(ref)}</td>
          <td class="py-4 text-right">
            <div class="inline-flex items-center gap-2 justify-end">
              <button type="button" class="${btnCls}" data-action="details" data-id="${escapeHtml(String(it.id))}">
                Dettagli
              </button>
              <button type="button" class="${btnCls}" data-action="receipt" data-id="${escapeHtml(String(it.id))}">
                Ricevuta
              </button>
              ${canPay ? `<button type="button" class="${btnCls}" data-action="pay" data-id="${escapeHtml(String(it.id))}">${escapeHtml(payLabel)}</button>` : ""}
            </div>
          </td>
        </tr>
      `;
    });

    // Sostituisce il contenuto della tabella con le nuove righe renderizzate.
    tbody.innerHTML = rows.join("");
  }

  // Mostra una modale con il dettaglio strutturato del payment intent selezionato.
  async function openDetailsModal(intent) {
    // Verifica che l’infrastruttura modale condivisa sia pronta.
    const ok = await ensureModalReady();
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    // Recupera l’appuntamento collegato e la rappresentazione utente dello stato.
    const appt = state.apptById.get(String(intent.appointmentId || "")) || null;
    const st = mapIntentStatus(intent.status);

    // Costruisce il contenuto HTML della modale con riepilogo e riferimento.
    const body = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Riepilogo</div>
          <div class="mt-2 grid gap-2 text-sm text-slate-700">
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-500">Prestazione</span>
              <span class="font-medium">${escapeHtml(appt?.serviceCode || "—")}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-500">Data e ora</span>
              <span class="font-medium">${escapeHtml(appt?.startUtc ? fmtDateTime(appt.startUtc) : "—")}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-500">Importo</span>
              <span class="font-medium">${escapeHtml(formatMoney(intent.amountCents, intent.currency))}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-500">Stato</span>
              <span class="font-medium">${escapeHtml(st.label)}</span>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Riferimento</div>
          <div class="mt-1 text-sm font-semibold text-slate-900 break-words">${escapeHtml(intent.providerIntentId || intent.id || "—")}</div>
          <div class="mt-2 text-xs text-slate-600">Aggiornato: ${escapeHtml(fmtDateTime(intent.updatedAtUtc || intent.createdAtUtc))}</div>
        </div>

        <div class="text-xs text-slate-600 leading-relaxed">
          Dopo l’avvio del pagamento, lo stato può rimanere temporaneamente in elaborazione prima dell’aggiornamento finale.
        </div>
      </div>
    `;

    // Apre la modale con una sola azione di chiusura.
    APL.ui.modal.open({
      title: "Dettagli pagamento",
      bodyHtml: body,
      actions: [{ label: "Chiudi", kind: "primary", closeOnClick: true }],
    });
  }

  // Genera e avvia il download locale di un contenuto testuale, usato per la ricevuta.
  function downloadText(filename, text) {
    // Crea un blob testuale UTF-8 con il contenuto da scaricare.
    const blob = new Blob([String(text || "")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    // Costruisce un link temporaneo per forzare il download lato browser.
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "ricevuta.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Rilascia l’object URL dopo un piccolo ritardo per evitare race condition.
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // Costruisce una ricevuta testuale sintetica per uso personale a partire dal payment intent.
  function buildReceipt(intent) {
    // Recupera l’appuntamento collegato all’intent.
    const appt = state.apptById.get(String(intent.appointmentId || "")) || null;

    // Traduce lo stato tecnico in una label leggibile.
    const st = mapIntentStatus(intent.status);

    // Costruisce il testo riga per riga così da mantenere una struttura semplice e portable.
    const lines = [];
    lines.push("Healthcare Portal — Ricevuta (uso personale)");
    lines.push(`Data emissione: ${fmtDateTime(new Date().toISOString())}`);
    lines.push("");
    lines.push(`Prestazione: ${appt?.serviceCode || "—"}`);
    lines.push(`Data prestazione: ${appt?.startUtc ? fmtDateTime(appt.startUtc) : "—"}`);
    lines.push(`Importo: ${formatMoney(intent.amountCents, intent.currency)}`);
    lines.push(`Stato: ${st.label}`);
    lines.push(`Riferimento: ${intent.providerIntentId || intent.id || "—"}`);
    lines.push(`Aggiornato: ${fmtDateTime(intent.updatedAtUtc || intent.createdAtUtc)}`);

    // Restituisce il contenuto finale in formato plain text.
    return lines.join("\n");
  }

  // Mostra una conferma modale standard prima di operazioni rilevanti.
  // In assenza della modale condivisa, ripiega su `window.confirm`.
  async function confirmAction(title, message, confirmLabel) {
    // Tenta di utilizzare la modale condivisa, più coerente con la UI dell’applicazione.
    const ok = await ensureModalReady();

    // In fallback usa la conferma nativa del browser.
    if (!ok) return window.confirm(message || "Confermare?");

    // Restituisce una promise che si risolve in base all’azione scelta dall’utente.
    return await new Promise((resolve) => {
      APL.ui.modal.open({
        title: title || "Conferma",
        bodyHtml: `<div class="text-sm text-slate-700 leading-relaxed">${escapeHtml(message || "")}</div>`,
        actions: [
          { label: "Annulla", kind: "secondary", closeOnClick: true, onClick: () => resolve(false) },
          { label: confirmLabel || "Conferma", kind: "primary", closeOnClick: true, onClick: () => resolve(true) },
        ],
      });
    });
  }

  // Carica l’elenco delle deleghe disponibili per il delegato autenticato
  // e aggiorna il contesto iniziale dell’assistito selezionabile.
  async function loadDelegations() {
    const res = await APL.utils.requestJson(API_DELEGATIONS, {
      headers: { Accept: "application/json", ...APL.session.authHeader() },
    });

    const delegations = Array.isArray(res.data) ? res.data : [];
    state.delegations = delegations;

    const select = $("patientSelect");
    if (!select) return;

    select.innerHTML = "";

    // In assenza di deleghe, la pagina viene portata in uno stato non operativo.
    if (!delegations.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nessuna delega disponibile";
      select.appendChild(opt);

      state.selectedPatientUserId = "";
      state.selectedDelegation = null;
      updateDelegationHint();
      updateContextLinks();
      updatePayPermissionsBox();
      return;
    }

    // Placeholder iniziale per richiedere la selezione esplicita dell’assistito.
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Selezionare un assistito...";
    select.appendChild(ph);

    // Costruisce le opzioni della select a partire dalle deleghe disponibili.
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

    // Recupera gli eventuali parametri di contesto passati via query string.
    const qs = new URLSearchParams(window.location.search);
    const fromQs = String(qs.get("patientUserId") || "").trim();
    const apptFromQs = String(qs.get("appointmentId") || "").trim();

    state.selectedAppointmentIdFromQuery = apptFromQs || "";

    // Se la query string punta a un assistito valido, preseleziona quel contesto.
    const pick = (fromQs && delegations.some((d) => String(d.patientUserId) === fromQs))
      ? fromQs
      : "";

    select.value = pick;

    state.selectedPatientUserId = pick;
    state.selectedDelegation = pick
      ? (delegations.find((x) => String(x.patientUserId) === String(pick)) || null)
      : null;

    // Aggiorna tutti i blocchi dipendenti dalla delega selezionata.
    updateDelegationHint();
    updateContextLinks();
    updatePayPermissionsBox();
  }

  // Carica in parallelo appuntamenti e payment intent dell’assistito selezionato,
  // aggiorna lo stato locale e rigenera le diverse porzioni della vista.
  async function loadAllForSelectedPatient() {
    // Riparte sempre da uno stato visivo pulito.
    clearError();
    setLoading(true);

    try {
      const patientUserId = String(state.selectedPatientUserId || "").trim();

      // In assenza di assistito selezionato, ripristina la vista in stato iniziale.
      if (!patientUserId) {
        state.appointments = [];
        state.intents = [];
        state.apptById = new Map();
        state.intentById = new Map();
        state.latestIntentByAppt = new Map();
        state.shownIntents = [];

        setStats([]);
        emptyState(false);

        const tbody = $("intentsTbody");
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Selezioni un assistito per iniziare.</td></tr>`;

        const sel = $("appointmentSelect");
        if (sel) sel.innerHTML = `<option value="">Selezionare…</option>`;

        renderPaySummary();
        updatePayPermissionsBox();
        return;
      }

      // Determina il range temporale da usare per entrambe le API.
      const rr = readRangeOrDefault(365);

      // Costruisce gli URL completi con assistito e parametri temporali.
      const apptUrl =
        `${API_APPOINTMENTS}?patientUserId=${encodeURIComponent(patientUserId)}` +
        `&fromUtc=${encodeURIComponent(rr.fromUtc)}&toUtc=${encodeURIComponent(rr.toUtc)}`;

      const intentsUrl =
        `${API_INTENTS}?patientUserId=${encodeURIComponent(patientUserId)}` +
        `&fromUtc=${encodeURIComponent(rr.fromUtc)}&toUtc=${encodeURIComponent(rr.toUtc)}`;

      // Carica in parallelo appuntamenti e intent per ridurre il tempo totale di attesa.
      const [apptData, intentsData] = await Promise.all([
        apiJson("GET", apptUrl),
        apiJson("GET", intentsUrl),
      ]);

      // Normalizza i dati ricevuti dal backend.
      const appointments = (Array.isArray(apptData) ? apptData : []).map(normalizeAppointment);
      const intents = (Array.isArray(intentsData) ? intentsData : []).map(normalizeIntent);

      // Aggiorna lo stato client-side relativo agli appuntamenti.
      state.appointments = appointments;
      state.apptById = new Map(appointments.filter((a) => a.id).map((a) => [String(a.id), a]));

      // Aggiorna lo stato client-side relativo ai payment intent.
      state.intents = intents;
      state.intentById = new Map(intents.filter((x) => x.id).map((x) => [String(x.id), x]));

      // Calcola, per ogni appuntamento, l’ultimo intent rilevante.
      state.latestIntentByAppt = latestIntentByAppointment(intents);

      // Rigenera la select delle prestazioni candidabili al pagamento.
      renderAppointmentSelect(state.appointments, state.latestIntentByAppt);

      // Rigenera il riepilogo della selezione corrente.
      renderPaySummary();

      // Applica i filtri client-side allo storico e renderizza la tabella finale.
      state.shownIntents = applyClientFilters(state.intents);
      renderIntentsTable(state.shownIntents);

      // Riallinea il riquadro dei permessi dopo il caricamento completo.
      updatePayPermissionsBox();
    } catch (err) {
      // In caso di errore mostra un messaggio globale e svuota la tabella.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare i dati.");
      const tbody = $("intentsTbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">—</td></tr>`;
      emptyState(false);
      setStats([]);
    } finally {
      // Ripristina sempre lo stato di non-caricamento a fine flusso.
      setLoading(false);
    }
  }

  // Avvia il flusso di pagamento per la prestazione selezionata.
  // Se necessario, crea prima un intent e poi richiede l’avvio del processamento digitale.
  async function payForAppointment(appointmentId) {
    // Verifica che la delega corrente consenta effettivamente l’operazione.
    const d = state.selectedDelegation;
    if (!d || !isDelegationActiveNow(d) || !canManagePayments(d)) {
      APL.utils.toast("Operazione non disponibile per la delega selezionata.", "info");
      return;
    }

    // Recupera l’appuntamento selezionato dalla cache locale.
    const appt = state.apptById.get(String(appointmentId)) || null;
    if (!appt) {
      APL.utils.toast("Selezione non valida.", "error");
      return;
    }

    // Analizza lo stato operativo corrente della prestazione.
    const info = selectedAppointmentState();

    // Blocca il flusso se esiste già una richiesta in elaborazione.
    if (info.status === "PENDING") {
      APL.utils.toast("Per questa prestazione è già presente una richiesta in elaborazione.", "info");
      return;
    }

    // Blocca il flusso se il pagamento risulta già completato.
    if (info.status === "SUCCEEDED") {
      APL.utils.toast("Per questa prestazione risulta già registrato un pagamento completato.", "info");
      return;
    }

    // Chiede conferma esplicita prima di avviare l’operazione.
    const ok = await confirmAction(
      "Avvia pagamento",
      `Inviare la richiesta di pagamento di ${formatMoney(appt.quotedPriceCents, appt.currency)} al canale digitale per l’assistito selezionato?`,
      "Avvia"
    );
    if (!ok) return;

    // Attiva loading e pulisce eventuali errori precedenti.
    setLoading(true);
    clearError();

    try {
      const patientUserId = String(state.selectedPatientUserId || "");

      // Crea l’intent associato all’appuntamento selezionato.
      const created = await apiJson(
        "POST",
        `${API_CREATE_INTENT}/${encodeURIComponent(String(appointmentId))}/intent?patientUserId=${encodeURIComponent(patientUserId)}`,
        { amountCents: null }
      );

      const intent = normalizeIntent(created || {});

      // Senza un id non è possibile proseguire con il processamento.
      if (!intent.id) throw new Error("Operazione non disponibile.");

      const currentStatus = String(intent.status || "").toUpperCase();

      // Se il backend restituisce un intent già in elaborazione, evita un doppio avvio.
      if (currentStatus === "PENDING") {
        APL.utils.toast("Richiesta già presente e attualmente in elaborazione.", "info");
        await loadAllForSelectedPatient();
        return;
      }

      // Se l’intent risulta già completato, aggiorna semplicemente la pagina.
      if (currentStatus === "SUCCEEDED") {
        APL.utils.toast("Pagamento già registrato come completato.", "info");
        await loadAllForSelectedPatient();
        return;
      }

      // Avvia il processamento dell’intent tramite metodo di pagamento digitale.
      const processed = await apiJson(
        "POST",
        `${API_PROCESS_INTENT}/${encodeURIComponent(String(intent.id))}/process?patientUserId=${encodeURIComponent(patientUserId)}`,
        { method: "CARD" }
      );

      const updated = normalizeIntent(processed || {});

      // Aggiorna localmente la cache se il backend restituisce un intent valido.
      if (updated.id) state.intentById.set(String(updated.id), updated);

      // Notifica l’utente e ricarica i dati per riallineare tutta la vista.
      APL.utils.toast("Richiesta di pagamento inviata. Stato aggiornato a 'In elaborazione'.", "success");
      await loadAllForSelectedPatient();
    } catch (err) {
      // In caso di errore, mostra il feedback e ricarica comunque la vista
      // per mantenere il client allineato con lo stato del backend.
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
      await loadAllForSelectedPatient();
    } finally {
      // Ripristina sempre lo stato di non-caricamento a fine operazione.
      setLoading(false);
    }
  }

  // Riavvia il processamento di un payment intent esistente nei casi consentiti.
  async function retryIntent(intentId) {
    // Verifica che la delega corrente consenta effettivamente l’operazione.
    const d = state.selectedDelegation;
    if (!d || !isDelegationActiveNow(d) || !canManagePayments(d)) {
      APL.utils.toast("Operazione non disponibile per la delega selezionata.", "info");
      return;
    }

    // Recupera l’intent selezionato dalla cache locale.
    const intent = state.intentById.get(String(intentId)) || null;
    if (!intent) return;

    // Analizza lo stato corrente per stabilire se il retry è ammesso.
    const st = String(intent.status || "").toUpperCase();

    // Gli intent già completati o annullati non possono essere riavviati.
    if (st === "SUCCEEDED" || st === "CANCELED") return;

    // Se l’intent è già in elaborazione, evita una nuova richiesta concorrente.
    if (st === "PENDING") {
      APL.utils.toast("L’operazione risulta già in elaborazione.", "info");
      return;
    }

    // Chiede conferma esplicita prima del nuovo tentativo.
    const ok = await confirmAction("Riprova pagamento", "Vuole inviare nuovamente la richiesta di pagamento digitale?", "Riprova");
    if (!ok) return;

    // Attiva loading e pulisce eventuali errori precedenti.
    setLoading(true);
    clearError();

    try {
      const patientUserId = String(state.selectedPatientUserId || "");

      // Richiede nuovamente il processamento dell’intent esistente.
      const processed = await apiJson(
        "POST",
        `${API_PROCESS_INTENT}/${encodeURIComponent(String(intentId))}/process?patientUserId=${encodeURIComponent(patientUserId)}`,
        { method: "CARD" }
      );

      const updated = normalizeIntent(processed || {});

      // Aggiorna la cache locale se la risposta contiene un intent valido.
      if (updated.id) state.intentById.set(String(updated.id), updated);

      // Notifica l’utente e ricarica tutta la vista per riallineare i dati.
      APL.utils.toast("Richiesta di pagamento inviata. Stato aggiornato a 'In elaborazione'.", "success");
      await loadAllForSelectedPatient();
    } catch (err) {
      // In caso di errore mostra un feedback coerente e ricarica i dati.
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
      await loadAllForSelectedPatient();
    } finally {
      // Ripristina lo stato visuale di non-caricamento.
      setLoading(false);
    }
  }

  // Ripristina i filtri della pagina ai valori predefiniti.
  function resetFilters() {
    // Azzera la ricerca testuale.
    $("searchInput").value = "";

    // Ripristina il filtro stato alla modalità completa.
    $("statusSelect").value = "ALL";

    // Reimposta il range temporale predefinito agli ultimi 12 mesi.
    applyQuickRange("last365");
  }

  // Collega tutti gli eventi della pagina ai rispettivi controlli UI.
  function wireEvents() {
    // Refresh esplicito dell’intero dataset.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", loadAllForSelectedPatient);

    // Preset temporali rapidi con ricaricamento immediato dal backend.
    const btnLast90 = $("btnLast90");
    if (btnLast90) btnLast90.addEventListener("click", () => { applyQuickRange("last90"); loadAllForSelectedPatient(); });

    const btnLast365 = $("btnLast365");
    if (btnLast365) btnLast365.addEventListener("click", () => { applyQuickRange("last365"); loadAllForSelectedPatient(); });

    const btnAll = $("btnAll");
    if (btnAll) btnAll.addEventListener("click", () => { applyQuickRange("all"); loadAllForSelectedPatient(); });

    // Reset dei filtri dalla toolbar principale.
    const btnReset = $("btnResetFilters");
    if (btnReset) btnReset.addEventListener("click", () => { resetFilters(); loadAllForSelectedPatient(); });

    // Reset dei filtri dallo stato vuoto.
    const btnEmptyReset = $("btnEmptyReset");
    if (btnEmptyReset) btnEmptyReset.addEventListener("click", () => { resetFilters(); loadAllForSelectedPatient(); });

    // Ricerca testuale applicata localmente sul dataset già in memoria.
    const search = $("searchInput");
    if (search) {
      search.addEventListener("input", () => {
        state.shownIntents = applyClientFilters(state.intents);
        renderIntentsTable(state.shownIntents);
      });
    }

    // Filtro per stato applicato localmente sul dataset già in memoria.
    const statusSelect = $("statusSelect");
    if (statusSelect) {
      statusSelect.addEventListener("change", () => {
        state.shownIntents = applyClientFilters(state.intents);
        renderIntentsTable(state.shownIntents);
      });
    }

    // La modifica dell’intervallo temporale richiede un nuovo caricamento dal backend.
    const fromDate = $("fromDate");
    const toDate = $("toDate");
    if (fromDate) fromDate.addEventListener("change", () => loadAllForSelectedPatient());
    if (toDate) toDate.addEventListener("change", () => loadAllForSelectedPatient());

    // La variazione della prestazione selezionata aggiorna riepilogo e stato dei permessi.
    const apptSel = $("appointmentSelect");
    if (apptSel) {
      apptSel.addEventListener("change", () => {
        renderPaySummary();
        updatePayPermissionsBox();
      });
    }

    // Azione principale di pagamento dalla sezione in-app.
    const btnPayNow = $("btnPayNow");
    if (btnPayNow) {
      btnPayNow.addEventListener("click", async () => {
        const apptId = String($("appointmentSelect")?.value || "");
        if (!apptId) {
          APL.utils.toast("Selezionare una prestazione per procedere.", "error");
          return;
        }
        await payForAppointment(apptId);
      });
    }

    // Refresh esplicito dell’elenco assistiti e successivo riallineamento della vista.
    const btnReload = $("btnReloadDelegations");
    if (btnReload) {
      btnReload.addEventListener("click", async () => {
        clearError();
        setLoading(true);
        try {
          await loadDelegations();
          await loadAllForSelectedPatient();
        } catch (err) {
          showError(APL.utils.humanizeError(err) || "Impossibile aggiornare l’elenco assistiti.");
        } finally {
          setLoading(false);
        }
      });
    }

    // Cambio dell’assistito selezionato con aggiornamento della query string
    // e ricaricamento completo del contesto operativo.
    const select = $("patientSelect");
    if (select) {
      select.addEventListener("change", async () => {
        state.selectedPatientUserId = select.value || "";
        state.selectedDelegation = state.delegations.find((x) => String(x.patientUserId) === String(state.selectedPatientUserId)) || null;

        const qs = new URLSearchParams(window.location.search);
        if (state.selectedPatientUserId) qs.set("patientUserId", state.selectedPatientUserId);
        else qs.delete("patientUserId");
        qs.delete("appointmentId");

        const next = `${window.location.pathname}${qs.toString() ? `?${qs.toString()}` : ""}`;
        window.history.replaceState({}, "", next);

        updateDelegationHint();
        updateContextLinks();
        updatePayPermissionsBox();

        await loadAllForSelectedPatient();
      });
    }

    // Event delegation sulle azioni delle righe dello storico pagamenti.
    const tbody = $("intentsTbody");
    if (tbody) {
      tbody.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-action][data-id]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        if (!id) return;

        const intent = state.intentById.get(String(id));
        if (!intent) return;

        // Apertura modale di dettaglio.
        if (action === "details") {
          await openDetailsModal(intent);
          return;
        }

        // Generazione e download della ricevuta testuale.
        if (action === "receipt") {
          const text = buildReceipt(intent);
          const date = fmtDate(intent.updatedAtUtc || intent.createdAtUtc).replaceAll("/", "-");
          downloadText(`ricevuta_${date}.txt`, text);
          return;
        }

        // Riavvio del pagamento nei casi ammessi.
        if (action === "pay") {
          await retryIntent(id);
          return;
        }
      });
    }
  }

  // Inizializza la pagina pagamenti.
  // Coordina autenticazione, preset iniziali, binding degli eventi e primo caricamento.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Delegate.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Applica il filtro temporale iniziale agli ultimi 12 mesi.
    applyQuickRange("last365");

    // Collega gli eventi della pagina ai rispettivi controlli.
    wireEvents();

    try {
      // Carica dapprima l’elenco delle deleghe disponibili.
      await loadDelegations();

      // Allinea i blocchi contestuali dipendenti dalla delega corrente.
      updateDelegationHint();
      updateContextLinks();
      updatePayPermissionsBox();

      // Esegue il primo caricamento completo del dataset dell’assistito selezionato.
      await loadAllForSelectedPatient();
    } catch (err) {
      // In caso di errore iniziale, mostra un messaggio globale coerente.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la pagina.");
    }
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
