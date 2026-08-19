/**
 * File: frontend/js/patient/notifications.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina notifiche dell’area
 * Patient, comprendendo il caricamento delle comunicazioni del paziente,
 * l’applicazione dei filtri temporali e testuali, l’ordinamento dei
 * risultati, il rendering dell’elenco, l’apertura del dettaglio di una
 * notifica e l’aggiornamento dello stato di lettura dei messaggi.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `notifications.html`. Coordina l’interazione tra interfaccia utente,
 * servizi API dell’area notifications e componenti condivisi
 * dell’applicazione, traducendo l’elenco delle notifiche restituite dal
 * backend in una vista consultabile, filtrabile e operativamente gestibile
 * dal paziente.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Patient;
 * - recuperare le notifiche del paziente autenticato;
 * - applicare filtri per intervallo temporale, ricerca testuale,
 *   ordinamento e stato di lettura;
 * - aggiornare le statistiche sintetiche mostrate nella pagina;
 * - renderizzare l’elenco delle notifiche e lo stato vuoto;
 * - aprire il contenuto completo di una notifica in modale;
 * - consentire la marcatura come letta di una singola notifica;
 * - consentire la marcatura massiva di tutte le notifiche non lette;
 * - gestire loading, errori globali e feedback all’utente.
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
 * - interagisce con l’endpoint `/api/notifications/patients/me`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. Le notifiche vengono mantenute in uno stato locale
 * client-side per supportare filtro, ordinamento, rendering dell’elenco
 * e lookup rapido per id senza dover interrogare nuovamente il backend
 * a ogni modifica dei controlli di visualizzazione.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Patient";

  // Endpoint per il recupero e l’aggiornamento delle notifiche del paziente autenticato.
  const API_LIST = "/api/notifications/patients/me";

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

  // Aggiorna lo stato di caricamento della vista.
  // Oltre al badge, blocca temporaneamente i controlli che alterano il filtro
  // o avviano operazioni di aggiornamento sulle notifiche.
  function setLoading(loading) {
    // Mostra o nasconde il badge globale di caricamento della pagina.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Elenco dei controlli che devono essere temporaneamente disabilitati
    // per evitare richieste concorrenti o modifiche incoerenti della UI.
    const ids = [
      "btnMarkAllRead",
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

  // Converte una data nel formato richiesto dagli input HTML usando il fuso di Roma.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formatta una data API in rappresentazione estesa per elenco e modali.
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

  // Formatta una data API in rappresentazione breve per le statistiche.
  function fmtDate(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard di pagina.
    if (!isoUtc) return "—";

    // Prova a convertire il valore API in oggetto Date tramite utility condivisa.
    const d = APL.utils.parseApiDate(isoUtc);

    // Se il parsing fallisce mantiene il placeholder.
    if (!d) return "—";

    // Restituisce la sola data in formato italiano compatto.
    return d.toLocaleDateString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  // Determina se lo stato della notifica deve essere considerato "letto".
  function isReadStatus(status) {
    // Normalizza il valore e confronta con la rappresentazione attesa dal dominio.
    return String(status || "").toLowerCase() === "read";
  }

  // Costruisce una pill visuale per rappresentare lo stato o il canale della notifica.
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

  // Produce un’anteprima sintetica del contenuto testuale della notifica.
  function snippet(text, max) {
    // Normalizza spazi e contenuto per evitare anteprime irregolari.
    const s = String(text || "").trim().replace(/\s+/g, " ");

    // In assenza di testo restituisce il placeholder standard.
    if (!s) return "—";

    // Se il testo rientra già nella lunghezza richiesta lo restituisce integralmente.
    if (s.length <= max) return s;

    // In caso contrario tronca e aggiunge l’ellissi finale.
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

  // Legge l’intervallo temporale selezionato e lo converte in estremi millisecondo.
  // Il filtro temporale viene poi applicato client-side sul dataset già caricato.
  function parseDateInputRange() {
    // Recupera le due date inserite dall’utente nei controlli di filtro.
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();

    // Costruisce il range UTC solo quando entrambe le date sono valorizzate e coerenti.
    const range = from && to && to >= from ? APL.utils.romeDateRangeToUtc(from, to) : null;

    // Converte gli estremi UTC in millisecondi per confronti rapidi durante il filtering.
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

    // Determina gli estremi temporali attivi, se presenti.
    const { fromMs, toMs } = parseDateInputRange();

    // Lavora su una copia del dataset per non mutare lo stato originale.
    let list = Array.isArray(items) ? items.slice() : [];

    // Applica il filtro opzionale sulle sole notifiche non lette.
    if (onlyUnread) {
      list = list.filter((n) => !isReadStatus(n.status));
    }

    // Applica la ricerca testuale su oggetto e corpo del messaggio.
    if (term) {
      list = list.filter((n) => {
        const hay = `${n.subject || ""} ${n.body || ""}`.toLowerCase();
        return hay.includes(term);
      });
    }

    // Applica il filtro per intervallo temporale confrontando scheduledAt o createdAt.
    if (fromMs != null || toMs != null) {
      list = list.filter((n) => {
        const t = new Date(n.scheduledAtUtc || n.createdAtUtc || 0).getTime();
        if (!Number.isFinite(t)) return false;
        if (fromMs != null && t < fromMs) return false;
        if (toMs != null && t > toMs) return false;
        return true;
      });
    }

    // Ordina il risultato in ordine crescente o decrescente in base alla selezione utente.
    list.sort((a, b) => {
      const ta = new Date(a.scheduledAtUtc || a.createdAtUtc || 0).getTime();
      const tb = new Date(b.scheduledAtUtc || b.createdAtUtc || 0).getTime();
      return sort === "OLDEST" ? ta - tb : tb - ta;
    });

    return list;
  }

  // Aggiorna i riquadri statistici mostrati nella pagina.
  function setStats(all, shown) {
    // Calcola il totale complessivo delle notifiche caricate.
    const total = Array.isArray(all) ? all.length : 0;

    // Calcola il totale delle notifiche non lette sull’intero dataset caricato.
    const unread = (Array.isArray(all) ? all : []).filter((n) => !isReadStatus(n.status)).length;

    // Individua la data della notifica più recente.
    let latest = "—";
    const byDate = (Array.isArray(all) ? all : [])
      .slice()
      .sort((a, b) => new Date(b.scheduledAtUtc || b.createdAtUtc || 0) - new Date(a.scheduledAtUtc || a.createdAtUtc || 0));
    if (byDate.length) latest = fmtDate(byDate[0].scheduledAtUtc || byDate[0].createdAtUtc);

    // Aggiorna i tre indicatori sintetici presenti nella vista.
    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statUnread")) $("statUnread").textContent = String(unread);
    if ($("statLatest")) $("statLatest").textContent = String(latest);
  }

  // Renderizza l’elenco delle notifiche e aggiorna stato vuoto e statistiche.
  function renderList(all, shown) {
    // Recupera il contenitore che ospita dinamicamente le card della lista.
    const host = $("listHost");
    if (!host) return;

    // Aggiorna i contatori sintetici in testa alla pagina.
    setStats(all, shown);

    // Se non ci sono elementi da mostrare, attiva lo stato vuoto e svuota la lista.
    if (!shown.length) {
      emptyState(true);
      host.innerHTML = "";
      return;
    }

    // In presenza di risultati nasconde lo stato vuoto.
    emptyState(false);

    // Costruisce tutte le card HTML partendo dalle notifiche filtrate.
    const cards = shown.map((n) => {
      const unread = !isReadStatus(n.status);
      const when = fmtDateTime(n.scheduledAtUtc || n.createdAtUtc);
      const subj = n.subject || "Comunicazione";
      const body = snippet(n.body, 220);

      // Pill principale per stato di lettura e secondaria per eventuale canale.
      const leftPill = unread ? pill("Non letta", "blue") : pill("Letta", "emerald");
      const channel = n.channel ? pill(n.channel, "slate") : "";

      // Classi CSS riusabili per i pulsanti azione presenti nella card.
      const btnCls =
        "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

      // Il pulsante "Segna come letta" viene mostrato solo per notifiche non lette.
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

    // Sostituisce il contenuto del contenitore con le card appena generate.
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

    // Deriva le informazioni di riepilogo utili alla modale.
    const unread = !isReadStatus(n.status);
    const when = fmtDateTime(n.scheduledAtUtc || n.createdAtUtc);
    const subj = n.subject || "Comunicazione";

    // Costruisce il contenuto HTML della modale con data, stato, oggetto e messaggio.
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

    // Restituisce una promise che si risolve in base alle azioni eseguite nella modale.
    return await new Promise((resolve) => {
      const actions = [];

      // Se la notifica è non letta, offre anche l’azione di marcatura come letta.
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

      // Aggiunge sempre l’azione di chiusura della modale.
      actions.push({ label: "Chiudi", kind: unread ? "secondary" : "primary", closeOnClick: true });

      // Apre la modale di dettaglio.
      APL.ui.modal.open({
        title: "Notifica",
        bodyHtml: body,
        actions,
      });
    });
  }

  // Marca come letta una singola notifica e aggiorna anche lo stato client-side locale.
  async function markAsRead(notificationId) {
    // Invia la richiesta al backend per aggiornare lo stato della notifica.
    await apiJson("POST", `${API_LIST}/${encodeURIComponent(String(notificationId))}/read`);

    // Aggiorna la copia locale dell’elemento, se presente in cache.
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

    // Se i controlli non sono presenti non è possibile applicare il preset.
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

    // Ripristina l’ordinamento ai più recenti.
    $("sortSelect").value = "NEWEST";

    // Disattiva il filtro sulle sole non lette.
    $("onlyUnread").checked = false;

    // Reimposta il range temporale predefinito agli ultimi 90 giorni.
    applyQuickRange("last90");
  }

  // Carica le notifiche dal backend, aggiorna lo stato locale e rigenera la vista.
  async function loadNotifications() {
    // Riparte sempre da uno stato visivo pulito.
    clearError();
    setLoading(true);

    try {
      // Legge il filtro server-side relativo alle sole notifiche non lette.
      const onlyUnread = !!$("onlyUnread")?.checked;

      // Costruisce i parametri di query da inviare al backend.
      const params = new URLSearchParams();
      params.set("onlyUnread", onlyUnread ? "true" : "false");

      // Recupera il dataset delle notifiche dal backend.
      const data = await apiJson("GET", `${API_LIST}?${params.toString()}`);

      // Normalizza il payload ricevuto.
      const list = (Array.isArray(data) ? data : []).map(normalizeNotification);

      // Aggiorna lo stato client-side principale.
      state.all = list;
      state.byId = new Map(list.filter((x) => x.id).map((x) => [String(x.id), x]));

      // Applica i filtri client-side correnti e renderizza la lista.
      state.shown = applyClientFilters(state.all);
      renderList(state.all, state.shown);
    } catch (err) {
      // In caso di errore mostra un messaggio globale e un placeholder minimo nella lista.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare le notifiche.");
      const host = $("listHost");
      if (host) host.innerHTML = `<div class="py-10 text-center text-slate-600">—</div>`;
      emptyState(false);
    } finally {
      // Ripristina sempre lo stato di non-caricamento a fine flusso.
      setLoading(false);
    }
  }

  // Marca come lette tutte le notifiche non ancora lette presenti nello stato locale.
  async function markAllAsRead() {
    // Seleziona il sottoinsieme delle notifiche che richiedono ancora aggiornamento.
    const unread = state.all.filter((n) => !isReadStatus(n.status));

    // Se non ci sono notifiche da aggiornare informa l’utente e interrompe il flusso.
    if (!unread.length) {
      APL.utils.toast("Non ci sono notifiche da aggiornare.", "info");
      return;
    }

    // Richiede una conferma esplicita prima dell’operazione massiva.
    const ok = await confirmAction(
      "Conferma operazione",
      "Vuole contrassegnare come lette tutte le notifiche non lette?",
      "Conferma"
    );
    if (!ok) return;

    // Attiva loading e pulisce eventuali errori precedenti.
    setLoading(true);
    clearError();

    try {
      // Aggiorna una per una le notifiche non lette.
      for (const n of unread) {
        try {
          await markAsRead(n.id);
        } catch (_) { }
      }

      // Notifica l’utente e ricarica la vista per riallineare lo stato complessivo.
      APL.utils.toast("Notifiche aggiornate.", "success");
      await loadNotifications();
    } catch (err) {
      // In caso di errore mostra feedback coerente e ricarica comunque la vista.
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
      await loadNotifications();
    } finally {
      // Ripristina lo stato visuale di non-caricamento.
      setLoading(false);
    }
  }

  // Collega tutti gli eventi della pagina ai rispettivi controlli UI.
  function wireEvents() {
    // Azione massiva di marcatura come lette.
    const btnMarkAll = $("btnMarkAllRead");
    if (btnMarkAll) btnMarkAll.addEventListener("click", markAllAsRead);

    // Preset temporali rapidi con ricalcolo della vista o ricaricamento dati.
    const btnLast30 = $("btnLast30");
    if (btnLast30) btnLast30.addEventListener("click", () => { applyQuickRange("last30"); loadNotifications(); });

    const btnLast90 = $("btnLast90");
    if (btnLast90) btnLast90.addEventListener("click", () => { applyQuickRange("last90"); loadNotifications(); });

    const btnAll = $("btnAll");
    if (btnAll) btnAll.addEventListener("click", () => { applyQuickRange("all"); loadNotifications(); });

    // Reset dei filtri dalla toolbar principale.
    const btnReset = $("btnResetFilters");
    if (btnReset) btnReset.addEventListener("click", () => { resetFilters(); loadNotifications(); });

    // Reset dei filtri dallo stato vuoto.
    const btnEmptyReset = $("btnEmptyReset");
    if (btnEmptyReset) btnEmptyReset.addEventListener("click", () => { resetFilters(); loadNotifications(); });

    // Il filtro onlyUnread viene gestito con un nuovo caricamento dal backend.
    const onlyUnread = $("onlyUnread");
    if (onlyUnread) onlyUnread.addEventListener("change", loadNotifications);

    // I filtri data operano client-side sul dataset già caricato.
    const fromDate = $("fromDate");
    const toDate = $("toDate");
    if (fromDate) fromDate.addEventListener("change", () => { state.shown = applyClientFilters(state.all); renderList(state.all, state.shown); });
    if (toDate) toDate.addEventListener("change", () => { state.shown = applyClientFilters(state.all); renderList(state.all, state.shown); });

    // L’ordinamento opera client-side sul dataset già caricato.
    const sort = $("sortSelect");
    if (sort) sort.addEventListener("change", () => { state.shown = applyClientFilters(state.all); renderList(state.all, state.shown); });

    // La ricerca testuale opera client-side sul dataset già caricato.
    const search = $("searchInput");
    if (search) {
      search.addEventListener("input", () => {
        state.shown = applyClientFilters(state.all);
        renderList(state.all, state.shown);
      });
    }

    // Event delegation sulle azioni disponibili nelle card della lista.
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

        // Marcatura come letta direttamente dalla card.
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

        // Apertura della modale di dettaglio e successivo riallineamento della lista.
        if (action === "open") {
          await openNotificationModal(n);
          await loadNotifications();
          return;
        }
      });
    }
  }

  // Stato locale della pagina usato per conservare dataset, sottoinsieme filtrato
  // e mappa di lookup rapido per notifiche.
  const state = {
    all: [],
    shown: [],
    byId: new Map(),
  };

  // Inizializza la pagina notifiche.
  // Coordina autenticazione, preset iniziali, binding degli eventi e primo caricamento.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Patient.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Applica il filtro temporale iniziale agli ultimi 3 mesi.
    applyQuickRange("last90");

    // Collega gli eventi della pagina ai rispettivi controlli.
    wireEvents();

    // Esegue il primo caricamento completo del dataset.
    await loadNotifications();
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
