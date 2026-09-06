/**
 * File: frontend/js/admin/audit.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina amministrativa dedicata
 * all’audit log, comprendendo il caricamento del registro eventi, il filtraggio
 * per attore/azione/entità/intervallo/esito, la renderizzazione della tabella,
 * l’aggiornamento delle statistiche sintetiche e l’apertura del dettaglio
 * tecnico del singolo evento tracciato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Audit log" dell’area
 * Admin. Si integra con i moduli condivisi del front-end per autenticazione,
 * sessione, richieste HTTP, utilità di data e modali, e dialoga con gli
 * endpoint amministrativi del dominio Events per consentire la consultazione
 * della tracciabilità applicativa delle operazioni sensibili.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - inizializzare i filtri e i preset temporali della pagina;
 * - costruire correttamente i parametri server-side della query audit;
 * - caricare dal backend il registro eventi amministrativo;
 * - distinguere filtri che richiedono nuova query server-side da filtri puramente client-side;
 * - mantenere una cache locale dell’ultimo risultato server;
 * - applicare filtri client-side su actor parziale, requestId ed esito;
 * - renderizzare tabella, stato vuoto e riepilogo statistico;
 * - mostrare il dettaglio sintetico di un evento audit in modale;
 * - gestire caricamenti, errori globali e refresh coerenti della vista.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.romeDateRangeToUtc`,
 *   `APL.utils.romeTodayDateInputValue` e `APL.utils.addDaysToDateInput`;
 * - utilizza `APL.ui.modal` per mostrare il dettaglio del singolo evento audit;
 * - interagisce con l’endpoint `/api/events/admin/audit`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina adotta una strategia mista:
 * - alcuni filtri producono una nuova query verso il backend;
 * - altri filtri vengono applicati solo alla cache locale dell’ultimo risultato.
 */

