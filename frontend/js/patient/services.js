/**
 * File: frontend/js/patient/services.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina "Catalogo prestazioni"
 * dell’area Patient, comprendendo il caricamento del catalogo, la ricerca
 * testuale, la visualizzazione dei dettagli di una prestazione e il passaggio
 * al flusso di prenotazione.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista dedicata alla
 * consultazione delle prestazioni disponibili. Si integra con i moduli
 * condivisi del front-end per autenticazione, sessione, richieste HTTP,
 * modali e notifiche, e dialoga con il servizio Catalog per recuperare
 * l’elenco delle prestazioni e l’eventuale dettaglio per codice.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Patient;
 * - recuperare il catalogo delle prestazioni disponibili dal backend;
 * - gestire la ricerca testuale lato server mediante query string;
 * - aggiornare la griglia delle prestazioni e le statistiche sintetiche;
 * - mostrare lo stato vuoto quando nessun elemento soddisfa i criteri di ricerca;
 * - aprire un modale con i dettagli della prestazione selezionata;
 * - reindirizzare il paziente verso la pagina di booking con la prestazione preselezionata;
 * - gestire la ricerca diretta per codice prestazione, se i relativi controlli sono presenti nel DOM;
 * - gestire loading, errori globali e toast di feedback.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.session.clearAuth` nei casi di sessione non più valida;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading` e `APL.utils.toast`;
 * - utilizza `APL.ui.modal.open` per la visualizzazione dei dettagli della prestazione;
 * - interagisce con gli endpoint:
 *   `/api/catalog/services`
 *   e `/api/catalog/services/by-code/{code}`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La ricerca testuale viene applicata tramite chiamata server-side con debounce,
 * mentre l’azione di prenotazione reindirizza il paziente alla pagina di booking
 * includendo l’identificativo della prestazione selezionata nella query string.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla vista catalogo prestazioni.
  const EXPECTED_ROLE = "Patient";

  // Endpoint che restituisce l’elenco delle prestazioni disponibili.
  const API_LIST = "/api/catalog/services";

  // Base URL per la ricerca puntuale di una prestazione tramite codice.
  const API_BY_CODE_BASE = "/api/catalog/services/by-code";

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

  // Aggiorna lo stato di caricamento complessivo della pagina.
  // Oltre al badge, gestisce i pulsanti di refresh e disabilita i controlli editabili.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const refreshBtn = $("btnRefresh");
    if (refreshBtn) APL.utils.setLoading(refreshBtn, loading, "Aggiornamento…");

    const refreshEmpty = $("btnRefreshEmpty");
    if (refreshEmpty) APL.utils.setLoading(refreshEmpty, loading, "Aggiornamento…");

    const searchInput = $("searchInput");
    if (searchInput) searchInput.disabled = !!loading;

    const clearBtn = $("btnClearSearch");
    if (clearBtn) clearBtn.disabled = !!loading;

    // Questi controlli vengono gestiti solo se presenti nel DOM.
    // Il file mantiene quindi compatibilità anche con eventuali varianti della vista.
    const codeInput = $("codeInput");
    if (codeInput) codeInput.disabled = !!loading;

    const btnSearchByCode = $("btnSearchByCode");
    if (btnSearchByCode) APL.utils.setLoading(btnSearchByCode, loading, "Ricerca…");
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

  // Formattta un importo espresso in centesimi nella valuta corrispondente.
  function formatMoney(cents, currency) {
    const value = (Number(cents || 0) / 100).toFixed(2);
    return `${value} ${currency || "EUR"}`;
  }

  // Aggiorna le statistiche sintetiche mostrate nella testata della pagina.
  // In questa vista "Risultati" e "Disponibili" coincidono con il numero di elementi caricati.
  function setStats(list) {
    const total = Array.isArray(list) ? list.length : 0;

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statAvailable")) $("statAvailable").textContent = String(total);
  }

  // Mostra o nasconde lo stato vuoto del catalogo.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Wrapper centralizzato per richieste GET autenticate con gestione coerente
  // di sessione scaduta, accesso vietato ed errori applicativi generici.
  async function apiGet(url) {
    const res = await APL.utils.requestJson(url, {
      method: "GET",
      headers: { Accept: "application/json", ...APL.session.authHeader() },
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

  // Attende che il sistema modale condiviso sia pronto prima di utilizzarlo.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();

    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Reindirizza il paziente alla pagina di booking, preselezionando la prestazione
  // tramite query string quando l’identificativo è disponibile.
  function goToBooking(serviceId) {
    const url = new URL("./booking.html", window.location.href);
    if (serviceId) url.searchParams.set("serviceId", String(serviceId));
    window.location.href = url.toString();
  }

  // Renderizza la griglia delle prestazioni disponibili.
  function renderGrid(services) {
    const grid = $("servicesGrid");
    if (!grid) return;

    const list = Array.isArray(services) ? services : [];
    setStats(list);

    // Se non ci sono risultati, mostra lo stato vuoto e un messaggio informativo nel contenitore principale.
    if (!list.length) {
      emptyState(true);
      grid.innerHTML = `<div class="col-span-full py-6 text-center text-slate-600">Nessun elemento da mostrare.</div>`;
      return;
    }

    emptyState(false);

    const cards = list
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "it"))
      .map((s) => {
        const id = String(s.id || "");
        const name = escapeHtml(s.name || "Prestazione");
        const desc = s.description ? escapeHtml(s.description) : "";
        const price = escapeHtml(formatMoney(s.basePriceCents, s.currency));
        const code = escapeHtml(s.code || "");

        return `
          <article class="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="text-base font-semibold text-slate-900 truncate" title="${name}">
                  ${name}
                </h3>
                ${code
            ? `<div class="mt-1 text-xs text-slate-500">Codice: <span class="font-medium text-slate-700">${code}</span></div>`
            : `<div class="mt-1 text-xs text-slate-500">Codice: <span class="font-medium text-slate-700">—</span></div>`
          }
              </div>

              <div class="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                ${price}
              </div>
            </div>

            ${desc
            ? `<p class="mt-3 text-sm text-slate-600 leading-relaxed line-clamp-3">${desc}</p>`
            : `<p class="mt-3 text-sm text-slate-500 leading-relaxed">Descrizione non disponibile.</p>`
          }

            <div class="mt-4 flex items-center justify-between gap-2">
              <button type="button" data-action="details" data-id="${escapeHtml(id)}"
                class="h-10 inline-flex items-center justify-center rounded-xl border bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
                Dettagli
              </button>

              <button type="button" data-action="book" data-id="${escapeHtml(id)}"
                class="h-10 inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100">
                Prenota
              </button>
            </div>
          </article>
        `;
      })
      .join("");

    grid.innerHTML = cards;
  }

  // Cerca una prestazione nello stato locale usando l’identificativo.
  function findById(list, id) {
    return (Array.isArray(list) ? list : []).find((x) => String(x.id) === String(id)) || null;
  }

  // Costruisce il contenuto HTML del modale di dettaglio della prestazione.
  function detailsBodyHtml(service) {
    const name = escapeHtml(service?.name || "Prestazione");
    const desc = service?.description ? escapeHtml(service.description) : null;
    const price = escapeHtml(formatMoney(service?.basePriceCents, service?.currency));
    const code = escapeHtml(service?.code || "—");

    return `
      <div class="space-y-4">
        <div>
          <div class="text-xs font-medium text-slate-500">Prestazione</div>
          <div class="mt-1 text-lg font-semibold text-slate-900">${name}</div>
          <div class="mt-1 text-sm text-slate-600">Codice: <span class="font-medium text-slate-700">${code}</span></div>
        </div>

        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Costo</div>
          <div class="mt-1 text-xl font-semibold text-slate-900">${price}</div>
          <div class="mt-1 text-xs text-slate-600">Importo indicativo per la prestazione selezionata.</div>
        </div>

        <div>
          <div class="text-xs font-medium text-slate-500">Descrizione</div>
          <div class="mt-2 text-sm text-slate-700 leading-relaxed">
            ${desc ? desc : "Descrizione non disponibile."}
          </div>
        </div>
      </div>
    `;
  }

  // Apre il modale di dettaglio della prestazione selezionata.
  async function openDetailsModal(service) {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return;
    }

    APL.ui.modal.open({
      title: "Dettagli prestazione",
      bodyHtml: detailsBodyHtml(service),
      actions: [
        { label: "Chiudi", kind: "secondary" },
        {
          label: "Prenota",
          kind: "primary",
          closeOnClick: true,
          onClick: () => goToBooking(service?.id),
        },
      ],
    });
  }

  // Normalizza il codice prestazione rimuovendo spazi e forzando il maiuscolo.
  function normalizeCode(raw) {
    return String(raw || "").trim().replace(/\s+/g, "").toUpperCase();
  }

  // Cerca una prestazione per codice e, se trovata, reindirizza al booking.
  // I controlli relativi alla ricerca per codice vengono utilizzati solo se presenti nel DOM.
  async function lookupByCodeAndBook() {
    clearError();

    const input = $("codeInput");
    const raw = input ? input.value : "";
    const code = normalizeCode(raw);

    if (!code) {
      APL.utils.toast("Inserisca un codice prestazione valido.", "error");
      if (input) input.focus();
      return;
    }

    setLoading(true);

    try {
      const url = `${API_BY_CODE_BASE}/${encodeURIComponent(code)}`;
      const svc = await apiGet(url);

      const serviceId = svc?.id;
      if (!serviceId) {
        APL.utils.toast("Prestazione trovata, ma identificativo non disponibile.", "error");
        return;
      }

      goToBooking(serviceId);
    } catch (err) {
      if (err && Number(err.status) === 404) {
        APL.utils.toast("Nessuna prestazione trovata per il codice inserito.", "error");
        const input = $("codeInput");
        if (input) input.focus();
        return;
      }

      console.error(err);
      APL.utils.toast(APL.utils.humanizeError(err) || "Impossibile completare la ricerca per codice.", "error");
    } finally {
      setLoading(false);
    }
  }

  // Stato locale del catalogo attualmente caricato e timer debounce della ricerca.
  let _services = [];
  let _debounce = null;

  // Carica il catalogo delle prestazioni dal backend applicando, se presente,
  // il filtro di ricerca testuale lato server.
  async function loadServices() {
    clearError();
    setLoading(true);

    const search = String($("searchInput")?.value || "").trim();
    const params = new URLSearchParams();
    if (search) params.set("search", search);

    try {
      const url = params.toString() ? `${API_LIST}?${params.toString()}` : API_LIST;
      const data = await apiGet(url);

      _services = Array.isArray(data) ? data : [];
      renderGrid(_services);
    } catch (err) {
      console.error(err);
      _services = [];
      renderGrid([]);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il catalogo prestazioni.");
    } finally {
      setLoading(false);
    }
  }

  // Collega gli eventi di click sulle card renderizzate dinamicamente nella griglia.
  function wireActions() {
    const grid = $("servicesGrid");
    if (!grid) return;

    grid.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-action][data-id]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      const svc = findById(_services, id);
      if (!svc) return;

      if (action === "book") {
        goToBooking(svc.id);
        return;
      }

      if (action === "details") {
        await openDetailsModal(svc);
        return;
      }
    });
  }

  // Collega i controlli statici della pagina ai relativi comportamenti applicativi.
  function initControls() {
    const btnRefresh = $("btnRefresh");
    const btnRefreshEmpty = $("btnRefreshEmpty");
    const btnClear = $("btnClearSearch");
    const searchInput = $("searchInput");

    // Pulsanti di refresh del catalogo.
    if (btnRefresh) btnRefresh.addEventListener("click", loadServices);
    if (btnRefreshEmpty) btnRefreshEmpty.addEventListener("click", loadServices);

    // Pulsante di reset della ricerca testuale.
    if (btnClear) {
      btnClear.addEventListener("click", () => {
        const si = $("searchInput");
        if (si) si.value = "";
        loadServices();
      });
    }

    // Ricerca testuale con debounce e invio immediato su Enter.
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        if (_debounce) clearTimeout(_debounce);
        _debounce = setTimeout(() => loadServices(), 350);
      });

      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (_debounce) clearTimeout(_debounce);
          loadServices();
        }
      });
    }

    // Controlli opzionali per la ricerca per codice prestazione.
    const codeInput = $("codeInput");
    const btnSearchByCode = $("btnSearchByCode");

    if (btnSearchByCode) {
      btnSearchByCode.addEventListener("click", lookupByCodeAndBook);
    }

    if (codeInput) {
      codeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          lookupByCodeAndBook();
        }
      });

      codeInput.addEventListener("blur", () => {
        codeInput.value = normalizeCode(codeInput.value);
      });
    }

    // Il pulsante principale di booking rimane un normale link.
    // Il listener è lasciato volutamente vuoto per preservare l’attuale comportamento del file.
    const bookingBtn = $("btnGoBooking");
    if (bookingBtn) {
      bookingBtn.addEventListener("click", (e) => {
      });
    }
  }

  // Inizializza la pagina catalogo prestazioni al caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Patient.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    try {
      initControls();
      wireActions();
      await ensureModalReady(10000);
      await loadServices();
    } catch (err) {
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Errore imprevisto.");
    }
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
