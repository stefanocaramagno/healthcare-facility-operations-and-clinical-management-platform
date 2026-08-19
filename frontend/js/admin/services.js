/**
 * File: frontend/js/admin/services.js
 *
 * Scopo
 * -----
 * Gestire il catalogo amministrativo delle prestazioni sanitarie, consentendo
 * il caricamento dell’elenco, la ricerca filtrata, la creazione di nuove
 * prestazioni, la modifica di quelle esistenti e l’attivazione/disattivazione
 * delle voci di catalogo.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della pagina amministrativa
 * dedicata alle prestazioni. Coordina l’interazione tra interfaccia utente,
 * endpoint protetti del back-end e componenti condivisi del front-end,
 * garantendo che l’operatore Admin possa governare il catalogo in modo
 * controllato e coerente.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso dell’utente con ruolo Admin;
 * - caricare e renderizzare il catalogo delle prestazioni;
 * - applicare filtri di ricerca e opzioni di visualizzazione;
 * - mostrare statistiche sintetiche sul catalogo;
 * - aprire modali per creazione e modifica delle prestazioni;
 * - gestire l’attivazione e la disattivazione delle prestazioni;
 * - mostrare errori, notifiche e stati di caricamento.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading` e `APL.utils.toast`;
 * - utilizza `APL.ui.modal` per aprire e gestire le finestre modali;
 * - interagisce con l’endpoint `/api/catalog/admin/services`
 *   e con gli endpoint derivati `/api/catalog/admin/services/{id}`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La logica si basa su un caricamento server-side dell’elenco prestazioni
 * filtrato tramite query string e su operazioni modali per le attività CRUD
 * principali lato amministratore.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint base del catalogo prestazioni per l’area amministrativa.
  const API_BASE = "/api/catalog/admin/services";

  // Restituisce un elemento DOM a partire dal suo id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel contenitore globale della pagina.
  function showError(message) {
    // Recupera il box errori della pagina.
    const box = $("pageError");
    if (!box) return;

    // Imposta il messaggio e rende visibile il contenitore.
    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore globale degli errori.
  function clearError() {
    // Recupera il box errori della pagina.
    const box = $("pageError");
    if (!box) return;

    // Svuota il contenuto e ripristina lo stato nascosto.
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna lo stato di caricamento dell’interfaccia.
  function setLoading(loading) {
    // Mostra o nasconde il badge di caricamento nell’header della tabella.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Aggiorna il testo/stato del pulsante di refresh.
    const refreshBtn = $("btnRefresh");
    if (refreshBtn) APL.utils.setLoading(refreshBtn, loading, "Aggiornamento…");

    // Durante il caricamento disabilita il pulsante di creazione.
    const createBtn = $("btnCreate");
    if (createBtn) createBtn.disabled = !!loading;

    // Disabilita il checkbox che controlla l’inclusione delle voci non attive.
    const includeInactive = $("includeInactive");
    if (includeInactive) includeInactive.disabled = !!loading;

    // Disabilita l’input di ricerca per evitare richieste concorrenti.
    const searchInput = $("searchInput");
    if (searchInput) searchInput.disabled = !!loading;
  }

  // Esegue l’escape HTML di una stringa per un inserimento sicuro nel markup.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Converte un importo espresso in centesimi in una stringa monetaria leggibile.
  function formatMoney(cents, currency) {
    // Converte i centesimi in unità decimali con due cifre fisse.
    const value = (Number(cents || 0) / 100).toFixed(2);

    // Restituisce la rappresentazione finale con valuta.
    return `${value} ${currency || "EUR"}`;
  }

  // Normalizza il valore inserito in un campo monetario.
  function normalizeMoneyInput(raw) {
    // Rimuove spazi laterali e uniforma la virgola al punto decimale.
    const s = String(raw ?? "").trim().replace(",", ".");
    return s;
  }

  // Converte un valore monetario testuale in centesimi.
  function moneyToCents(raw) {
    // Normalizza il valore inserito dall’utente.
    const s = normalizeMoneyInput(raw);

    // Se il campo è vuoto, restituisce zero.
    if (!s) return 0;

    // Prova a convertire il valore in numero.
    const n = Number(s);

    // Se il valore non è numerico, restituisce NaN per segnalare errore.
    if (!Number.isFinite(n)) return NaN;

    // Converte l’importo in centesimi arrotondando al valore intero più vicino.
    return Math.round(n * 100);
  }

  // Aggiorna i contatori statistici mostrati nella pagina.
  function setStats(list) {
    // Calcola il totale delle prestazioni presenti nell’elenco corrente.
    const total = Array.isArray(list) ? list.length : 0;

    // Calcola quante prestazioni risultano attive.
    const active = (Array.isArray(list) ? list : []).filter((x) => !!x.isActive).length;

    // Deduce quante prestazioni risultano non attive.
    const inactive = total - active;

    // Aggiorna i valori dei tre KPI presenti nell’interfaccia.
    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statActive")) $("statActive").textContent = String(active);
    if ($("statInactive")) $("statInactive").textContent = String(inactive);
  }

  // Costruisce il badge HTML che rappresenta lo stato della prestazione.
  function statusPill(isActive) {
    // Se la prestazione è attiva, genera il badge verde.
    if (isActive) {
      return (
        `<span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">` +
        `<span class="h-2 w-2 rounded-full bg-emerald-600"></span>` +
        `Attiva</span>`
      );
    }

    // Altrimenti genera il badge neutro per la prestazione non attiva.
    return (
      `<span class="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">` +
      `<span class="h-2 w-2 rounded-full bg-slate-500"></span>` +
      `Non attiva</span>`
    );
  }

  // Mostra o nasconde lo stato vuoto della tabella.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Blocca o sblocca la modale durante un’operazione asincrona.
  function lockModal(locked) {
    // Recupera gli elementi principali della modale condivisa.
    const root = document.getElementById("aplModal");
    if (!root) return;
    const closeBtn = document.getElementById("aplModalClose");
    const actions = document.getElementById("aplModalActions");

    // Disabilita o riabilita il pulsante di chiusura.
    if (closeBtn) closeBtn.disabled = !!locked;

    // Disabilita o riabilita tutti i pulsanti di azione della modale.
    if (actions) {
      const btns = Array.from(actions.querySelectorAll("button"));
      btns.forEach((b) => (b.disabled = !!locked));
    }

    // Imposta un attributo ARIA che segnala lo stato occupato della modale.
    root.setAttribute("aria-busy", locked ? "true" : "false");
  }

  // Esegue una richiesta JSON autenticata e gestisce gli errori principali.
  async function apiJson(method, url, json) {
    // Invia la richiesta verso il back-end con header autenticati.
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Se la risposta non è positiva, gestisce i casi applicativi previsti.
    if (!res.ok) {
      // In caso di sessione scaduta, pulisce lo stato locale e reindirizza.
      if (res.status === 401) {
        try {
          APL.session.clearAuth();
        } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // In caso di accesso non autorizzato, reindirizza alla schermata corretta.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Per gli altri casi costruisce un errore arricchito con i dettagli restituiti.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    // Se la risposta è valida, restituisce direttamente il payload.
    return res.data;
  }

  // Renderizza la tabella delle prestazioni.
  function renderRows(services) {
    // Recupera il corpo tabella che ospiterà le righe.
    const tbody = $("servicesTbody");
    if (!tbody) return;

    // Garantisce di lavorare sempre con un array.
    const list = Array.isArray(services) ? services : [];

    // Aggiorna le statistiche di pagina in base all’elenco corrente.
    setStats(list);

    // Se non ci sono risultati, mostra lo stato vuoto e una riga placeholder.
    if (!list.length) {
      emptyState(true);
      tbody.innerHTML =
        `<tr><td colspan="5" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    // Se ci sono elementi, nasconde l’empty state.
    emptyState(false);

    // Ordina le prestazioni per codice e genera il markup delle righe.
    const rows = list
      .slice()
      .sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "it"))
      .map((s) => {
        const id = String(s.id || "");
        const code = escapeHtml(s.code || "—");
        const name = escapeHtml(s.name || "—");
        const price = escapeHtml(formatMoney(s.basePriceCents, s.currency));
        const st = statusPill(!!s.isActive);

        // Determina l’etichetta del pulsante di cambio stato.
        const toggleLabel = s.isActive ? "Disattiva" : "Attiva";

        return `
          <tr>
            <td class="py-4 pr-4">
              <div class="font-medium text-slate-900">${code}</div>
            </td>
            <td class="py-4 pr-4">
              <div class="font-medium text-slate-900">${name}</div>
              ${s.description ? `<div class="mt-1 text-xs text-slate-500 line-clamp-2">${escapeHtml(s.description)}</div>` : ""}
            </td>
            <td class="py-4 pr-4 text-slate-700">${price}</td>
            <td class="py-4 pr-4">${st}</td>
            <td class="py-4 text-right">
              <div class="inline-flex items-center gap-2 justify-end">
                <button type="button" data-action="edit" data-id="${escapeHtml(id)}"
                  class="h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  Modifica
                </button>
                <button type="button" data-action="toggle" data-id="${escapeHtml(id)}"
                  class="h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  ${escapeHtml(toggleLabel)}
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    // Inserisce il markup generato nel tbody.
    tbody.innerHTML = rows;
  }

  // Cerca una prestazione per id all’interno di una lista.
  function findById(list, id) {
    return (Array.isArray(list) ? list : []).find((x) => String(x.id) === String(id)) || null;
  }

  // Costruisce l’HTML del form modale di creazione o modifica.
  function modalFormHtml({ mode, service }) {
    // Determina se il form è in modalità modifica.
    const isEdit = mode === "edit";

    // Prepara i valori iniziali del form in base alla modalità.
    const code = isEdit ? String(service.code || "") : "";
    const name = isEdit ? String(service.name || "") : "";
    const desc = isEdit ? String(service.description || "") : "";
    const price = isEdit ? (Number(service.basePriceCents || 0) / 100).toFixed(2) : "";
    const currency = isEdit ? String(service.currency || "EUR") : "EUR";
    const isActive = isEdit ? !!service.isActive : true;

    // In modalità modifica il codice viene mostrato in sola lettura.
    const codeField = isEdit
      ? `
        <div>
          <label class="text-sm font-medium text-slate-700">Codice</label>
          <div class="mt-2 h-11 w-full rounded-xl border bg-slate-50 px-4 text-sm flex items-center text-slate-700">
            ${escapeHtml(code)}
          </div>
        </div>`
      : `
        <div>
          <label class="text-sm font-medium text-slate-700" for="svcCode">Codice</label>
          <input id="svcCode" type="text" autocomplete="off" maxlength="32"
            class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="Es. VISITA_CARDIO" value="${escapeHtml(code)}" />
          <div class="mt-1 text-xs text-slate-500">Identificativo univoco della prestazione.</div>
        </div>`;

    // In modalità modifica compare anche il controllo di stato attiva/non attiva.
    const activeField = isEdit
      ? `
        <div class="rounded-xl border bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-medium text-slate-800">Stato</div>
            <div class="mt-1 text-xs text-slate-600">Gestisce la disponibilità della prestazione nel catalogo.</div>
          </div>
          <label class="inline-flex items-center gap-2">
            <input id="svcIsActive" type="checkbox" class="h-4 w-4 rounded border-slate-300" ${isActive ? "checked" : ""} />
            <span class="text-sm text-slate-700">${isActive ? "Attiva" : "Non attiva"}</span>
          </label>
        </div>`
      : "";

    // Restituisce il markup completo del form modale.
    return `
      <div id="svcFormError" class="hidden mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert"></div>

      <div class="grid gap-4">
        ${codeField}

        <div>
          <label class="text-sm font-medium text-slate-700" for="svcName">Nome</label>
          <input id="svcName" type="text" autocomplete="off" maxlength="180"
            class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="Es. Visita cardiologica" value="${escapeHtml(name)}" />
        </div>

        <div>
          <label class="text-sm font-medium text-slate-700" for="svcDesc">Descrizione (opzionale)</label>
          <textarea id="svcDesc" rows="3" maxlength="1000"
            class="mt-2 w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="Aggiungere dettagli utili per la gestione interna…">${escapeHtml(desc)}</textarea>
        </div>

        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-slate-700" for="svcPrice">Prezzo</label>
            <input id="svcPrice" type="number" inputmode="decimal" step="0.01" min="0"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
              placeholder="0,00" value="${escapeHtml(price)}" />
          </div>

          <div>
            <label class="text-sm font-medium text-slate-700" for="svcCurrency">Valuta</label>
            <select id="svcCurrency"
              class="mt-2 h-11 w-full rounded-xl border bg-white px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100">
              <option value="EUR" ${currency === "EUR" ? "selected" : ""}>EUR</option>
            </select>
          </div>
        </div>

        ${activeField}
      </div>
    `;
  }

  // Mostra o nasconde il messaggio di errore del form modale.
  function setFormError(message) {
    const box = document.getElementById("svcFormError");
    if (!box) return;

    // Se non esiste messaggio, svuota e nasconde il box.
    if (!message) {
      box.textContent = "";
      box.classList.add("hidden");
      return;
    }

    // Altrimenti imposta il testo e rende visibile il box.
    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Attende che l’API della modale condivisa sia disponibile nel namespace globale.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();

    // Attende a piccoli intervalli finché la modale non è pronta o finché non scade il timeout.
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    const ok = !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");

    // In caso di fallimento, avvisa l’utente.
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
    }
    return ok;
  }

  // Legge e valida il payload del form in modalità creazione.
  function readCreatePayload() {
    // Recupera i valori dai campi del form.
    const code = String($("svcCode")?.value || "").trim();
    const name = String($("svcName")?.value || "").trim();
    const description = String($("svcDesc")?.value || "").trim();
    const currency = String($("svcCurrency")?.value || "EUR").trim() || "EUR";
    const cents = moneyToCents($("svcPrice")?.value);

    // Esegue le validazioni principali sui campi obbligatori.
    if (!code) return { ok: false, message: "Il codice è obbligatorio." };
    if (!name) return { ok: false, message: "Il nome è obbligatorio." };
    if (!Number.isFinite(cents) || cents < 0) return { ok: false, message: "Il prezzo non è valido." };

    // Restituisce il payload pronto per il back-end.
    return {
      ok: true,
      payload: {
        code,
        name,
        description: description ? description : null,
        basePriceCents: cents,
        currency,
      },
    };
  }

  // Legge e valida il payload del form in modalità modifica.
  function readUpdatePayload(service) {
    // Recupera i valori dai campi del form.
    const name = String($("svcName")?.value || "").trim();
    const description = String($("svcDesc")?.value || "").trim();
    const currency = String($("svcCurrency")?.value || service.currency || "EUR").trim() || "EUR";
    const cents = moneyToCents($("svcPrice")?.value);
    const isActive = !!$("svcIsActive")?.checked;

    // Esegue le validazioni principali sui campi modificabili.
    if (!name) return { ok: false, message: "Il nome è obbligatorio." };
    if (!Number.isFinite(cents) || cents < 0) return { ok: false, message: "Il prezzo non è valido." };

    // Restituisce il payload pronto per l’aggiornamento.
    return {
      ok: true,
      payload: {
        name,
        description: description ? description : null,
        basePriceCents: cents,
        currency,
        isActive,
      },
    };
  }

  // Apre la modale per la creazione di una nuova prestazione.
  async function openCreateModal(onSaved) {
    const trigger = $("btnCreate");
    if (trigger) APL.utils.setLoading(trigger, true, "Apertura…");

    try {
      // Attende che la modale condivisa sia pronta.
      if (!(await ensureModalReady(10000))) return;

      // Ripulisce eventuali errori residui del form modale.
      setFormError("");

      // Apre la modale con il form di creazione.
      APL.ui.modal.open({
        title: "Nuova prestazione",
        bodyHtml: modalFormHtml({ mode: "create", service: {} }),
        actions: [
          { label: "Annulla", kind: "secondary" },
          {
            label: "Crea",
            kind: "primary",
            closeOnClick: false,
            onClick: async () => {
              // Pulisce l’errore prima di una nuova validazione.
              setFormError("");

              // Legge e valida i dati del form.
              const r = readCreatePayload();
              if (!r.ok) {
                setFormError(r.message);
                return;
              }

              // Blocca la modale finché l’operazione remota non è completata.
              lockModal(true);
              try {
                // Invia la richiesta di creazione al back-end.
                await apiJson("POST", API_BASE, r.payload);

                // Notifica il successo e chiude la modale.
                APL.utils.toast("Prestazione creata con successo.", "success");
                if (APL.ui?.modal?.close) APL.ui.modal.close();

                // Se presente, richiama la callback di refresh.
                if (typeof onSaved === "function") await onSaved();
              } catch (err) {
                // Mostra l’errore direttamente nel form modale.
                setFormError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
              } finally {
                // Sblocca la modale a fine operazione.
                lockModal(false);
              }
            },
          },
        ],
      });
    } finally {
      // Ripristina lo stato del pulsante di apertura modale.
      if (trigger) APL.utils.setLoading(trigger, false);
    }
  }

  // Apre la modale per la modifica di una prestazione esistente.
  async function openEditModal(service, onSaved) {
    // Attende che la modale condivisa sia pronta.
    if (!(await ensureModalReady(10000))) return;

    // Ripulisce eventuali errori residui del form modale.
    setFormError("");

    // Apre la modale con il form di modifica valorizzato.
    APL.ui.modal.open({
      title: "Modifica prestazione",
      bodyHtml: modalFormHtml({ mode: "edit", service }),
      actions: [
        { label: "Chiudi", kind: "secondary" },
        {
          label: "Salva",
          kind: "primary",
          closeOnClick: false,
          onClick: async () => {
            // Ripulisce l’errore prima di una nuova validazione.
            setFormError("");

            // Legge e valida i dati aggiornati.
            const r = readUpdatePayload(service);
            if (!r.ok) {
              setFormError(r.message);
              return;
            }

            // Blocca la modale durante il salvataggio.
            lockModal(true);
            try {
              // Costruisce l’endpoint specifico della prestazione e invia l’update.
              const url = `${API_BASE}/${encodeURIComponent(String(service.id))}`;
              await apiJson("PUT", url, r.payload);

              // Notifica il successo e chiude la modale.
              APL.utils.toast("Modifiche salvate.", "success");
              if (APL.ui?.modal?.close) APL.ui.modal.close();

              // Se presente, richiama la callback di refresh.
              if (typeof onSaved === "function") await onSaved();
            } catch (err) {
              // Mostra l’errore nel box del form modale.
              setFormError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
            } finally {
              // Sblocca la modale a fine operazione.
              lockModal(false);
            }
          },
        },
      ],
    });

    // Collega un listener al checkbox di stato per aggiornare l’etichetta dinamicamente.
    const chk = $("svcIsActive");
    if (chk) {
      const label = chk.parentElement?.querySelector("span");
      chk.addEventListener("change", () => {
        if (label) label.textContent = chk.checked ? "Attiva" : "Non attiva";
      });
    }
  }

  // Apre una modale di conferma per attivare o disattivare una prestazione.
  async function confirmToggle(service, onSaved) {
    // Attende che la modale condivisa sia pronta.
    if (!(await ensureModalReady(10000))) return;

    // Calcola il nuovo stato desiderato.
    const nextActive = !service.isActive;

    // Prepara titolo e messaggio della finestra di conferma.
    const title = nextActive ? "Attivare prestazione" : "Disattivare prestazione";
    const bodyHtml = `
      <div class="text-sm text-slate-700">
        <div class="font-medium text-slate-900">${escapeHtml(service.name || "Prestazione")}</div>
        <div class="mt-1 text-slate-600">
          ${nextActive
        ? "La prestazione tornerà disponibile nel catalogo."
        : "La prestazione non sarà più disponibile nel catalogo (rimarrà comunque consultabile a livello amministrativo)."}
        </div>
      </div>
    `;

    // Apre la modale di conferma con azioni contestuali.
    APL.ui.modal.open({
      title,
      bodyHtml,
      actions: [
        { label: "Annulla", kind: "secondary" },
        {
          label: nextActive ? "Attiva" : "Disattiva",
          kind: nextActive ? "primary" : "danger",
          closeOnClick: false,
          onClick: async () => {
            // Blocca la modale durante la richiesta remota.
            lockModal(true);
            try {
              // Costruisce l’endpoint specifico e invia un aggiornamento completo della prestazione.
              const url = `${API_BASE}/${encodeURIComponent(String(service.id))}`;
              await apiJson("PUT", url, {
                name: service.name,
                description: service.description || null,
                basePriceCents: Number(service.basePriceCents || 0),
                currency: service.currency || "EUR",
                isActive: nextActive,
              });

              // Mostra una notifica coerente con l’azione eseguita.
              APL.utils.toast(
                nextActive ? "Prestazione attivata." : "Prestazione disattivata.",
                "success"
              );

              // Chiude la modale e aggiorna l’elenco.
              if (APL.ui?.modal?.close) APL.ui.modal.close();
              if (typeof onSaved === "function") await onSaved();
            } catch (err) {
              // In questo caso l’errore viene mostrato tramite toast.
              APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
            } finally {
              // Sblocca la modale a fine operazione.
              lockModal(false);
            }
          },
        },
      ],
    });
  }

  // Cache locale delle prestazioni attualmente caricate.
  let _services = [];

  // Timer usato per il debounce della ricerca.
  let _debounce = null;

  // Carica dal back-end il catalogo delle prestazioni in base ai filtri correnti.
  async function loadServices() {
    clearError();
    setLoading(true);

    // Legge lo stato dei filtri dalla UI.
    const includeInactive = !!$("includeInactive")?.checked;
    const search = String($("searchInput")?.value || "").trim();

    // Costruisce la query string per la richiesta GET.
    const params = new URLSearchParams();
    params.set("includeInactive", includeInactive ? "true" : "false");
    if (search) params.set("search", search);

    try {
      // Esegue la richiesta al back-end con i parametri selezionati.
      const url = `${API_BASE}?${params.toString()}`;
      const data = await apiJson("GET", url);

      // Memorizza il risultato e aggiorna il rendering della tabella.
      _services = Array.isArray(data) ? data : [];
      renderRows(_services);
    } catch (err) {
      // In caso di errore, pulisce la tabella e mostra il messaggio globale.
      console.error(err);
      renderRows([]);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il catalogo prestazioni.");
    } finally {
      // Ripristina lo stato visivo della pagina.
      setLoading(false);
    }
  }

  // Collega gli handler delegati per le azioni presenti nelle righe della tabella.
  function wireTableActions() {
    const tbody = $("servicesTbody");
    if (!tbody) return;

    tbody.addEventListener("click", async (ev) => {
      // Individua il pulsante azione cliccato nella riga.
      const btn = ev.target?.closest?.("button[data-action][data-id]");
      if (!btn) return;

      // Estrae identificativo e tipo di azione richiesta.
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");

      // Recupera la prestazione corrispondente dallo stato locale.
      const svc = findById(_services, id);
      if (!svc) return;

      // Se l’azione è "edit", apre la modale di modifica.
      if (action === "edit") {
        await openEditModal(svc, loadServices);
        return;
      }

      // Se l’azione è "toggle", apre la conferma di cambio stato.
      if (action === "toggle") {
        await confirmToggle(svc, loadServices);
        return;
      }
    });
  }

  // Collega tutti i controlli principali dell’interfaccia.
  function initControls() {
    const btnCreate = $("btnCreate");
    const btnCreateEmpty = $("btnCreateEmpty");
    const btnRefresh = $("btnRefresh");
    const includeInactive = $("includeInactive");
    const searchInput = $("searchInput");

    // Collega i pulsanti di creazione presenti sia nella testata che nell’empty state.
    if (btnCreate) btnCreate.addEventListener("click", () => openCreateModal(loadServices));
    if (btnCreateEmpty) btnCreateEmpty.addEventListener("click", () => openCreateModal(loadServices));

    // Collega il refresh manuale della tabella.
    if (btnRefresh) btnRefresh.addEventListener("click", loadServices);

    // Ricarica l’elenco quando cambia l’opzione di inclusione delle prestazioni non attive.
    if (includeInactive) includeInactive.addEventListener("change", loadServices);

    if (searchInput) {
      // Applica un debounce alla ricerca per evitare richieste troppo frequenti.
      searchInput.addEventListener("input", () => {
        if (_debounce) clearTimeout(_debounce);
        _debounce = setTimeout(() => loadServices(), 350);
      });

      // Se l’utente preme Invio, esegue subito la ricerca.
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (_debounce) clearTimeout(_debounce);
          loadServices();
        }
      });
    }
  }

  // Inizializza la pagina verificando il ruolo e caricando i dati necessari.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Verifica che l’utente autenticato abbia il ruolo richiesto.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    try {
      // Collega i controlli dell’interfaccia.
      initControls();

      // Collega le azioni presenti nella tabella.
      wireTableActions();

      // Attende che la modale condivisa sia pronta prima delle interazioni future.
      await ensureModalReady(10000);

      // Carica il catalogo iniziale delle prestazioni.
      await loadServices();
    } catch (err) {
      // In caso di errore inatteso in fase di bootstrap, mostra un messaggio globale.
      console.error(err);
      showError(APL.utils.humanizeError(err) || "Errore imprevisto.");
    }
  }

  // Avvia l’inizializzazione della pagina quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