(function () {
  "use strict";

  // Ruolo richiesto per l’accesso alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint amministrativo per il recupero dell’audit log.
  const API_LIST = "/api/events/admin/audit";

  // Cache locale dell’ultimo set di eventi restituito dal backend.
  // Questa lista rappresenta la base su cui vengono applicati i filtri client-side.
  let _serverItems = [];

  // Chiave dell’ultima query server eseguita con successo.
  // Serve a evitare fetch ridondanti quando il perimetro server-side non è cambiato.
  let _lastServerQueryKey = "";

  // Utility locale per recuperare rapidamente un elemento DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Esegue l’escape HTML di una stringa prima dell’inserimento in markup dinamico.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Mostra un messaggio di errore globale nel contenitore principale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    box.textContent = message || "Errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore degli errori globali.
  function clearError() {
    const box = $("pageError");
    if (!box) return;

    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna l’indicatore di caricamento globale della pagina.
  // In questa vista viene gestito solo il badge e non il blocco completo di tutti i controlli.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (!badge) return;

    badge.classList.toggle("hidden", !loading);
  }

  // Mostra o nasconde lo stato vuoto della tabella audit.
  function emptyState(show) {
    const el = $("emptyState");
    if (!el) return;

    el.classList.toggle("hidden", !show);
  }

  // Verifica se una stringa è compatibile con il formato GUID/UUID.
  // Viene usata per distinguere i casi in cui il filtro attore può essere inviato lato server.
  function isGuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
  }

  // Tenta di interpretare il campo metadataJson come oggetto JavaScript.
  // In caso di payload mancante, già oggetto o JSON non valido, restituisce sempre un oggetto sicuro.
  function parseMetadataJson(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  // Formattta una data/ora in una forma compatta leggibile per l’utente italiano.
  function fmtDateTime(value) {
    if (!value) return "—";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";

    return d.toLocaleString("it-IT", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  // Restituisce un badge HTML che rappresenta visivamente l’esito dell’evento audit.
  function outcomePill(outcome) {
    const normalized = String(outcome || "").trim().toLowerCase();

    let label = outcome || "—";
    let cls = "bg-slate-100 text-slate-700";

    if (normalized === "succeeded") {
      label = "Succeeded";
      cls = "bg-emerald-50 text-emerald-700";
    } else if (normalized === "denied") {
      label = "Denied";
      cls = "bg-amber-50 text-amber-800";
    } else if (normalized === "rejected") {
      label = "Rejected";
      cls = "bg-blue-50 text-blue-700";
    } else if (normalized === "failed") {
      label = "Failed";
      cls = "bg-red-50 text-red-700";
    }

    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}">${escapeHtml(label)}</span>`;
  }

  // Traduce il codice tecnico dell’azione audit in una label leggibile lato UI.
  function actionLabel(raw) {
    const value = String(raw || "").trim();
    if (!value) return "—";

    const map = {
      ADMIN_CREATE_SLOTS: "Admin · creazione slot",
      ADMIN_UPDATE_SLOT_STATUS: "Admin · aggiornamento slot",
      ADMIN_BOOK_APPOINTMENT: "Admin · prenotazione",
      ADMIN_CANCEL_APPOINTMENT: "Admin · annullamento appuntamento",
      ADMIN_RESCHEDULE_APPOINTMENT: "Admin · ripianificazione appuntamento",
      ADMIN_CHECKIN_APPOINTMENT: "Admin · check-in appuntamento",
      PATIENT_BOOK_APPOINTMENT: "Paziente · prenotazione",
      PATIENT_CANCEL_APPOINTMENT: "Paziente · annullamento appuntamento",
      PATIENT_RESCHEDULE_APPOINTMENT: "Paziente · ripianificazione appuntamento",
      DELEGATE_BOOK_APPOINTMENT: "Delegato · prenotazione",
      DELEGATE_RESCHEDULE_APPOINTMENT: "Delegato · ripianificazione appuntamento",
      DELEGATE_CANCEL_APPOINTMENT: "Delegato · annullamento appuntamento",
      PATIENT_UPSERT_PRETRIAGE: "Paziente · pre-triage",
      DELEGATE_UPSERT_PRETRIAGE: "Delegato · pre-triage",
      CLINICIAN_VIEW_ENCOUNTER: "Clinico · apertura encounter",
      CLINICIAN_START_ENCOUNTER: "Clinico · avvio encounter",
      CLINICIAN_ADD_ANAMNESIS: "Clinico · anamnesi",
      CLINICIAN_RECORD_VITAL_SIGN: "Clinico · parametri vitali",
      CLINICIAN_CREATE_ORDER: "Clinico · ordine clinico",
      CLINICIAN_RECORD_EXECUTION: "Clinico · esecuzione procedura",
      CLINICIAN_UPSERT_REPORT: "Clinico · referto draft",
      CLINICIAN_SIGN_REPORT: "Clinico · firma referto",
      CLINICIAN_PUBLISH_REPORT: "Clinico · pubblicazione referto",
      CLINICIAN_COMPLETE_ENCOUNTER: "Clinico · chiusura encounter",
      PATIENT_VIEW_REPORTS: "Paziente · consultazione referti",
      DELEGATE_VIEW_REPORTS: "Delegato · consultazione referti",
      PATIENT_CREATE_PAYMENT_INTENT: "Paziente · avvio pagamento",
      PATIENT_PROCESS_PAYMENT: "Paziente · pagamento",
      DELEGATE_CREATE_PAYMENT_INTENT: "Delegato · avvio pagamento",
      DELEGATE_PROCESS_PAYMENT: "Delegato · pagamento",
      ADMIN_REGISTER_IN_PERSON_PAYMENT: "Admin · pagamento in sede",
      ADMIN_RECONCILE_PAYMENT: "Admin · riconciliazione pagamento",
      ADMIN_SIMULATE_PROVIDER_OUTCOME: "Admin · simulazione esito provider",
    };

    return map[value] || value;
  }

  // Traduce il tipo entità tecnico in una label più leggibile in tabella e in modale.
  function entityLabel(raw) {
    const value = String(raw || "").trim();
    if (!value) return "—";

    const map = {
      AvailabilitySlotBatch: "Batch slot",
      AvailabilitySlot: "Slot",
      Appointment: "Appuntamento",
      PreTriageQuestionnaire: "Pre-triage",
      ClinicalEncounter: "Encounter clinico",
      AnamnesisRecord: "Anamnesi",
      VitalSign: "Parametro vitale",
      ClinicalOrder: "Ordine clinico",
      ProcedureExecution: "Esecuzione procedura",
      ClinicalReport: "Referto clinico",
      ClinicalReportCollection: "Collezione referti",
      PaymentIntent: "Intent di pagamento",
    };

    return map[value] || value;
  }

  // Converte una data locale selezionata nella UI nell’inizio del giorno in UTC.
  function toIsoStartOfDay(dateValue) {
    if (!dateValue) return "";

    const range = APL.utils.romeDateRangeToUtc(dateValue, dateValue);
    return range ? range.fromUtc : "";
  }

  // Converte una data locale selezionata nella UI nella fine del giorno in UTC.
  function toIsoEndOfDay(dateValue) {
    if (!dateValue) return "";

    const range = APL.utils.romeDateRangeToUtc(dateValue, dateValue);
    return range ? range.toUtc : "";
  }

  // Applica rapidamente un intervallo temporale predefinito ai filtri data della pagina.
  function applyQuickRange(days) {
    const toDate = APL.utils.romeTodayDateInputValue();
    const fromDate = APL.utils.addDaysToDateInput(toDate, -days);

    if ($("fromDate")) $("fromDate").value = fromDate;
    if ($("toDate")) $("toDate").value = toDate;
  }

  // Ripristina i filtri della pagina al loro stato iniziale.
  function resetFilters() {
    if ($("actorUserId")) $("actorUserId").value = "";
    if ($("actionSelect")) $("actionSelect").value = "";
    if ($("entityTypeSelect")) $("entityTypeSelect").value = "";
    if ($("entityIdInput")) $("entityIdInput").value = "";
    if ($("requestIdInput")) $("requestIdInput").value = "";
    if ($("outcomeSelect")) $("outcomeSelect").value = "";
    if ($("limitSelect")) $("limitSelect").value = "200";
    if ($("fromDate")) $("fromDate").value = "";
    if ($("toDate")) $("toDate").value = "";
  }

  // Costruisce i parametri da inviare al backend in base ai filtri "server-side".
  // Non tutti i campi della UI vengono inoltrati al backend: alcuni restano volutamente client-side.
  function buildServerParams() {
    const actorUserIdRaw = String($("actorUserId")?.value || "").trim();
    const action = String($("actionSelect")?.value || "").trim();
    const entityType = String($("entityTypeSelect")?.value || "").trim();
    const entityId = String($("entityIdInput")?.value || "").trim();
    const fromDate = String($("fromDate")?.value || "").trim();
    const toDate = String($("toDate")?.value || "").trim();
    const limit = String($("limitSelect")?.value || "200").trim();

    // Valida la coerenza dell’intervallo temporale prima di costruire la query.
    if (fromDate && toDate) {
      const fromRange = APL.utils.romeDateRangeToUtc(fromDate, fromDate);
      const toRange = APL.utils.romeDateRangeToUtc(toDate, toDate);
      const fromTime = fromRange?.fromUtc ? APL.utils.parseApiDate(fromRange.fromUtc)?.getTime() ?? NaN : NaN;
      const toTime = toRange?.toUtc ? APL.utils.parseApiDate(toRange.toUtc)?.getTime() ?? NaN : NaN;

      if (Number.isFinite(fromTime) && Number.isFinite(toTime) && fromTime > toTime) {
        throw new Error("L’intervallo temporale non è valido: la data iniziale deve precedere o coincidere con la data finale.");
      }
    }

    const qs = new URLSearchParams();

    // Il filtro attore viene inviato al backend solo se l’input è un GUID completo valido.
    // In caso contrario si lascia la ricerca parziale al livello client-side.
    if (actorUserIdRaw && isGuid(actorUserIdRaw)) {
      qs.set("actorUserId", actorUserIdRaw);
    }

    if (action) qs.set("action", action);
    if (entityType) qs.set("entityType", entityType);
    if (entityId) qs.set("entityId", entityId);

    const fromUtc = toIsoStartOfDay(fromDate);
    const toUtc = toIsoEndOfDay(toDate);

    if (fromUtc) qs.set("fromUtc", fromUtc);
    if (toUtc) qs.set("toUtc", toUtc);
    if (limit) qs.set("limit", limit);

    return qs;
  }

  // Applica alla cache locale i filtri che non richiedono una nuova query server-side.
  function applyClientFilters(items) {
    const actorTerm = String($("actorUserId")?.value || "").trim().toLowerCase();
    const requestIdTerm = String($("requestIdInput")?.value || "").trim().toLowerCase();
    const outcomeFilter = String($("outcomeSelect")?.value || "").trim().toLowerCase();

    let list = Array.isArray(items) ? items.slice() : [];

    // Filtro parziale sull’attore, utile quando non si dispone del GUID completo.
    if (actorTerm) {
      list = list.filter((item) => {
        const actor = String(item.actorUserId || "").toLowerCase();
        return actor.includes(actorTerm);
      });
    }

    // Filtro client-side sul requestId, pensato come strumento di analisi veloce.
    if (requestIdTerm) {
      list = list.filter((item) =>
        String(item.requestId || "").toLowerCase().includes(requestIdTerm)
      );
    }

    // Filtro per esito, ricavato dal metadata JSON dell’evento.
    if (outcomeFilter) {
      list = list.filter((item) => {
        const metadata = parseMetadataJson(item.metadataJson);
        return String(metadata.outcome || "").trim().toLowerCase() === outcomeFilter;
      });
    }

    return list;
  }

  // Aggiorna il riepilogo statistico visibile nella parte alta della pagina.
  function setStats(items) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;

    let succeeded = 0;
    let critical = 0;
    let latest = "—";

    for (const item of list) {
      const metadata = parseMetadataJson(item.metadataJson);
      const outcome = String(metadata.outcome || "").trim().toLowerCase();

      // Considera come critici gli esiti denied e failed.
      if (outcome === "succeeded") succeeded += 1;
      if (outcome === "denied" || outcome === "failed") critical += 1;
    }

    // La lista viene mostrata nell’ordine ricevuto/filtrato, quindi il primo elemento
    // rappresenta il più recente nel caso tipico d’uso della vista.
    if (list.length > 0) {
      latest = fmtDateTime(list[0].occurredAtUtc);
    }

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statSucceeded")) $("statSucceeded").textContent = String(succeeded);
    if ($("statCritical")) $("statCritical").textContent = String(critical);
    if ($("statLatest")) $("statLatest").textContent = latest;
  }

  // Renderizza la tabella audit e aggiorna stato vuoto e statistiche.
  function renderTable(items) {
    const tbody = $("tbody");
    if (!tbody) return;

    setStats(items);

    // In assenza di risultati visibili, attiva lo stato vuoto e mostra una riga placeholder.
    if (!Array.isArray(items) || items.length === 0) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    // Classe riutilizzata dai pulsanti azione presenti in ogni riga.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

    tbody.innerHTML = items.map((item) => {
      const metadata = parseMetadataJson(item.metadataJson);
      const outcome = String(metadata.outcome || "").trim();
      const actionText = actionLabel(item.action);
      const entityText = `${entityLabel(item.entityType)} · ${String(item.entityId || "—")}`;

      // Mostra in tabella una versione abbreviata del requestId,
      // mantenendo il valore completo nel tooltip.
      const requestIdShort = item.requestId
        ? String(item.requestId).slice(0, 12) + (String(item.requestId).length > 12 ? "…" : "")
        : "—";

      return `
        <tr>
          <td class="py-4 pr-4 text-slate-800">${escapeHtml(fmtDateTime(item.occurredAtUtc))}</td>
          <td class="py-4 pr-4">
            <div class="font-medium text-slate-900">${escapeHtml(actionText)}</div>
            <div class="mt-1 text-xs text-slate-500">${escapeHtml(String(item.action || "—"))}</div>
          </td>
          <td class="py-4 pr-4">
            <div class="text-slate-800 truncate max-w-[220px]" title="${escapeHtml(String(item.actorUserId || "—"))}">
              ${escapeHtml(String(item.actorUserId || "—"))}
            </div>
            <div class="mt-1 text-xs text-slate-500">${escapeHtml(String(metadata.role || "Ruolo non disponibile"))}</div>
          </td>
          <td class="py-4 pr-4">
            <div class="text-slate-800">${escapeHtml(entityText)}</div>
            <div class="mt-1 text-xs text-slate-500">${escapeHtml(String(item.entityType || "—"))}</div>
          </td>
          <td class="py-4 pr-4">${outcomePill(outcome)}</td>
          <td class="py-4 pr-4">
            <span class="text-slate-700" title="${escapeHtml(String(item.requestId || "—"))}">
              ${escapeHtml(requestIdShort)}
            </span>
          </td>
          <td class="py-4 text-right">
            <div class="inline-flex items-center gap-2 justify-end">
              <button type="button" class="${btnCls}" data-action="open" data-id="${escapeHtml(String(item.id))}">
                Apri
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // Riesegue il rendering della tabella applicando solo i filtri client-side
  // all’ultimo risultato disponibile nella cache locale.
  function rerenderFromClientFilters() {
    renderTable(applyClientFilters(_serverItems));
  }

  // Carica l’audit log dal backend o, se possibile, riutilizza la cache locale.
  async function loadAuditLogs(force) {
    clearError();
    setLoading(true);

    try {
      const params = buildServerParams();
      const queryKey = params.toString();

      // Se il perimetro server-side non è cambiato e abbiamo già dati in cache,
      // basta riapplicare i filtri client-side senza effettuare una nuova chiamata HTTP.
      if (!force && queryKey === _lastServerQueryKey && _serverItems.length > 0) {
        rerenderFromClientFilters();
        return;
      }

      const url = queryKey ? `${API_LIST}?${queryKey}` : API_LIST;

      const res = await APL.utils.requestJson(url, {
        headers: { Accept: "application/json", ...APL.session.authHeader() },
      });

      if (!res.ok) {
        // In caso di sessione scaduta, ripulisce l’autenticazione locale
        // e demanda il redirect al modulo auth comune.
        if (res.status === 401) {
          try {
            APL.session.clearAuth();
          } catch (_) { }
          if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
          return;
        }

        // In caso di accesso vietato, reindirizza alla pagina forbidden.
        if (res.status === 403) {
          if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
          return;
        }

        throw new Error(APL.utils.parseErrorMessage(res.data));
      }

      // Aggiorna la chiave della query e la cache locale dell’ultimo risultato server-side.
      _lastServerQueryKey = queryKey;
      _serverItems = Array.isArray(res.data) ? res.data : [];

      // Applica i filtri client-side sul nuovo dataset ricevuto.
      rerenderFromClientFilters();
    } catch (err) {
      console.error(err);

      // In caso di errore azzera la cache per evitare riusi incoerenti.
      _serverItems = [];
      _lastServerQueryKey = "";

      renderTable([]);
      showError(APL.utils.humanizeError(err) || "Impossibile caricare l’audit log.");
    } finally {
      setLoading(false);
    }
  }

  // Apre la modale con il dettaglio tecnico sintetico dell’evento audit selezionato.
  function openAuditModal(item) {
    if (!window.APL || !APL.ui || !APL.ui.modal) return;

    const metadata = parseMetadataJson(item.metadataJson);

    // Produce una rappresentazione leggibile e indentata dei metadati JSON.
    const prettyMetadata = Object.keys(metadata).length
      ? JSON.stringify(metadata, null, 2)
      : "{}";

    const bodyHtml = `
      <div class="max-h-[58vh] overflow-y-auto pr-1">
        <div class="space-y-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="rounded-2xl border bg-slate-50 p-4">
              <div class="text-xs font-medium text-slate-500">Data evento</div>
              <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(fmtDateTime(item.occurredAtUtc))}</div>
            </div>

            <div class="rounded-2xl border bg-slate-50 p-4">
              <div class="text-xs font-medium text-slate-500">Esito</div>
              <div class="mt-2">${outcomePill(String(metadata.outcome || ""))}</div>
            </div>
          </div>

          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Azione</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(actionLabel(item.action))}</div>
            <div class="mt-2 text-xs text-slate-600">${escapeHtml(String(item.action || "—"))}</div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="rounded-2xl border bg-white p-4">
              <div class="text-xs font-medium text-slate-500">Attore</div>
              <div class="mt-1 text-sm font-semibold text-slate-900 break-words">${escapeHtml(String(item.actorUserId || "—"))}</div>
              <div class="mt-2 text-xs text-slate-600">${escapeHtml(String(metadata.role || "Ruolo non disponibile"))}</div>
            </div>

            <div class="rounded-2xl border bg-white p-4">
              <div class="text-xs font-medium text-slate-500">RequestId</div>
              <div class="mt-1 text-sm font-semibold text-slate-900 break-words">${escapeHtml(String(item.requestId || "—"))}</div>
            </div>
          </div>

          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Entità</div>
            <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(entityLabel(item.entityType))}</div>
            <div class="mt-2 text-xs text-slate-600 break-words">
              EntityType: ${escapeHtml(String(item.entityType || "—"))}<br />
              EntityId: ${escapeHtml(String(item.entityId || "—"))}
            </div>
          </div>

          <div class="rounded-2xl border bg-white p-4">
            <div class="text-xs font-medium text-slate-500">Richiesta HTTP</div>
            <div class="mt-2 text-sm text-slate-800">
              <div><span class="font-medium">Metodo:</span> ${escapeHtml(String(metadata.method || "—"))}</div>
              <div class="mt-1 break-words"><span class="font-medium">Path:</span> ${escapeHtml(String(metadata.path || "—"))}</div>
              <div class="mt-1 break-words"><span class="font-medium">Query string:</span> ${escapeHtml(String(metadata.queryString || "—"))}</div>
            </div>
          </div>

          <div>
            <div class="text-xs font-medium text-slate-500">Metadata JSON</div>
            <pre class="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800 leading-relaxed rounded-2xl border bg-slate-50 p-4 max-h-[30vh] overflow-auto">${escapeHtml(prettyMetadata)}</pre>
          </div>
        </div>
      </div>
    `;

    APL.ui.modal.open({
      title: "Dettaglio audit",
      bodyHtml,
      actions: [{ label: "Chiudi", kind: "primary", closeOnClick: true }],
    });
  }

  // Collega tutti i controlli della pagina ai relativi comportamenti.
  function bindEvents() {
    $("btnResetFilters")?.addEventListener("click", async () => {
      resetFilters();
      await loadAuditLogs(true);
    });

    $("btnEmptyReset")?.addEventListener("click", async () => {
      resetFilters();
      await loadAuditLogs(true);
    });

    $("btnLast24h")?.addEventListener("click", async () => {
      applyQuickRange(1);
      await loadAuditLogs(true);
    });

    $("btnLast7d")?.addEventListener("click", async () => {
      applyQuickRange(7);
      await loadAuditLogs(true);
    });

    $("btnLast30d")?.addEventListener("click", async () => {
      applyQuickRange(30);
      await loadAuditLogs(true);
    });

    // Il filtro attore ha un comportamento ibrido:
    // - se l’input è un GUID completo, richiede un nuovo fetch server-side;
    // - altrimenti applica solo un filtro parziale client-side.
    $("actorUserId")?.addEventListener("input", () => {
      const value = String($("actorUserId")?.value || "").trim();
      if (isGuid(value)) {
        loadAuditLogs(true);
        return;
      }
      rerenderFromClientFilters();
    });

    // RequestId ed esito sono filtri esclusivamente client-side.
    $("requestIdInput")?.addEventListener("input", () => {
      rerenderFromClientFilters();
    });

    $("outcomeSelect")?.addEventListener("change", () => {
      rerenderFromClientFilters();
    });

    // Azione, entità, limite e intervallo temporale modificano il perimetro server-side.
    ["actionSelect", "entityTypeSelect", "limitSelect", "fromDate", "toDate"].forEach((id) => {
      $(id)?.addEventListener("change", () => {
        loadAuditLogs(true);
      });
    });

    // Per l’entityId la ricerca server-side viene esplicitamente lanciata alla pressione di Enter.
    $("entityIdInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        loadAuditLogs(true);
      }
    });

    // Event delegation sulla tabella per l’apertura del dettaglio audit.
    $("tbody")?.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action='open']");
      if (!button) return;

      const id = String(button.getAttribute("data-id") || "");
      const item = _serverItems.find((x) => String(x.id) === id);
      if (!item) return;

      openAuditModal(item);
    });
  }

  // Inizializza la pagina quando il DOM è pronto.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non possiede il ruolo amministrativo richiesto.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // All’avvio la vista viene impostata sugli ultimi 30 giorni.
    applyQuickRange(30);

    // Collega gli eventi della pagina.
    bindEvents();

    // Carica i dati iniziali.
    await loadAuditLogs(true);
  }

  // Avvia l’inizializzazione al completamento del parsing del documento.
  document.addEventListener("DOMContentLoaded", init);
})();
