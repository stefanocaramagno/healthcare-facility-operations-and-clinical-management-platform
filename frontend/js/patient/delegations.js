/**
 * File: frontend/js/patient/delegations.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina deleghe dell’area
 * Patient, comprendendo il caricamento delle deleghe associate al
 * paziente, l’applicazione dei filtri di ricerca e stato, il rendering
 * tabellare dei risultati, l’apertura del dettaglio di una delega e
 * l’aggiornamento dell’ambito operativo direttamente dalla tabella.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `delegations.html`. Coordina l’interazione tra interfaccia utente,
 * servizi API dell’area registry e componenti condivisi
 * dell’applicazione, traducendo le deleghe restituite dal backend in una
 * vista consultabile, filtrabile e parzialmente aggiornabile dal
 * paziente.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Patient;
 * - recuperare i dati sintetici dell’utente autenticato;
 * - recuperare le deleghe registrate per il paziente;
 * - applicare filtri per ricerca testuale, stato e ambito;
 * - aggiornare le statistiche sintetiche mostrate nella pagina;
 * - renderizzare la tabella delle deleghe e lo stato vuoto;
 * - aprire il dettaglio della singola delega in modale;
 * - consentire l’aggiornamento dell’ambito operativo dalla tabella;
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
 * - utilizza `APL.utils.setLoading()` per aggiornare lo stato visuale
 *   del pulsante di aggiornamento permessi;
 * - utilizza `APL.utils.toast()` per il feedback all’utente;
 * - utilizza `APL.utils.parseApiDate()` per la formattazione delle date;
 * - utilizza `APL.ui.modal.open()` per il dettaglio della delega;
 * - interagisce con gli endpoint:
 *   - `/api/me`
 *   - `/api/registry/patients/me/delegations`
 *   - `/api/registry/patients/me/delegations/{delegationId}/permissions`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. La pagina mantiene uno stato locale client-side con il
 * dataset completo delle deleghe, il sottoinsieme filtrato e una mappa di
 * lookup per id, così da supportare filtraggio, rendering e azioni rapide
 * senza dover interrogare il backend a ogni interazione locale.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Patient";

  // Endpoint per il recupero del profilo sintetico dell’utente autenticato.
  const API_ME = "/api/me";

  // Endpoint per il recupero delle deleghe del paziente autenticato.
  const API_DELEGATIONS = "/api/registry/patients/me/delegations";

  // Factory dell’endpoint per l’aggiornamento dell’ambito operativo della delega.
  const API_UPDATE_DELEGATION_PERMISSIONS = (delegationId) => `/api/registry/patients/me/delegations/${delegationId}/permissions`;

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
  // Oltre al badge, blocca temporaneamente i controlli che alterano il filtro.
  function setLoading(loading) {
    // Mostra o nasconde il badge globale di caricamento della pagina.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Elenco dei controlli che devono essere temporaneamente disabilitati
    // per evitare interazioni concorrenti durante il caricamento.
    const ids = [
      "searchInput",
      "statusSelect",
      "scopeSelect",
      "btnResetFilters",
      "btnEmptyReset",
    ];

    // Applica lo stato disabled a tutti i controlli effettivamente presenti.
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
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

  // Formatta una data API in rappresentazione estesa per dettagli e modali.
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

  // Formatta una data API in rappresentazione breve per la tabella.
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

  // Traduce lo stato tecnico della delega in una label leggibile per l’utente.
  function statusLabel(s) {
    // Normalizza il valore in stringa per confronti stabili.
    const x = String(s || "");

    // Mappa gli stati noti verso etichette utente localizzate.
    if (x === "Active") return "Attiva";
    if (x === "Pending") return "In attesa";
    if (x === "Revoked") return "Revocata";
    if (x === "Expired") return "Scaduta";

    // Mantiene comunque una rappresentazione leggibile per valori inattesi.
    return x || "—";
  }

  // Traduce l’ambito tecnico della delega in una label leggibile per l’utente.
  function scopeLabel(s) {
    // Normalizza il valore in stringa per confronti stabili.
    const x = String(s || "");

    // Mappa gli ambiti noti verso etichette funzionali comprensibili.
    if (x === "ReadOnly") return "Solo consultazione";
    if (x === "ManageAppointments") return "Gestione appuntamenti";
    if (x === "ManagePayments") return "Gestione pagamenti";

    // Mantiene comunque una rappresentazione leggibile per valori inattesi.
    return x || "—";
  }

  // Costruisce una pill visuale generica per rappresentare stato o ambito.
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

    // Restituisce il frammento HTML pronto per essere inserito nella tabella.
    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}">${escapeHtml(label)}</span>`;
  }

  // Costruisce la pill visuale specifica per lo stato della delega.
  function statusPill(status) {
    // Normalizza lo stato in stringa per il confronto.
    const s = String(status || "");

    // Restituisce una pill coerente con lo stato corrente della delega.
    if (s === "Active") return pill("Attiva", "emerald");
    if (s === "Pending") return pill("In attesa", "amber");
    if (s === "Revoked") return pill("Revocata", "blue");
    if (s === "Expired") return pill("Scaduta", "red");

    // Fallback neutro per stati non previsti.
    return pill(s || "—", "slate");
  }

  // Normalizza il payload di una delega per gestire differenze di naming
  // tra proprietà camelCase e PascalCase provenienti dal backend.
  function normalizeDelegation(x) {
    return {
      id: x?.id ?? x?.Id ?? "",
      patientUserId: x?.patientUserId ?? x?.PatientUserId ?? "",
      delegateUserId: x?.delegateUserId ?? x?.DelegateUserId ?? "",
      scope: x?.scope ?? x?.Scope ?? "",
      status: x?.status ?? x?.Status ?? "",
      startsAtUtc: x?.startsAtUtc ?? x?.StartsAtUtc ?? "",
      endsAtUtc: x?.endsAtUtc ?? x?.EndsAtUtc ?? "",
      createdAtUtc: x?.createdAtUtc ?? x?.CreatedAtUtc ?? "",
      raw: x,
    };
  }

  // Aggiorna il riepilogo utente mostrato in testa alla pagina.
  function setUserSummary(me) {
    // Popola l’email del paziente autenticato se disponibile.
    if ($("emailText")) $("emailText").textContent = me?.email ? String(me.email) : "—";

    // Popola l’identificativo utente se disponibile.
    if ($("userIdText")) $("userIdText").textContent = me?.id ? String(me.id) : "—";
  }

  // Aggiorna i riquadri statistici mostrati nella pagina.
  function setStats(all) {
    // Garantisce di lavorare sempre su un array.
    const list = Array.isArray(all) ? all : [];

    // Calcola i conteggi aggregati da mostrare nella UI.
    const total = list.length;
    const active = list.filter((d) => String(d.status) === "Active").length;
    const pending = list.filter((d) => String(d.status) === "Pending").length;

    // Aggiorna i tre indicatori sintetici presenti nella vista.
    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statActive")) $("statActive").textContent = String(active);
    if ($("statPending")) $("statPending").textContent = String(pending);
  }

  // Mostra o nasconde lo stato vuoto della pagina in base alla presenza di risultati.
  function emptyState(show) {
    // Recupera il pannello predisposto per lo stato vuoto.
    const box = $("emptyState");

    // Alterna la visibilità in base al valore richiesto.
    if (box) box.classList.toggle("hidden", !show);
  }

  // Applica i filtri client-side sul dataset delle deleghe già caricato dal backend.
  function applyFilters(items) {
    // Legge i criteri attualmente selezionati dall’utente.
    const term = String($("searchInput")?.value || "").trim().toLowerCase();
    const status = String($("statusSelect")?.value || "ALL");
    const scope = String($("scopeSelect")?.value || "ALL");

    // Lavora su una copia del dataset per non mutare lo stato originale.
    let list = Array.isArray(items) ? items.slice() : [];

    // Applica il filtro per stato se diverso da "ALL".
    if (status !== "ALL") list = list.filter((d) => String(d.status) === status);

    // Applica il filtro per ambito se diverso da "ALL".
    if (scope !== "ALL") list = list.filter((d) => String(d.scope) === scope);

    // Applica la ricerca testuale sull’identificativo del delegato.
    if (term) {
      list = list.filter((d) => {
        const hay = `${d.delegateUserId || ""}`.toLowerCase();
        return hay.includes(term);
      });
    }

    // Ordina il risultato per data di inizio o, in fallback, per data di creazione.
    list.sort((a, b) => {
      const ta = APL.utils.parseApiDate(a.startsAtUtc || a.createdAtUtc)?.getTime() || 0;
      const tb = APL.utils.parseApiDate(b.startsAtUtc || b.createdAtUtc)?.getTime() || 0;
      return tb - ta;
    });

    return list;
  }

  // Renderizza la tabella delle deleghe e aggiorna stato vuoto e statistiche.
  function renderTable(all, shown) {
    // Recupera il tbody che ospita dinamicamente le righe della tabella.
    const tbody = $("tbody");
    if (!tbody) return;

    // Aggiorna i contatori sintetici in testa alla pagina.
    setStats(all);

    // Se non ci sono elementi da mostrare, attiva lo stato vuoto e inserisce una riga placeholder.
    if (!shown.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    // In presenza di dati nasconde lo stato vuoto.
    emptyState(false);

    // Classi CSS riusabili per i pulsanti azione presenti nella tabella.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

    // Costruisce tutte le righe HTML partendo dalle deleghe filtrate.
    tbody.innerHTML = shown.map((d) => {
      const validity = `${fmtDate(d.startsAtUtc)} → ${fmtDate(d.endsAtUtc)}`;
      const delegate = d.delegateUserId || "—";
      const scope = scopeLabel(d.scope);
      const created = fmtDateTime(d.createdAtUtc);
      const delegationId = String(d.id || "");

      return `
        <tr>
          <td class="py-4 pr-4">${statusPill(d.status)}</td>
          <td class="py-4 pr-4 text-slate-700">${escapeHtml(scope)}</td>
          <td class="py-4 pr-4 text-slate-700 truncate max-w-[260px]" title="${escapeHtml(delegate)}">${escapeHtml(delegate)}</td>
          <td class="py-4 pr-4 text-slate-700">${escapeHtml(validity)}</td>
          <td class="py-4 pr-4 text-slate-700">${escapeHtml(created)}</td>
          <td class="py-4 text-right">
            <div class="flex flex-wrap items-center justify-end gap-2">
              <button type="button" class="${btnCls}" data-action="open" data-id="${escapeHtml(delegationId)}">
                Apri
              </button>

              <select data-delegation-scope="${escapeHtml(delegationId)}"
                class="h-9 rounded-xl border bg-white px-3 text-xs text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-100">
                <option value="ReadOnly" ${/^ReadOnly$/i.test(String(d.scope || "")) ? "selected" : ""}>Solo consultazione</option>
                <option value="ManageAppointments" ${/^ManageAppointments$/i.test(String(d.scope || "")) ? "selected" : ""}>Gestione appuntamenti</option>
                <option value="ManagePayments" ${/^ManagePayments$/i.test(String(d.scope || "")) ? "selected" : ""}>Gestione pagamenti</option>
              </select>

              <button type="button" class="${btnCls}" data-action="save-permissions" data-id="${escapeHtml(delegationId)}">
                Aggiorna
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
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

  // Mostra una modale con il dettaglio strutturato della delega selezionata.
  async function openDelegationModal(d) {
    // Verifica che l’infrastruttura modale condivisa sia pronta.
    const ok = await ensureModalReady();
    if (!ok) return;

    // Compone la stringa di validità completa della delega.
    const validity = `${fmtDateTime(d.startsAtUtc)} → ${fmtDateTime(d.endsAtUtc)}`;

    // Costruisce il contenuto HTML della modale con riepilogo, delegato,
    // validità, identificativo e nota informativa finale.
    const bodyHtml = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Stato</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(statusLabel(d.status))}</div>
          <div class="mt-2 text-xs text-slate-600">Ambito: ${escapeHtml(scopeLabel(d.scope))}</div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Delegato</div>
          <div class="mt-1 text-sm font-semibold text-slate-900 break-words">${escapeHtml(d.delegateUserId || "—")}</div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Validità</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(validity)}</div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Identificativo delega</div>
          <div class="mt-1 text-sm font-semibold text-slate-900 break-words">${escapeHtml(d.id || "—")}</div>
          <div class="mt-2 text-xs text-slate-600">Creato il ${escapeHtml(fmtDateTime(d.createdAtUtc))}.</div>
        </div>

        <div class="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700 leading-relaxed">
          I permessi possono essere aggiornati direttamente dalla tabella. Per revoche o variazioni dello stato della delega, è invece necessario contattare la struttura.
        </div>
      </div>
    `;

    // Apre la modale di dettaglio con una sola azione di chiusura.
    APL.ui.modal.open({
      title: "Dettaglio delega",
      bodyHtml,
      actions: [
        { label: "Chiudi", kind: "primary", closeOnClick: true },
      ],
    });
  }

  // Aggiorna l’ambito operativo della delega selezionata usando il valore scelto nella tabella.
  async function saveDelegationPermissions(delegationId) {
    // Normalizza l’identificativo della delega.
    const id = String(delegationId || "").trim();
    if (!id) return;

    // Recupera la delega corrente dalla cache locale.
    const current = state.byId.get(id);
    if (!current) {
      APL.utils.toast("Elemento non disponibile.", "error");
      return;
    }

    // Recupera il selettore dell’ambito associato alla delega corrente.
    const scopeSelect = document.querySelector(`select[data-delegation-scope="${CSS.escape(id)}"]`);

    // Legge il nuovo valore scelto dall’utente e quello attuale persistito.
    const newScope = String(scopeSelect?.value || "").trim();
    const currentScope = String(current.scope || "").trim();

    // Se il nuovo ambito è vuoto non procede.
    if (!newScope) return;

    // Se non ci sono variazioni evita una chiamata inutile al backend.
    if (newScope === currentScope) {
      APL.utils.toast("Nessuna modifica da applicare.", "info");
      return;
    }

    // Recupera il pulsante di aggiornamento per mostrare uno stato visuale locale di loading.
    const btn = document.querySelector(`button[data-action="save-permissions"][data-id="${CSS.escape(id)}"]`);
    if (btn) APL.utils.setLoading(btn, true, "Aggiornamento…");

    try {
      // Invia al backend il nuovo ambito operativo della delega.
      const updatedRaw = await apiJson("PATCH", API_UPDATE_DELEGATION_PERMISSIONS(id), { scope: newScope });

      // Normalizza la risposta ricevuta.
      const updated = normalizeDelegation(updatedRaw);

      // Aggiorna il dataset completo mantenuto in memoria.
      state.all = state.all.map((x) => (String(x.id) === id ? updated : x));

      // Aggiorna la mappa di lookup rapido per id.
      state.byId.set(id, updated);

      // Ricalcola il sottoinsieme filtrato corrente.
      state.shown = applyFilters(state.all);

      // Rigenera la tabella con i nuovi valori.
      renderTable(state.all, state.shown);

      // Comunica all’utente l’esito positivo dell’aggiornamento.
      APL.utils.toast("Permessi aggiornati correttamente.", "success");
    } catch (err) {
      // In caso di errore mostra un messaggio coerente nel box globale.
      showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      // Ripristina lo stato visuale del pulsante locale.
      if (btn) APL.utils.setLoading(btn, false);
    }
  }

  // Carica profilo sintetico e deleghe dal backend, quindi sincronizza la UI.
  async function loadDelegations() {
    // Riparte sempre da uno stato visivo pulito.
    clearError();
    setLoading(true);

    try {
      // Recupera i dati sintetici dell’utente autenticato.
      const me = await apiJson("GET", API_ME);

      // Aggiorna il riepilogo utente mostrato in pagina.
      setUserSummary(me);

      // Recupera l’elenco delle deleghe del paziente.
      const data = await apiJson("GET", API_DELEGATIONS);

      // Normalizza il payload ricevuto dal backend.
      const all = (Array.isArray(data) ? data : []).map(normalizeDelegation);

      // Aggiorna lo stato client-side completo e la mappa di lookup rapido.
      state.all = all;
      state.byId = new Map(all.filter((x) => x.id).map((x) => [String(x.id), x]));

      // Applica i filtri correnti e renderizza la tabella.
      state.shown = applyFilters(state.all);
      renderTable(state.all, state.shown);
    } catch (err) {
      // In caso di errore mostra un messaggio globale e un placeholder minimo in tabella.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare le deleghe.");
      const tbody = $("tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">—</td></tr>`;
      emptyState(false);
    } finally {
      // Ripristina sempre lo stato di non-caricamento a fine flusso.
      setLoading(false);
    }
  }

  // Ripristina i filtri della pagina ai valori predefiniti.
  function resetFilters() {
    // Azzera la ricerca testuale.
    $("searchInput").value = "";

    // Ripristina il filtro stato al valore neutro.
    $("statusSelect").value = "ALL";

    // Ripristina il filtro ambito al valore neutro.
    $("scopeSelect").value = "ALL";
  }

  // Collega tutti gli eventi della pagina ai rispettivi controlli UI.
  function wireEvents() {
    // Reset dei filtri dalla toolbar principale.
    const btnReset = $("btnResetFilters");
    if (btnReset) btnReset.addEventListener("click", () => {
      resetFilters();
      state.shown = applyFilters(state.all);
      renderTable(state.all, state.shown);
    });

    // Reset dei filtri dallo stato vuoto.
    const btnEmptyReset = $("btnEmptyReset");
    if (btnEmptyReset) btnEmptyReset.addEventListener("click", () => {
      resetFilters();
      state.shown = applyFilters(state.all);
      renderTable(state.all, state.shown);
    });

    // Ricerca testuale applicata localmente sul dataset già in memoria.
    const search = $("searchInput");
    if (search) search.addEventListener("input", () => {
      state.shown = applyFilters(state.all);
      renderTable(state.all, state.shown);
    });

    // Filtro per stato applicato localmente sul dataset già in memoria.
    const status = $("statusSelect");
    if (status) status.addEventListener("change", () => {
      state.shown = applyFilters(state.all);
      renderTable(state.all, state.shown);
    });

    // Filtro per ambito applicato localmente sul dataset già in memoria.
    const scope = $("scopeSelect");
    if (scope) scope.addEventListener("change", () => {
      state.shown = applyFilters(state.all);
      renderTable(state.all, state.shown);
    });

    // Event delegation sulle azioni presenti nella tabella.
    const tbody = $("tbody");
    if (tbody) {
      tbody.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-action][data-id]");
        if (!btn) return;

        const action = String(btn.getAttribute("data-action") || "");
        const id = btn.getAttribute("data-id");
        if (!id) return;

        // Aggiornamento dell’ambito operativo direttamente dalla riga corrente.
        if (action === "save-permissions") {
          await saveDelegationPermissions(id);
          return;
        }

        // Recupera la delega corrente dalla cache locale per l’apertura del dettaglio.
        const d = state.byId.get(String(id));
        if (!d) return;

        // Apre la modale di dettaglio della delega selezionata.
        await openDelegationModal(d);
      });
    }
  }

  // Stato locale della pagina usato per conservare dataset, sottoinsieme filtrato
  // e mappa di lookup rapido per deleghe.
  const state = {
    all: [],
    shown: [],
    byId: new Map(),
  };

  // Inizializza la pagina deleghe.
  // Coordina autenticazione, binding degli eventi e primo caricamento dei dati.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Patient.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Collega gli eventi della pagina ai rispettivi controlli.
    wireEvents();

    // Esegue il primo caricamento completo di profilo sintetico e deleghe.
    await loadDelegations();
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
