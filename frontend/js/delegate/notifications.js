/**
 * File: frontend/js/delegate/notifications.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina notifiche dell’area
 * Delegate, comprendendo il caricamento delle deleghe disponibili,
 * la selezione dell’assistito, il recupero delle notifiche associate,
 * l’applicazione dei filtri, l’apertura del dettaglio in modale
 * e l’aggiornamento dello stato di lettura delle comunicazioni.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `notifications.html` dell’area Delegate. Coordina l’interazione tra
 * interfaccia utente, servizi API delle aree registry e notifications
 * e componenti condivisi dell’applicazione, traducendo i dati di delega
 * e notifica in una UI consultabile e operativa per il delegato autorizzato.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Delegate;
 * - recuperare le deleghe del delegato autenticato;
 * - consentire la selezione dell’assistito nel perimetro delle deleghe disponibili;
 * - recuperare le notifiche dell’assistito selezionato;
 * - applicare filtri per intervallo temporale, ordinamento, ricerca testuale
 *   e stato di lettura;
 * - aggiornare le statistiche sintetiche mostrate nella pagina;
 * - mostrare l’elenco delle notifiche in forma di card;
 * - aprire il dettaglio completo di una notifica in modale;
 * - consentire l’aggiornamento dello stato di lettura di singole notifiche;
 * - consentire la marcatura massiva come lette delle notifiche non lette;
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
 * - utilizza `APL.utils.toast()` per il feedback all’utente;
 * - utilizza utility temporali come `APL.utils.toRomeDateInputValue()`,
 *   `APL.utils.parseApiDate()`, `APL.utils.romeTodayDateInputValue()`,
 *   `APL.utils.addDaysToDateInput()` e `APL.utils.romeDateRangeToUtc()`;
 * - utilizza `APL.ui.modal.open()` per conferme e dettaglio notifiche;
 * - interagisce con gli endpoint:
 *   - `/api/registry/delegates/me/delegations`
 *   - `/api/notifications/delegates/me`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. La pagina mantiene uno stato client-side con deleghe,
 * notifiche e mappe di lookup per supportare filtro locale, rendering
 * a card, dettaglio modale, selezione dell’assistito e aggiornamento rapido
 * dello stato di lettura senza dover ricostruire continuamente il dataset lato client.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Delegate";

  // Endpoint per il recupero delle deleghe del delegato autenticato.
  const API_DELEGATIONS = "/api/registry/delegates/me/delegations";

  // Endpoint per il recupero e l’aggiornamento delle notifiche nel contesto delegato.
  const API_LIST = "/api/notifications/delegates/me";

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

  // Aggiorna lo stato di caricamento principale della vista.
  // Oltre al badge, blocca temporaneamente i controlli che alterano il filtro,
  // il dataset visualizzato o le operazioni di aggiornamento delle notifiche.
  function setLoading(loading) {
    // Mostra o nasconde il badge globale di caricamento della pagina.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Elenco dei controlli che devono essere temporaneamente disabilitati
    // per evitare richieste concorrenti o modifiche incoerenti della UI.
    const ids = [
      "btnMarkAllRead",
      "patientSelect",
      "btnReloadDelegations",
      "searchInput",
      "sortSelect",
      "fromDate",
      "toDate",
      "btnLast30",
      "btnLast90",
      "btnAll",
      "btnResetFilters",
      "btnEmptyReset",
      "onlyUnread",
    ];

    // Applica lo stato disabled a tutti i controlli effettivamente presenti.
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Aggiorna lo stato di caricamento della sola sezione deleghe.
  // Viene usato quando è necessario bloccare la selezione dell’assistito
  // durante il refresh del relativo elenco.
  function setDelegationsLoading(loading) {
    // Mostra o nasconde il badge secondario dedicato al caricamento deleghe.
    const badge = $("delLoadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Durante questo caricamento vengono bloccati solo i controlli pertinenti.
    const ids = ["patientSelect", "btnReloadDelegations"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Mostra o nasconde in modo uniforme un elemento identificato per id.
  function toggleHidden(id, hidden) {
    // Recupera il nodo DOM da aggiornare.
    const el = $(id);

    // Se il nodo non esiste non è possibile aggiornare la visibilità.
    if (!el) return;

    // Applica la classe `hidden` in base al valore richiesto.
    el.classList.toggle("hidden", !!hidden);
  }

  // Converte una data nel formato richiesto dagli input HTML usando il fuso di Roma.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formatta una data API in rappresentazione estesa per card e modali.
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

  // Formatta una data API in rappresentazione breve per statistiche e riepiloghi sintetici.
  function fmtDate(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard di pagina.
    if (!isoUtc) return "—";

    // Prova a convertire il valore API in oggetto Date tramite utility condivisa.
    const d = APL.utils.parseApiDate(isoUtc);

    // Se il parsing fallisce mantiene il placeholder.
    if (!d) return "—";

    // Restituisce la data in formato italiano compatto.
    return d.toLocaleDateString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  // Determina se lo stato della notifica corrisponde a una notifica letta.
  function isReadStatus(status) {
    return String(status || "").toLowerCase() === "read";
  }

  // Costruisce la pill visuale per stato di lettura o canale della notifica.
  function pill(label, tone) {
    // Seleziona la combinazione di classi CSS in base al tone richiesto.
    const cls =
      tone === "emerald"
        ? "bg-emerald-50 text-emerald-700"
        : tone === "blue"
          ? "bg-blue-50 text-blue-700"
          : tone === "amber"
            ? "bg-amber-50 text-amber-800"
            : tone === "red"
              ? "bg-red-50 text-red-700"
              : "bg-slate-100 text-slate-700";

    // Restituisce il frammento HTML pronto per essere inserito nella UI.
    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}">${escapeHtml(label)}</span>`;
  }

  // Riduce un testo lungo a una versione sintetica adatta alla card.
  function snippet(text, max) {
    // Normalizza spazi e valori nulli prima del troncamento.
    const s = String(text || "").trim().replace(/\s+/g, " ");

    // In assenza di contenuto restituisce il placeholder standard.
    if (!s) return "—";

    // Se il testo è già sufficientemente corto, lo restituisce integralmente.
    if (s.length <= max) return s;

    // Altrimenti tronca aggiungendo l’ellissi finale.
    return s.slice(0, max - 1) + "…";
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
  async function ensureModalReady(timeoutMs = 9000) {
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

  // Mostra o nasconde lo stato vuoto della pagina in base alla presenza di risultati.
  function emptyState(show) {
    // Recupera il pannello predisposto per lo stato vuoto.
    const box = $("emptyState");

    // Alterna la visibilità in base al valore richiesto.
    if (box) box.classList.toggle("hidden", !show);
  }

  // Normalizza il payload di una delega per gestire differenze di naming
  // tra proprietà camelCase e PascalCase provenienti dal backend.
  function normalizeDelegation(x) {
    return {
      id: x?.id || x?.Id || "",
      patientUserId: x?.patientUserId || x?.PatientUserId || "",
      delegateUserId: x?.delegateUserId || x?.DelegateUserId || "",
      scope: x?.scope || x?.Scope || "",
      status: x?.status || x?.Status || "",
      startsAtUtc: x?.startsAtUtc || x?.StartsAtUtc || "",
      endsAtUtc: x?.endsAtUtc || x?.EndsAtUtc || "",
      createdAtUtc: x?.createdAtUtc || x?.CreatedAtUtc || "",
      patientDisplayName: x?.patientDisplayName || x?.PatientDisplayName || "",
      patientFullName: x?.patientFullName || x?.PatientFullName || "",
      patientName: x?.patientName || x?.PatientName || "",
    };
  }

  // Normalizza il payload di una notifica per gestire differenze di naming
  // tra proprietà camelCase e PascalCase provenienti dal backend.
  function normalizeNotification(x) {
    return {
      id: x?.id || x?.Id || "",
      recipientUserId: x?.recipientUserId || x?.RecipientUserId || "",
      channel: x?.channel || x?.Channel || "",
      subject: x?.subject || x?.Subject || "",
      body: x?.body || x?.Body || "",
      status: x?.status || x?.Status || "",
      scheduledAtUtc: x?.scheduledAtUtc || x?.ScheduledAtUtc || "",
      sentAtUtc: x?.sentAtUtc || x?.SentAtUtc || "",
      createdAtUtc: x?.createdAtUtc || x?.CreatedAtUtc || "",
      raw: x,
    };
  }

  // Legge dalla query string l’eventuale assistito preselezionato.
  function readQueryPatientUserId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("patientUserId");
    return v ? String(v) : "";
  }

  // Sincronizza la query string con l’assistito attualmente selezionato.
  function syncQueryPatientUserId(patientUserId) {
    const q = new URLSearchParams(window.location.search || "");
    if (patientUserId) q.set("patientUserId", patientUserId);
    else q.delete("patientUserId");

    const next = `${window.location.pathname}${q.toString() ? `?${q.toString()}` : ""}`;
    window.history.replaceState({}, "", next);
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

  // Stabilisce se la delega selezionata consente la consultazione delle notifiche.
  function canReadNotifications(d) {
    return isDelegationActiveNow(d);
  }

  // Costruisce la label utente da mostrare per una delega nell’elenco assistiti.
  function labelForDelegation(d, idx) {
    return String(d.patientDisplayName || d.patientFullName || d.patientName || `Assistito ${idx + 1}`);
  }

  // Aggiorna i blocchi contestuali della UI dipendenti dallo stato della delega selezionata.
  function updateDelegationUI() {
    const hint = $("delegationHint");
    if (!hint) return;

    toggleHidden("permissionBox", true);

    // Nessuna delega disponibile: la pagina resta in stato informativo.
    if (!state.delegations.length) {
      hint.textContent = "Al momento non risultano assistiti associati al Suo account.";
      return;
    }

    // Nessun assistito ancora scelto: invita alla selezione.
    if (!state.patientUserId || !state.selectedDelegation) {
      hint.textContent = "Selezioni un assistito per visualizzare l’elenco delle notifiche.";
      return;
    }

    // Delega non attiva: espone un messaggio di permesso non disponibile.
    if (!canReadNotifications(state.selectedDelegation)) {
      hint.textContent = "La delega selezionata non risulta attiva in questo momento.";
      toggleHidden("permissionBox", false);
      const permissionText = $("permissionText");
      if (permissionText) {
        permissionText.textContent = "La consultazione delle notifiche non è disponibile per l’assistito selezionato.";
      }
      return;
    }

    // Delega valida: espone il messaggio operativo standard della pagina.
    hint.textContent = "È possibile consultare e aggiornare lo stato di lettura delle notifiche dell’assistito selezionato.";
  }

  // Traduce i valori presenti negli input data in un intervallo temporale confrontabile lato client.
  function parseDateInputRange() {
    // Legge i due estremi temporali impostati dall’utente.
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    // Costruisce il range UTC solo se le due date sono valorizzate e coerenti.
    const range = from && to && to >= from ? APL.utils.romeDateRangeToUtc(from, to) : null;

    return {
      fromMs: range?.fromUtc ? APL.utils.parseApiDate(range.fromUtc)?.getTime() ?? null : null,
      toMs: range?.toUtc ? APL.utils.parseApiDate(range.toUtc)?.getTime() ?? null : null,
    };
  }

  // Applica i filtri client-side sul dataset delle notifiche già caricato dal backend.
  function applyClientFilters(items) {
    // Legge i criteri attualmente selezionati dall’utente.
    const term = String($("searchInput")?.value || "").trim().toLowerCase();
    const sort = String($("sortSelect")?.value || "NEWEST").toUpperCase();
    const onlyUnread = !!$("onlyUnread")?.checked;

    const { fromMs, toMs } = parseDateInputRange();

    // Lavora su una copia del dataset per non mutare lo stato originale.
    let list = Array.isArray(items) ? items.slice() : [];

    // Se richiesto, mantiene solo le notifiche non lette.
    if (onlyUnread) {
      list = list.filter((n) => !isReadStatus(n.status));
    }

    // Applica la ricerca testuale su oggetto e corpo della notifica.
    if (term) {
      list = list.filter((n) => {
        const hay = `${n.subject || ""} ${n.body || ""}`.toLowerCase();
        return hay.includes(term);
      });
    }

    // Applica il filtro temporale sui timestamp di schedulazione o creazione.
    if (fromMs != null || toMs != null) {
      list = list.filter((n) => {
        const t = new Date(n.scheduledAtUtc || n.createdAtUtc || 0).getTime();
        if (!Number.isFinite(t)) return false;
        if (fromMs != null && t < fromMs) return false;
        if (toMs != null && t > toMs) return false;
        return true;
      });
    }

    // Ordina la lista in base alla preferenza temporale selezionata.
    list.sort((a, b) => {
      const ta = new Date(a.scheduledAtUtc || a.createdAtUtc || 0).getTime();
      const tb = new Date(b.scheduledAtUtc || b.createdAtUtc || 0).getTime();
      return sort === "OLDEST" ? ta - tb : tb - ta;
    });

    return list;
  }

  // Aggiorna i riquadri statistici mostrati nella pagina.
  // Le statistiche sono calcolate sull’intero dataset caricato per l’assistito.
  function setStats(all) {
    const total = Array.isArray(all) ? all.length : 0;
    const unread = (Array.isArray(all) ? all : []).filter((n) => !isReadStatus(n.status)).length;

    let latest = "—";
    const byDate = (Array.isArray(all) ? all : [])
      .slice()
      .sort((a, b) => new Date(b.scheduledAtUtc || b.createdAtUtc || 0) - new Date(a.scheduledAtUtc || a.createdAtUtc || 0));

    if (byDate.length) {
      latest = fmtDate(byDate[0].scheduledAtUtc || byDate[0].createdAtUtc);
    }

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statUnread")) $("statUnread").textContent = String(unread);
    if ($("statLatest")) $("statLatest").textContent = String(latest);
  }

  // Renderizza la lista delle notifiche sotto forma di card
  // e aggiorna stato vuoto, placeholder e statistiche.
  function renderList(all, shown) {
    const host = $("listHost");
    if (!host) return;

    setStats(all);

    // Se non è stato ancora selezionato un assistito, mostra un placeholder contestuale.
    if (!state.patientUserId) {
      emptyState(false);
      host.innerHTML = `<div class="py-8 text-center text-slate-600">Selezioni un assistito per iniziare.</div>`;
      return;
    }

    // Se la delega non è leggibile in questo momento, blocca la consultazione.
    if (state.selectedDelegation && !canReadNotifications(state.selectedDelegation)) {
      emptyState(false);
      host.innerHTML = `<div class="py-8 text-center text-slate-600">La delega selezionata non consente la consultazione delle notifiche in questo momento.</div>`;
      return;
    }

    // Se non ci sono risultati dopo i filtri, mostra lo stato vuoto dedicato.
    if (!shown.length) {
      emptyState(true);
      host.innerHTML = "";
      return;
    }

    // In presenza di dati nasconde lo stato vuoto.
    emptyState(false);

    const cards = shown.map((n) => {
      const unread = !isReadStatus(n.status);
      const when = fmtDateTime(n.scheduledAtUtc || n.createdAtUtc);
      const subj = n.subject || "Comunicazione";
      const body = snippet(n.body, 220);

      const leftPill = unread ? pill("Non letta", "blue") : pill("Letta", "emerald");
      const channel = n.channel ? pill(n.channel, "slate") : "";

      const btnCls =
        "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

      const markBtn = unread
        ? `<button type="button" class="${btnCls}" data-action="read" data-id="${escapeHtml(String(n.id))}">Segna come letta</button>`
        : "";

      return `
        <div class="rounded-2xl border bg-white p-5 hover:bg-slate-50 transition-colors">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                ${leftPill}
                ${channel}
                <span class="text-xs text-slate-500">${escapeHtml(when)}</span>
              </div>
              <div class="mt-2 text-sm font-semibold text-slate-900 truncate" title="${escapeHtml(subj)}">${escapeHtml(subj)}</div>
              <div class="mt-2 text-sm text-slate-700 leading-relaxed">${escapeHtml(body)}</div>
            </div>

            <div class="flex flex-col sm:flex-row items-end sm:items-center gap-2">
              <button type="button" class="${btnCls}" data-action="open" data-id="${escapeHtml(String(n.id))}">
                Apri
              </button>
              ${markBtn}
            </div>
          </div>
        </div>
      `;
    });

    // Sostituisce il contenuto corrente con l’elenco di card appena renderizzato.
    host.innerHTML = cards.join("");
  }

  // Mostra una modale con il dettaglio completo della notifica selezionata.
  async function openNotificationModal(n) {
    // Verifica che l’infrastruttura modale condivisa sia pronta.
    const ok = await ensureModalReady();
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    // Costruisce le informazioni principali della notifica per il dettaglio.
    const unread = !isReadStatus(n.status);
    const when = fmtDateTime(n.scheduledAtUtc || n.createdAtUtc);
    const subj = n.subject || "Comunicazione";

    // Costruisce il contenuto HTML della modale con dati sintetici e corpo completo.
    const body = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Data</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(when)}</div>
          <div class="mt-2 text-xs text-slate-600">Stato: ${escapeHtml(unread ? "Non letta" : "Letta")}</div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Oggetto</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(subj)}</div>
        </div>

        <div>
          <div class="text-xs font-medium text-slate-500">Messaggio</div>
          <pre class="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800 leading-relaxed rounded-2xl border bg-white p-4 max-h-[52vh] overflow-auto">${escapeHtml(n.body || "")}</pre>
        </div>
      </div>
    `;

    // Restituisce una promise che consente al chiamante di attendere
    // la chiusura della modale ed eventuali aggiornamenti di stato.
    return await new Promise((resolve) => {
      const actions = [];

      // Se la notifica non è ancora letta, offre l’azione rapida di marcatura.
      if (unread) {
        actions.push({
          label: "Segna come letta",
          kind: "primary",
          closeOnClick: true,
          onClick: async () => {
            try {
              await markAsRead(n.id);
              resolve(true);
            } catch (_) {
              resolve(false);
            }
          },
        });
      }

      actions.push({ label: "Chiudi", kind: unread ? "secondary" : "primary", closeOnClick: true });

      APL.ui.modal.open({
        title: "Notifica assistito",
        bodyHtml: body,
        actions,
      });
    });
  }

  // Aggiorna lato backend lo stato di lettura di una singola notifica
  // e mantiene coerente la copia locale se già presente in memoria.
  async function markAsRead(notificationId) {
    const patientUserId = String(state.patientUserId || "").trim();
    if (!patientUserId) return;

    const params = new URLSearchParams();
    params.set("patientUserId", patientUserId);

    await apiJson("POST", `${API_LIST}/${encodeURIComponent(String(notificationId))}/read?${params.toString()}`);

    const local = state.byId.get(String(notificationId));
    if (local) {
      local.status = "Read";
      state.byId.set(String(notificationId), local);
    }
  }

  // Applica uno dei preset temporali disponibili nella UI.
  function applyQuickRange(kind) {
    // Recupera i due input data che rappresentano il filtro temporale.
    const fromEl = $("fromDate");
    const toEl = $("toDate");
    if (!fromEl || !toEl) return;

    // Data odierna nel fuso di Roma usata come estremo superiore.
    const today = APL.utils.romeTodayDateInputValue();

    // Preset ultimi 30 giorni.
    if (kind === "last30") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -30);
      toEl.value = today;
    } else if (kind === "last90") {
      // Preset ultimi 90 giorni.
      fromEl.value = APL.utils.addDaysToDateInput(today, -90);
      toEl.value = today;
    } else if (kind === "all") {
      // Preset senza limitazione temporale esplicita.
      fromEl.value = "";
      toEl.value = "";
    }
  }

  // Ripristina i filtri della pagina ai valori predefiniti.
  function resetFilters() {
    // Azzera la ricerca testuale.
    $("searchInput").value = "";

    // Ripristina l’ordinamento alla modalità standard.
    $("sortSelect").value = "NEWEST";

    // Disattiva il filtro “solo non lette”.
    $("onlyUnread").checked = false;

    // Reimposta il range temporale predefinito agli ultimi 90 giorni.
    applyQuickRange("last90");
  }

  // Rigenera le opzioni della select degli assistiti in base alle deleghe disponibili.
  function renderDelegationOptions(select, list) {
    select.innerHTML = "";

    // Inserisce sempre un placeholder iniziale non selezionabile implicitamente.
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selezionare un assistito...";
    select.appendChild(placeholder);

    if (!list.length) {
      return;
    }

    // Costruisce ogni opzione indicando se la delega non è attiva.
    list.forEach((d, idx) => {
      const active = isDelegationActiveNow(d);
      const suffix = active ? "" : " — non attiva";

      const opt = document.createElement("option");
      opt.value = String(d.patientUserId || "");
      opt.textContent = `${labelForDelegation(d, idx)}${suffix}`;
      select.appendChild(opt);
    });
  }

  // Carica l’elenco delle deleghe disponibili per il delegato autenticato
  // e aggiorna il contesto iniziale dell’assistito selezionabile.
  async function loadDelegations() {
    clearError();
    setDelegationsLoading(true);

    try {
      const data = await apiJson("GET", API_DELEGATIONS);
      const list = (Array.isArray(data) ? data : []).map(normalizeDelegation);

      state.delegations = list;

      const select = $("patientSelect");
      if (!select) return;

      renderDelegationOptions(select, list);

      // In assenza di deleghe, azzera il contesto e svuota la vista notifiche.
      if (!list.length) {
        state.patientUserId = "";
        state.selectedDelegation = null;
        syncQueryPatientUserId("");
        updateDelegationUI();
        await loadNotifications();
        return;
      }

      const queryPatientUserId = readQueryPatientUserId();
      const fromQuery = list.find((x) => String(x.patientUserId) === queryPatientUserId) || null;

      // Se la query string individua un assistito valido, lo preseleziona.
      if (fromQuery) {
        state.patientUserId = String(fromQuery.patientUserId || "");
        state.selectedDelegation = fromQuery;
        select.value = state.patientUserId;
      } else {
        // Altrimenti mantiene la pagina in attesa di selezione esplicita.
        state.patientUserId = "";
        state.selectedDelegation = null;
        select.value = "";
      }

      // Allinea URL, hint contestuali e lista notifiche al nuovo contesto.
      syncQueryPatientUserId(state.patientUserId);
      updateDelegationUI();
      await loadNotifications();
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare le deleghe.");
    } finally {
      setDelegationsLoading(false);
    }
  }

  // Carica le notifiche dell’assistito selezionato,
  // aggiorna lo stato locale e rigenera la lista filtrata.
  async function loadNotifications() {
    clearError();
    setLoading(true);

    try {
      // Se nessun assistito è selezionato, ripristina la vista in stato iniziale.
      if (!state.patientUserId) {
        state.all = [];
        state.shown = [];
        state.byId = new Map();
        renderList([], []);
        return;
      }

      // Se la delega non è leggibile, mostra una vista vuota coerente con il contesto.
      if (state.selectedDelegation && !canReadNotifications(state.selectedDelegation)) {
        state.all = [];
        state.shown = [];
        state.byId = new Map();
        renderList([], []);
        return;
      }

      const params = new URLSearchParams();
      params.set("patientUserId", state.patientUserId);

      const data = await apiJson("GET", `${API_LIST}?${params.toString()}`);
      const list = (Array.isArray(data) ? data : []).map(normalizeNotification);

      state.all = list;
      state.byId = new Map(list.filter((x) => x.id).map((x) => [String(x.id), x]));
      state.shown = applyClientFilters(state.all);

      renderList(state.all, state.shown);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare le notifiche dell’assistito.");
      const host = $("listHost");
      if (host) host.innerHTML = `<div class="py-8 text-center text-slate-600">—</div>`;
      emptyState(false);
    } finally {
      setLoading(false);
    }
  }

  // Marca come lette tutte le notifiche non ancora lette dell’assistito selezionato.
  async function markAllAsRead() {
    const unread = state.all.filter((n) => !isReadStatus(n.status));
    if (!unread.length) {
      APL.utils.toast("Non ci sono notifiche da aggiornare.", "info");
      return;
    }

    const ok = await confirmAction(
      "Conferma operazione",
      "Vuole contrassegnare come lette tutte le notifiche non lette dell’assistito selezionato?",
      "Conferma"
    );
    if (!ok) return;

    setLoading(true);
    clearError();

    try {
      // Esegue l’aggiornamento una notifica alla volta, tollerando eventuali errori singoli.
      for (const n of unread) {
        try {
          await markAsRead(n.id);
        } catch (_) { }
      }

      APL.utils.toast("Notifiche aggiornate.", "success");
      await loadNotifications();
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
      await loadNotifications();
    } finally {
      setLoading(false);
    }
  }

  // Collega tutti gli eventi della pagina ai rispettivi controlli UI.
  function wireEvents() {
    const btnReloadDelegations = $("btnReloadDelegations");
    if (btnReloadDelegations) {
      btnReloadDelegations.addEventListener("click", loadDelegations);
    }

    // Cambio dell’assistito selezionato con aggiornamento della query string
    // e ricaricamento completo del contesto operativo.
    const patientSelect = $("patientSelect");
    if (patientSelect) {
      patientSelect.addEventListener("change", async () => {
        state.patientUserId = String(patientSelect.value || "").trim();
        state.selectedDelegation =
          state.delegations.find((x) => String(x.patientUserId) === state.patientUserId) || null;

        syncQueryPatientUserId(state.patientUserId);
        updateDelegationUI();
        await loadNotifications();
      });
    }

    // Azione massiva di aggiornamento dello stato di lettura.
    const btnMarkAll = $("btnMarkAllRead");
    if (btnMarkAll) btnMarkAll.addEventListener("click", markAllAsRead);

    // Preset temporali rapidi applicati localmente sul dataset già in memoria.
    const btnLast30 = $("btnLast30");
    if (btnLast30) {
      btnLast30.addEventListener("click", () => {
        applyQuickRange("last30");
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    const btnLast90 = $("btnLast90");
    if (btnLast90) {
      btnLast90.addEventListener("click", () => {
        applyQuickRange("last90");
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    const btnAll = $("btnAll");
    if (btnAll) {
      btnAll.addEventListener("click", () => {
        applyQuickRange("all");
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    // Reset dei filtri dalla toolbar principale.
    const btnReset = $("btnResetFilters");
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        resetFilters();
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    // Reset dei filtri dallo stato vuoto.
    const btnEmptyReset = $("btnEmptyReset");
    if (btnEmptyReset) {
      btnEmptyReset.addEventListener("click", () => {
        resetFilters();
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    // Filtro “solo non lette” applicato localmente sul dataset già in memoria.
    const onlyUnread = $("onlyUnread");
    if (onlyUnread) {
      onlyUnread.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    // La modifica dell’intervallo temporale aggiorna il rendering locale della lista.
    const fromDate = $("fromDate");
    const toDate = $("toDate");
    if (fromDate) {
      fromDate.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }
    if (toDate) {
      toDate.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    // L’ordinamento viene applicato localmente sul dataset già disponibile.
    const sort = $("sortSelect");
    if (sort) {
      sort.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    // Ricerca testuale applicata localmente sul dataset già in memoria.
    const search = $("searchInput");
    if (search) {
      search.addEventListener("input", () => {
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    // Event delegation sulle azioni delle card notifica.
    const host = $("listHost");
    if (host) {
      host.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-action][data-id]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        if (!id) return;

        const n = state.byId.get(String(id));
        if (!n) return;

        if (action === "read") {
          if (isReadStatus(n.status)) return;
          setLoading(true);
          try {
            await markAsRead(id);
            APL.utils.toast("Notifica aggiornata.", "success");
            await loadNotifications();
          } catch (err) {
            APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
          } finally {
            setLoading(false);
          }
          return;
        }

        if (action === "open") {
          await openNotificationModal(n);
          await loadNotifications();
        }
      });
    }
  }

  // Stato locale della pagina usato per conservare deleghe, assistito selezionato,
  // dataset completo delle notifiche, sottoinsieme filtrato e mappa di lookup rapido.
  const state = {
    delegations: [],
    selectedDelegation: null,
    patientUserId: "",
    all: [],
    shown: [],
    byId: new Map(),
  };

  // Inizializza la pagina notifiche.
  // Coordina autenticazione, preset iniziali, binding degli eventi e primo caricamento.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Delegate.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Applica il filtro temporale iniziale agli ultimi 90 giorni.
    applyQuickRange("last90");

    // Collega gli eventi della pagina ai rispettivi controlli.
    wireEvents();

    // Esegue il primo caricamento dell’elenco deleghe e del relativo contesto notifiche.
    await loadDelegations();
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
