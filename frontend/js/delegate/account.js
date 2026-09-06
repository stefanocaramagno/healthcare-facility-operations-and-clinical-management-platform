/**
 * File: frontend/js/delegate/account.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina account dell’area
 * Delegate, comprendendo il caricamento delle informazioni dell’account
 * autenticato, del profilo delegato associato, dell’elenco delle deleghe
 * disponibili e l’applicazione dei filtri locali per la consultazione
 * delle deleghe mostrate nella tabella.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `account.html` dell’area Delegate. Coordina l’interazione tra
 * interfaccia utente, servizi API relativi ad account, profilo delegato
 * e deleghe, e componenti condivisi dell’applicazione, traducendo i dati
 * restituiti dal backend in una vista consultabile e filtrabile dal
 * delegato autenticato.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Delegate;
 * - recuperare i dati dell’account autenticato;
 * - recuperare il profilo delegato associato, quando disponibile;
 * - recuperare l’elenco delle deleghe del delegato;
 * - aggiornare il riepilogo sintetico del profilo e dello stato account;
 * - applicare filtri locali sulle deleghe mostrate;
 * - renderizzare la tabella delle deleghe e lo stato vuoto;
 * - aprire il dettaglio di una delega in modale;
 * - gestire loading, errori globali e feedback visuale della pagina.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.session.clearAuth()` nei casi di sessione scaduta;
 * - utilizza `APL.session.getAuth()` per derivare lo stato locale della sessione;
 * - utilizza `APL.utils.requestJson()` come base per le chiamate API;
 * - utilizza `APL.utils.parseErrorMessage()` e `APL.utils.humanizeError()`
 *   per normalizzare i messaggi di errore;
 * - utilizza `APL.utils.parseApiDate()` per la formattazione delle date;
 * - utilizza `APL.ui.modal.open()` per il dettaglio della delega;
 * - interagisce con gli endpoint:
 *   - `/api/me`
 *   - `/api/registry/delegates/me/profile`
 *   - `/api/registry/delegates/me/delegations`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli
 * nel global scope. La pagina mantiene uno stato locale con account,
 * profilo delegato, deleghe complete e deleghe filtrate, così da
 * supportare filtraggio, rendering e apertura del dettaglio senza dover
 * interrogare il backend a ogni interazione locale.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina account del delegato.
  const EXPECTED_ROLE = "Delegate";

  // Endpoint per il recupero del profilo sintetico dell’utente autenticato.
  const API_ME = "/api/me";

  // Endpoint per il recupero del profilo delegato associato all’account corrente.
  const API_PROFILE = "/api/registry/delegates/me/profile";

  // Endpoint per il recupero delle deleghe disponibili per il delegato autenticato.
  const API_DELEGATIONS = "/api/registry/delegates/me/delegations";

  // Stato locale della pagina usato per memorizzare account, profilo,
  // deleghe complete, deleghe filtrate e disponibilità del profilo delegato.
  const state = {
    me: null,
    profile: null,
    delegations: [],
    filtered: [],
    profileAvailable: false,
  };

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
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

  // Aggiorna lo stato di caricamento della vista.
  // Oltre al badge, blocca temporaneamente i controlli di filtro locali.
  function setLoading(loading) {
    // Mostra o nasconde il badge globale di caricamento della pagina.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Elenco dei controlli che devono essere temporaneamente disabilitati
    // per evitare interazioni concorrenti durante il caricamento.
    const ids = ["onlyActive", "searchInput"];

    // Applica lo stato disabled a tutti i controlli effettivamente presenti.
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Aggiorna il contenuto testuale di un nodo DOM usando un placeholder standard
  // quando il valore è nullo, vuoto o non disponibile.
  function setText(id, value) {
    // Recupera l’elemento bersaglio.
    const el = $(id);
    if (!el) return;

    // Imposta un fallback coerente quando il valore non è significativo.
    el.textContent = value == null || value === "" ? "—" : String(value);
  }

  // Aggiorna il valore di un input readonly con fallback a stringa vuota.
  function setValue(id, value) {
    // Recupera l’elemento input bersaglio.
    const el = $(id);
    if (!el) return;

    // Imposta il valore normalizzato.
    el.value = value == null ? "" : String(value);
  }

  // Mostra o nasconde un elemento del DOM tramite la classe `hidden`.
  function toggleHidden(id, hidden) {
    // Recupera il nodo DOM interessato.
    const el = $(id);
    if (!el) return;

    // Applica o rimuove la classe di visibilità.
    el.classList.toggle("hidden", !!hidden);
  }

  // Costruisce le iniziali da nome/cognome oppure, in fallback, dall’email.
  function initialsFromIdentity(firstName, lastName, email) {
    // Estrae la prima lettera di nome e cognome se presenti.
    const a = String(firstName || "").trim().slice(0, 1).toUpperCase();
    const b = String(lastName || "").trim().slice(0, 1).toUpperCase();

    // Se almeno una iniziale è disponibile, la restituisce subito.
    if (a || b) return `${a}${b}`.trim();

    // In fallback usa la parte locale dell’indirizzo email.
    const s = String(email || "").trim();
    if (!s) return "—";

    const at = s.indexOf("@");
    const left = (at > 0 ? s.slice(0, at) : s).trim();

    // Prova a ricostruire due iniziali da token separati da . - o _.
    const parts = left.split(/[.\-_]/g).filter(Boolean);
    const c = (parts[0] || left).slice(0, 1).toUpperCase();
    const d = (parts[1] || "").slice(0, 1).toUpperCase();

    // Restituisce le iniziali trovate oppure un fallback finale.
    return (c + d) || c || "—";
  }

  // Costruisce un nome visualizzato da nome/cognome oppure, in fallback, dall’email.
  function displayNameFromIdentity(firstName, lastName, email) {
    // Tenta prima la composizione classica nome + cognome.
    const full = `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
    if (full) return full;

    // Se nome e cognome non sono disponibili, usa l’email.
    const s = String(email || "").trim();
    if (!s) return "Delegato";

    const at = s.indexOf("@");
    const left = (at > 0 ? s.slice(0, at) : s).trim();

    // Trasforma i token della parte locale in una forma più leggibile.
    const parts = left.split(/[.\-_]/g).filter(Boolean);
    const nice = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

    // Restituisce il nome derivato oppure un fallback generico.
    return nice || "Delegato";
  }

  // Formatta una data API in rappresentazione breve per tabella e dettagli sintetici.
  function fmtDate(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard di pagina.
    if (!isoUtc) return "—";

    // Prova a convertire il valore API in oggetto Date tramite utility condivisa.
    const d = APL.utils.parseApiDate(isoUtc);

    // Se il parsing fallisce mantiene il placeholder.
    if (!d) return "—";

    // Restituisce la sola data in formato italiano compatto.
    return d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  // Costruisce un intervallo di validità leggibile a partire da due date UTC.
  function fmtDateRange(fromUtc, toUtc) {
    // Formatta separatamente data di inizio e data di fine.
    const a = fmtDate(fromUtc);
    const b = fmtDate(toUtc);

    // Se entrambe mancano restituisce il placeholder standard.
    if (a === "—" && b === "—") return "—";

    // Altrimenti restituisce l’intervallo completo.
    return `${a} → ${b}`;
  }

  // Determina se l’istante corrente ricade all’interno dell’intervallo di validità indicato.
  function isNowWithin(fromUtc, toUtc) {
    // Istante corrente in millisecondi.
    const now = Date.now();

    // Conversione delle date estreme in millisecondi.
    const s = APL.utils.parseApiDate(fromUtc)?.getTime() ?? NaN;
    const e = APL.utils.parseApiDate(toUtc)?.getTime() ?? NaN;

    // Se uno dei due estremi non è valido, il controllo fallisce.
    if (!Number.isFinite(s) || !Number.isFinite(e)) return false;

    // Verifica che l’istante corrente cada nell’intervallo.
    return now >= s && now <= e;
  }

  // Traduce stato e finestra temporale della delega in una label utente e in un tone visuale.
  function mapStatus(raw, startsAtUtc, endsAtUtc) {
    // Normalizza lo stato in maiuscolo per confronti stabili.
    const s = String(raw || "").toUpperCase();

    // Mappa gli stati espliciti noti verso etichette utente e tone coerenti.
    if (s === "ACTIVE") return { label: "Attiva", tone: "emerald" };
    if (s === "SUSPENDED") return { label: "Sospesa", tone: "amber" };
    if (s === "REVOKED") return { label: "Revocata", tone: "slate" };

    // Se la data finale è nel passato, considera la delega come scaduta.
    if (endsAtUtc) {
      const end = APL.utils.parseApiDate(endsAtUtc)?.getTime() ?? NaN;
      if (Number.isFinite(end) && end < Date.now()) return { label: "Scaduta", tone: "slate" };
    }

    // Se la delega ricade attualmente nell’intervallo di validità ma non ha stato noto,
    // usa una rappresentazione generica di validità.
    if (startsAtUtc && endsAtUtc && isNowWithin(startsAtUtc, endsAtUtc)) {
      return { label: raw || "Valida", tone: "blue" };
    }

    // Fallback neutro per stati inattesi o assenti.
    return { label: raw || "—", tone: "slate" };
  }

  // Costruisce una pill visuale per mostrare lo stato della delega.
  function pill(label, tone) {
    // Seleziona la combinazione di classi CSS in base al tone richiesto.
    const cls =
      tone === "emerald"
        ? "bg-emerald-50 text-emerald-700"
        : tone === "amber"
          ? "bg-amber-50 text-amber-800"
          : tone === "blue"
            ? "bg-blue-50 text-blue-700"
            : "bg-slate-100 text-slate-700";

    // Restituisce il frammento HTML pronto per essere inserito nella tabella.
    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}">${escapeHtml(label)}</span>`;
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

  // Traduce lo scope tecnico della delega in una label utente e in un insieme di chip permessi.
  function mapScope(scope) {
    // Normalizza il valore in maiuscolo per confronti stabili.
    const s = String(scope || "").toUpperCase();

    // Mappa gli scope noti a label e chip coerenti.
    if (s === "MANAGEAPPOINTMENTS") {
      return { label: "Gestione appuntamenti", chips: ["Consultazione", "Appuntamenti"] };
    }

    if (s === "MANAGEPAYMENTS") {
      return { label: "Gestione pagamenti", chips: ["Consultazione", "Pagamenti"] };
    }

    if (s === "READONLY") {
      return { label: "Consultazione", chips: ["Consultazione"] };
    }

    // Fallback per scope non previsti.
    return { label: scope || "—", chips: [scope || "—"] };
  }

  // Converte un array di permessi in HTML composto da chip visuali.
  function chipsHtml(chips) {
    // Normalizza il parametro a un array sicuro.
    const items = Array.isArray(chips) ? chips : [];

    // Se non ci sono elementi, usa un placeholder leggibile.
    if (!items.length) return "—";

    // Renderizza tutti gli elementi come chip testuali.
    return items
      .map((x) => `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${escapeHtml(x)}</span>`)
      .join(" ");
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

  // Wrapper centralizzato per richieste JSON autenticate con gestione uniforme
  // di sessione scaduta, accesso negato ed errori applicativi.
  async function requestJson(method, url, json) {
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
        const err = new Error("Sessione scaduta.");
        err.status = 401;
        throw err;
      }

      // Accesso vietato: redirect alla schermata di forbidden se disponibile.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        const err = new Error("Accesso non autorizzato.");
        err.status = 403;
        throw err;
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

  // Normalizza il payload dell’account autenticato.
  function normalizeMe(raw) {
    return {
      id: raw?.id || raw?.Id || raw?.userId || raw?.UserId || "",
      email: raw?.email || raw?.Email || "",
      role: raw?.role || raw?.Role || "",
    };
  }

  // Normalizza il payload del profilo delegato.
  function normalizeProfile(raw) {
    return {
      id: raw?.id || raw?.Id || "",
      userId: raw?.userId || raw?.UserId || "",
      firstName: raw?.firstName || raw?.FirstName || "",
      lastName: raw?.lastName || raw?.LastName || "",
      phone: raw?.phone || raw?.Phone || "",
      address: raw?.address || raw?.Address || "",
    };
  }

  // Normalizza il payload di una delega.
  function normalizeDelegation(raw) {
    return {
      id: raw?.id || raw?.Id || "",
      patientUserId: raw?.patientUserId || raw?.PatientUserId || "",
      delegateUserId: raw?.delegateUserId || raw?.DelegateUserId || "",
      scope: raw?.scope || raw?.Scope || "",
      status: raw?.status || raw?.Status || "",
      startsAtUtc: raw?.startsAtUtc || raw?.StartsAtUtc || "",
      endsAtUtc: raw?.endsAtUtc || raw?.EndsAtUtc || "",
      createdAtUtc: raw?.createdAtUtc || raw?.CreatedAtUtc || "",
    };
  }

  // Aggiorna tutta la porzione account/profilo della pagina con i dati disponibili.
  function setAccountUi(me, profile, delegationsCount, profileAvailable) {
    // Aggiorna l’avatar testuale con le iniziali ricavate da profilo o email.
    const avatar = $("avatar");
    if (avatar) {
      avatar.textContent = initialsFromIdentity(profile?.firstName, profile?.lastName, me?.email);
    }

    // Aggiorna i principali elementi testuali del riepilogo laterale.
    setText("displayName", displayNameFromIdentity(profile?.firstName, profile?.lastName, me?.email));
    setText("emailText", me?.email || "—");
    setText("userIdText", me?.id || "—");

    // Deriva lo stato locale della sessione dalla presenza del token di accesso.
    const auth = APL.session?.getAuth?.();
    const sessionOk = !!auth?.accessToken;
    setText("sessionText", sessionOk ? "Attiva" : "Non disponibile");
    setText("profileStatusText", profileAvailable ? "Configurato" : "Non disponibile");

    // Aggiorna gli input readonly della sezione principale.
    setValue("firstName", profile?.firstName || "");
    setValue("lastName", profile?.lastName || "");
    setValue("phone", profile?.phone || "");
    setValue("address", profile?.address || "");
    setValue("email", me?.email || "");
    setValue("role", me?.role || "Delegate");
    setValue("delegationsCount", String(delegationsCount ?? 0));

    // Mostra o nasconde il banner di profilo non disponibile.
    toggleHidden("profileMissingBanner", profileAvailable);
  }

  // Applica i filtri locali alle deleghe memorizzate nello stato client-side.
  function applyFilters() {
    // Legge i criteri attualmente selezionati dall’utente.
    const onlyActive = !!$("onlyActive")?.checked;
    const term = String($("searchInput")?.value || "").trim().toLowerCase();

    // Lavora su una copia del dataset per non mutare lo stato originale.
    let list = state.delegations.slice();

    // Se richiesto, mantiene solo le deleghe attive.
    if (onlyActive) {
      list = list.filter((d) => String(d.status || "").toUpperCase() === "ACTIVE");
    }

    // Applica la ricerca testuale su stato e scope della delega.
    if (term) {
      list = list.filter((d) => {
        const s = `${d.status} ${d.scope}`.toLowerCase();
        return s.includes(term);
      });
    }

    // Ordina i risultati privilegiando prima le deleghe attive,
    // poi la data di fine più prossima e infine la data di creazione più recente.
    list.sort((a, b) => {
      const aActive = String(a.status || "").toUpperCase() === "ACTIVE" ? 0 : 1;
      const bActive = String(b.status || "").toUpperCase() === "ACTIVE" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;

      const ae = APL.utils.parseApiDate(a.endsAtUtc)?.getTime() || 0;
      const be = APL.utils.parseApiDate(b.endsAtUtc)?.getTime() || 0;
      if (ae && be && ae !== be) return ae - be;

      const ac = APL.utils.parseApiDate(a.createdAtUtc)?.getTime() || 0;
      const bc = APL.utils.parseApiDate(b.createdAtUtc)?.getTime() || 0;
      return bc - ac;
    });

    // Aggiorna il sottoinsieme filtrato mantenuto nello stato client-side.
    state.filtered = list;
  }

  // Renderizza la tabella delle deleghe e gestisce lo stato vuoto.
  function renderDelegationsTable() {
    // Recupera contenitore stato vuoto e tbody della tabella.
    const empty = $("delegationsEmpty");
    const tbody = $("delegationsTbody");

    if (!tbody) return;

    // Se non esiste alcuna delega disponibile mostra lo stato vuoto principale.
    if (!state.delegations.length) {
      if (empty) empty.classList.remove("hidden");
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-600">—</td></tr>`;
      return;
    }

    // Se esistono deleghe, nasconde lo stato vuoto principale.
    if (empty) empty.classList.add("hidden");

    // Se i filtri correnti non restituiscono risultati, mostra una riga dedicata.
    if (!state.filtered.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-600">Nessun risultato con i filtri selezionati.</td></tr>`;
      return;
    }

    // Classi CSS riusabili per pulsanti e link azione.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

    // Costruisce tutte le righe della tabella.
    const rows = state.filtered.map((d, idx) => {
      const scope = mapScope(d.scope);
      const st = mapStatus(d.status, d.startsAtUtc, d.endsAtUtc);
      const valid = fmtDateRange(d.startsAtUtc, d.endsAtUtc);

      // La UI usa una label sintetica dell’assistito invece di mostrarne dati diretti.
      const label = `Assistito ${idx + 1}`;

      // Azioni rapide verso dettaglio, appuntamenti, pagamenti e referti.
      const actions = `
        <div class="inline-flex items-center gap-2 justify-end">
          <button type="button" class="${btnCls}" data-action="details" data-id="${escapeHtml(String(d.id))}">
            Dettagli
          </button>
          <a class="${btnCls}" href="./appointments.html?patientUserId=${encodeURIComponent(String(d.patientUserId))}">
            Appuntamenti
          </a>
          <a class="${btnCls}" href="./payments.html?patientUserId=${encodeURIComponent(String(d.patientUserId))}">
            Pagamenti
          </a>
          <a class="${btnCls}" href="./reports.html?patientUserId=${encodeURIComponent(String(d.patientUserId))}">
            Referti
          </a>
        </div>
      `;

      return `
        <tr>
          <td class="py-4 pr-4">
            <div class="font-medium text-slate-900">${escapeHtml(label)}</div>
            <div class="mt-1 text-xs text-slate-500">Attivo dal ${escapeHtml(fmtDate(d.startsAtUtc))}</div>
          </td>
          <td class="py-4 pr-4">
            <div class="text-slate-700">${escapeHtml(scope.label)}</div>
            <div class="mt-2 flex flex-wrap gap-1">${chipsHtml(scope.chips)}</div>
          </td>
          <td class="py-4 pr-4">${pill(st.label, st.tone)}</td>
          <td class="py-4 pr-4 text-slate-700">${escapeHtml(valid)}</td>
          <td class="py-4 text-right">${actions}</td>
        </tr>
      `;
    });

    // Sostituisce il contenuto del tbody con le nuove righe renderizzate.
    tbody.innerHTML = rows.join("");
  }

  // Mostra una modale con il dettaglio strutturato della delega selezionata.
  async function openDelegationDetails(delegationId) {
    // Verifica che l’infrastruttura modale condivisa sia pronta.
    const ok = await ensureModalReady();
    if (!ok) return;

    // Recupera la delega richiesta dal dataset completo in memoria.
    const d = state.delegations.find((x) => String(x.id) === String(delegationId));
    if (!d) return;

    // Deriva rappresentazioni leggibili per scope e stato.
    const scope = mapScope(d.scope);
    const st = mapStatus(d.status, d.startsAtUtc, d.endsAtUtc);

    // Costruisce il contenuto HTML della modale.
    const body = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Riepilogo</div>
          <div class="mt-2 grid gap-2 text-sm text-slate-700">
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-500">Stato</span>
              <span class="font-medium">${escapeHtml(st.label)}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-500">Permessi</span>
              <span class="font-medium">${escapeHtml(scope.label)}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-500">Validità</span>
              <span class="font-medium">${escapeHtml(fmtDateRange(d.startsAtUtc, d.endsAtUtc))}</span>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Riferimento delega</div>
          <div class="mt-1 text-sm font-semibold text-slate-900 break-words">${escapeHtml(String(d.id || "—"))}</div>
          <div class="mt-2 text-xs text-slate-600">Creata: ${escapeHtml(fmtDate(d.createdAtUtc))}</div>
        </div>

        <div class="text-xs text-slate-600 leading-relaxed">
          Le operazioni disponibili sono determinate dai permessi associati alla delega e dal suo periodo di validità.
        </div>
      </div>
    `;

    // Apre la modale di dettaglio con una sola azione di chiusura.
    APL.ui.modal.open({
      title: "Dettagli delega",
      bodyHtml: body,
      actions: [{ label: "Chiudi", kind: "primary", closeOnClick: true }],
    });
  }

  // Carica account, profilo delegato e deleghe dal backend, quindi sincronizza la UI.
  async function load() {
    // Riparte sempre da uno stato visivo pulito.
    clearError();
    setLoading(true);

    try {
      // Recupera e normalizza i dati dell’account autenticato.
      const me = normalizeMe(await requestJson("GET", API_ME));

      // Inizializza profilo e relativo flag di disponibilità.
      let profile = null;
      let profileAvailable = false;

      try {
        // Tenta il recupero del profilo delegato associato.
        profile = normalizeProfile(await requestJson("GET", API_PROFILE));
        profileAvailable = true;
      } catch (err) {
        // La mancanza del profilo è accettabile solo in caso di 404.
        const status = Number(err?.status || 0);
        if (status !== 404) {
          throw err;
        }
      }

      // Recupera e normalizza l’elenco delle deleghe disponibili.
      const delRaw = await requestJson("GET", API_DELEGATIONS);
      const delegations = (Array.isArray(delRaw) ? delRaw : []).map(normalizeDelegation);

      // Aggiorna lo stato client-side completo della pagina.
      state.me = me;
      state.profile = profile;
      state.profileAvailable = profileAvailable;
      state.delegations = delegations;

      // Aggiorna tutta la UI di account e profilo.
      setAccountUi(me, profile, delegations.length, profileAvailable);

      // Applica i filtri locali iniziali e renderizza la tabella.
      applyFilters();
      renderDelegationsTable();
    } catch (err) {
      // In caso di errore mostra un messaggio globale coerente.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la pagina.");
    } finally {
      // Ripristina sempre lo stato di non-caricamento a fine flusso.
      setLoading(false);
    }
  }

  // Collega tutti gli eventi della pagina ai rispettivi controlli UI.
  function wire() {
    // Collega il filtro "solo attive" al ricalcolo locale della tabella.
    const onlyActive = $("onlyActive");
    if (onlyActive) {
      onlyActive.addEventListener("change", () => {
        applyFilters();
        renderDelegationsTable();
      });
    }

    // Collega la ricerca testuale al ricalcolo locale della tabella.
    const searchInput = $("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        applyFilters();
        renderDelegationsTable();
      });
    }

    // Event delegation sulle azioni disponibili nelle righe della tabella deleghe.
    const tbody = $("delegationsTbody");
    if (tbody) {
      tbody.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-action][data-id]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        if (!id) return;

        // Apertura della modale di dettaglio della delega.
        if (action === "details") {
          await openDelegationDetails(id);
        }
      });
    }
  }

  // Inizializza la pagina account del delegato.
  // Coordina autenticazione, binding degli eventi e primo caricamento dei dati.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Delegate.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Collega gli eventi della pagina ai rispettivi controlli.
    wire();

    // Esegue il primo caricamento completo di account, profilo e deleghe.
    await load();
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
