/**
 * File: frontend/js/clinician/encounter-detail.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina di dettaglio visita del
 * clinico, comprendendo il caricamento dell’appuntamento e dell’eventuale
 * encounter associato, la visualizzazione del pre-triage, la registrazione
 * delle attività cliniche (anamnesi, parametri vitali, ordini, esecuzioni),
 * la gestione del referto e il controllo delle transizioni di stato della visita.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Dettaglio visita"
 * dell’area Clinician. Si integra con i moduli condivisi del front-end per
 * autenticazione, sessione, richieste HTTP, toast, modali e utilità di data,
 * e dialoga con i domini Scheduling, Clinical e Catalog per permettere al
 * professionista sanitario di gestire l’intero flusso clinico di una visita.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Clinician;
 * - leggere dall’URL l’identificativo dell’appuntamento o dell’encounter;
 * - recuperare appuntamento, encounter, pre-triage e catalogo prestazioni;
 * - popolare il riepilogo dell’appuntamento e lo stato della visita;
 * - mostrare o nascondere i blocchi della UI in base allo stato dell’encounter;
 * - registrare anamnesi, parametri vitali, ordini clinici ed esecuzioni;
 * - gestire la bozza del referto, la firma, la pubblicazione e la chiusura visita;
 * - aggiornare dinamicamente hint operativi, pulsanti e sezioni della pagina;
 * - gestire errori globali, loading e feedback utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.session.clearAuth` nei casi di sessione non più valida;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.parseApiDate` e `APL.utils.toast`;
 * - utilizza `APL.ui.modal` per conferme, input guidati e registrazione esecuzioni;
 * - interagisce con gli endpoint:
 *   `/api/scheduling/clinicians/me/appointments`,
 *   `/api/catalog/services`,
 *   `/api/clinical/clinicians/me/encounters`,
 *   `/api/clinical/clinicians/me/pretriage/appointments/{appointmentId}`,
 *   `/api/clinical/clinicians/me/orders/{orderId}/executions`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina gestisce sia il caso in cui l’encounter esista già, sia il caso in
 * cui si parta da un semplice appuntamento ancora non avviato.
 */

(function () {
  "use strict";

  // Ruolo richiesto per l’accesso alla vista di dettaglio visita.
  const EXPECTED_ROLE = "Clinician";

  // Endpoint per il recupero degli appuntamenti del clinico autenticato.
  const API_CLINICIAN_APPTS = "/api/scheduling/clinicians/me/appointments";

  // Endpoint del catalogo prestazioni, utile per arricchire ordini e servizi.
  const API_SERVICES = "/api/catalog/services";

  // Endpoint base per la gestione degli encounter del clinico autenticato.
  const API_CLINICIAN_ENCOUNTERS = "/api/clinical/clinicians/me/encounters";

  // Endpoint base per il recupero del pre-triage legato a un appuntamento.
  const API_PRETRIAGE = "/api/clinical/clinicians/me/pretriage/appointments";

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

  // Aggiorna lo stato di caricamento globale della pagina e disabilita temporaneamente
  // i controlli principali per evitare azioni concorrenti durante operazioni asincrone.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const idsToDisable = [
      "btnStartEncounter",
      "btnStartEncounterInline",
      "btnCompleteEncounter",
      "btnSignReport",
      "btnSignReportInline",
      "btnPublishReport",
      "btnPublishReportInline",
      "btnSaveDraft",
      "btnAddAnamnesis",
      "btnAddVital",
      "btnAddOrder",
      "anamnesisContent",
      "vitalType",
      "vitalValue",
      "vitalUnit",
      "orderService",
      "orderNotes",
      "reportContent",
    ];

    for (const id of idsToDisable) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Formattta una data/ora API in una forma leggibile per un utente italiano.
  // Permette opzionalmente di passare opzioni di formattazione custom.
  function fmtDateTime(isoUtc, opts) {
    if (!isoUtc) return "—";

    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    return d.toLocaleString(
      "it-IT",
      opts || {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  // Formattta solo la componente data in forma breve.
  function fmtDate(isoUtc) {
    if (!isoUtc) return "—";

    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    return d.toLocaleDateString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  // Restituisce un badge HTML per rappresentare visivamente stati e risultati.
  function statusPill(label, tone) {
    const cls =
      tone === "blue"
        ? "bg-blue-50 text-blue-700"
        : tone === "amber"
          ? "bg-amber-50 text-amber-800"
          : tone === "emerald"
            ? "bg-emerald-50 text-emerald-700"
            : tone === "red"
              ? "bg-red-50 text-red-700"
              : "bg-slate-100 text-slate-700";

    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}">${escapeHtml(label)}</span>`;
  }

  // Normalizza uno stato eterogeneo in un formato uniforme confrontabile.
  function normalizeStatus(raw) {
    return String(raw || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
  }

  // Traduce lo stato tecnico dell’appuntamento in una label utente e in una tonalità semantica.
  function mapAppointmentStatus(raw) {
    const s = normalizeStatus(raw);

    if (s === "BOOKED") return { label: "Prenotato", tone: "blue" };
    if (s === "CHECKED_IN") return { label: "Accettato", tone: "amber" };
    if (s === "COMPLETED") return { label: "Completato", tone: "emerald" };
    if (s === "CANCELED" || s === "CANCELLED") return { label: "Annullato", tone: "slate" };
    if (s === "NO_SHOW") return { label: "Assente", tone: "slate" };

    return { label: raw || "—", tone: "slate" };
  }

  // Determina lo stato sintetico dell’encounter a partire dai dettagli caricati.
  function encounterState(detail) {
    const ended = detail?.encounter?.endedAtUtc || detail?.Encounter?.EndedAtUtc || null;
    if (ended) return { label: "Visita conclusa", tone: "emerald" };
    return { label: "Visita in corso", tone: "blue" };
  }

  // Restituisce una rappresentazione stringa dell’identificativo letto dalla querystring.
  // La funzione è volutamente permissiva: in questa vista non si impone formato UUID stretto.
  function parseGuidLike(v) {
    const s = String(v || "").trim();
    if (!s) return null;
    return s;
  }

  // Legge dalla querystring gli identificativi rilevanti per la pagina.
  // La vista può essere aperta partendo da appointmentId o direttamente da encounterId.
  function readQuery() {
    const q = new URLSearchParams(window.location.search || "");
    return {
      appointmentId: parseGuidLike(q.get("appointmentId")),
      encounterId: parseGuidLike(q.get("encounterId")),
    };
  }

  // Attende che il sistema modale condiviso sia pronto prima di usarlo.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();

    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione coerente
  // di sessione scaduta, accesso vietato ed errori applicativi generici.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // Se la sessione è scaduta, ripulisce l’autenticazione locale e reindirizza.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Se l’utente non ha i privilegi richiesti, reindirizza alla vista forbidden.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Negli altri casi prova a ricostruire un messaggio applicativo leggibile.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Costruisce un intervallo ISO centrato attorno a una data base, utile per cercare
  // appuntamenti o encounter in un perimetro temporale sufficientemente ampio.
  function isoRangeAround(isoUtc, days) {
    const base = isoUtc ? APL.utils.parseApiDate(isoUtc) : null;
    const d = base && Number.isFinite(base.getTime()) ? base : new Date();
    const from = new Date(d.getTime() - days * 24 * 60 * 60 * 1000);
    const to = new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
    return { fromUtc: from.toISOString(), toUtc: to.toISOString() };
  }

  // Normalizza il payload di un appuntamento del clinico in una struttura uniforme lato client.
  function normalizeClinicianAppt(x) {
    return {
      appointmentId: x?.appointmentId || x?.id || x?.AppointmentId || null,
      slotId: x?.slotId || x?.SlotId || null,
      patientUserId: x?.patientUserId || x?.PatientUserId || null,
      patientDisplayName: x?.patientDisplayName || x?.PatientDisplayName || null,
      serviceId: x?.serviceId || x?.ServiceId || null,
      serviceCode: x?.serviceCode || x?.ServiceCode || null,
      status: x?.status || x?.Status || null,
      startUtc: x?.startUtc || x?.StartUtc || null,
      endUtc: x?.endUtc || x?.EndUtc || null,
      notes: x?.notes || x?.Notes || null,
      raw: x,
    };
  }

  // Imposta il contenuto testuale di un elemento DOM, usando un placeholder quando necessario.
  // Se richiesto, copia il testo anche nell’attributo title per supportare tooltip naturali.
  function setText(id, value, titleIfTruncate = false) {
    const el = $(id);
    if (!el) return;

    el.textContent = value == null || value === "" ? "—" : String(value);
    if (titleIfTruncate) el.title = el.textContent;
  }

  // Imposta direttamente l’HTML di un elemento DOM.
  function setHtml(id, html) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = html || "";
  }

  // Mostra o nasconde un elemento DOM tramite la classe `hidden`.
  function setVisible(id, visible) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("hidden", !visible);
  }

  // Verifica se l’appuntamento risulta già accettato.
  function isCheckedIn(appt) {
    const s = normalizeStatus(appt?.status);
    return s === "CHECKED_IN";
  }

  // Verifica se l’appuntamento è in uno stato finale che non consente ulteriori azioni operative.
  function isAppointmentClosed(appt) {
    const s = normalizeStatus(appt?.status);
    return s === "COMPLETED" || s === "CANCELED" || s === "CANCELLED" || s === "NO_SHOW";
  }

  // Verifica se l’encounter è stato formalmente chiuso.
  function isEncounterClosed(detail) {
    const ended = detail?.encounter?.endedAtUtc;
    return !!ended;
  }

  // Aggiorna il messaggio contestuale che guida il clinico rispetto allo stato della visita.
  function updateActionHint(appt, detail) {
    const hint = $("actionHint");
    if (!hint) return;

    if (!appt) {
      hint.textContent = "Impossibile determinare lo stato della visita.";
      return;
    }

    // Se esiste già un encounter, il suggerimento dipende dallo stato dell’encounter e del referto.
    if (detail?.encounter?.id) {
      if (isEncounterClosed(detail)) {
        hint.textContent = "Visita conclusa: attività cliniche non modificabili.";
      } else {
        const reportStatus = String(detail?.report?.status || "").toUpperCase();

        if (reportStatus === "SIGNED") {
          hint.textContent = "Referto firmato: il contenuto è congelato ed è possibile procedere con la pubblicazione.";
        } else if (reportStatus === "PUBLISHED") {
          hint.textContent = "Referto pubblicato: è ancora possibile concludere formalmente la visita.";
        } else {
          hint.textContent = "Visita attiva: è possibile registrare attività cliniche, salvare la bozza del referto e firmarla.";
        }
      }
      return;
    }

    // Se non esiste ancora encounter, l’indicazione dipende dallo stato dell’appuntamento.
    if (isCheckedIn(appt)) {
      hint.textContent = "Accettazione completata: è possibile avviare la visita.";
      return;
    }

    hint.textContent = "Per avviare la visita è necessario che l’accettazione risulti completata.";
  }

  // Aggiorna lo stato abilitato/disabilitato dei pulsanti e dei form della pagina
  // in base allo stato dell’appuntamento, dell’encounter e del referto.
  function applyActionsEnabled(appt, detail) {
    const hasEncounter = !!detail?.encounter?.id;

    const startBtns = [$("btnStartEncounter"), $("btnStartEncounterInline")].filter(Boolean);
    const completeBtn = $("btnCompleteEncounter");
    const signBtns = [$("btnSignReport"), $("btnSignReportInline")].filter(Boolean);
    const publishBtns = [$("btnPublishReport"), $("btnPublishReportInline")].filter(Boolean);
    const saveDraftBtn = $("btnSaveDraft");

    // L’avvio visita è possibile solo se l’appuntamento è checked-in e non esiste ancora un encounter.
    for (const b of startBtns) b.disabled = !(appt && isCheckedIn(appt) && !hasEncounter);

    // La conclusione è possibile solo se l’encounter esiste e non è già concluso.
    if (completeBtn) completeBtn.disabled = !(hasEncounter && !isEncounterClosed(detail));

    const report = detail?.report || null;
    const reportStatus = String(report?.status || "").toUpperCase();

    // La firma è ammessa solo su un report in bozza.
    const canSign = hasEncounter && !isEncounterClosed(detail) && report && reportStatus === "DRAFT";

    // La pubblicazione è ammessa solo su un report già firmato.
    const canPublish = hasEncounter && !isEncounterClosed(detail) && report && reportStatus === "SIGNED";

    for (const b of signBtns) b.disabled = !canSign;
    for (const b of publishBtns) b.disabled = !canPublish;

    // Il salvataggio bozza è ammesso solo su encounter attivo e su report assente o in stato draft.
    const canSaveDraft = hasEncounter && !isEncounterClosed(detail) && (!report || reportStatus === "DRAFT");
    if (saveDraftBtn) saveDraftBtn.disabled = !canSaveDraft;

    // Le attività cliniche strutturate sono consentite solo durante un encounter attivo.
    const canWriteClinical = hasEncounter && !isEncounterClosed(detail);
    const formIds = [
      "anamnesisContent",
      "btnAddAnamnesis",
      "vitalType",
      "vitalValue",
      "vitalUnit",
      "btnAddVital",
      "orderService",
      "orderNotes",
      "btnAddOrder",
    ];

    for (const id of formIds) {
      const el = $(id);
      if (el) el.disabled = !canWriteClinical;
    }

    // Il contenuto del referto resta modificabile solo in assenza di report o in stato draft.
    const reportContent = $("reportContent");
    if (reportContent) reportContent.readOnly = !(hasEncounter && (!report || reportStatus === "DRAFT"));
  }

  // Renderizza il riepilogo dell’appuntamento nel pannello alto della pagina.
  function renderAppointment(appt, serviceMap) {
    setText("patientName", appt?.patientDisplayName || "—");
    setText("patientHint", appt?.patientUserId ? "Profilo paziente collegato alla prenotazione." : "—");

    const m = mapAppointmentStatus(appt?.status);
    setHtml("appointmentStatusPill", statusPill(m.label, m.tone));

    setText(
      "appointmentWhen",
      fmtDateTime(appt?.startUtc, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    );

    const windowText = appt?.endUtc ? `Finestra: ${fmtDateTime(appt.endUtc)}` : "—";
    setText("appointmentWindow", windowText);

    const svc = appt?.serviceId ? serviceMap.get(String(appt.serviceId)) : null;
    setText("serviceName", svc?.name || "Prestazione");
    setText("serviceCode", appt?.serviceCode ? `Codice: ${appt.serviceCode}` : "Codice: —");

    const notes = appt?.notes ? String(appt.notes) : "Nessuna nota associata.";
    setText("appointmentNotes", notes);
  }

  // Renderizza la sezione di pre-triage, mostrando il contenuto quando disponibile.
  function renderPretriage(dto) {
    const empty = $("pretriageEmpty");
    const box = $("pretriageBox");
    const content = $("pretriageContent");

    if (!dto || !dto.content) {
      if (empty) empty.classList.remove("hidden");
      if (box) box.classList.add("hidden");
      if (content) content.textContent = "";
      return;
    }

    if (empty) empty.classList.add("hidden");
    if (box) box.classList.remove("hidden");
    if (content) content.textContent = String(dto.content || "");
  }

  // Renderizza la lista delle anamnesi in ordine decrescente di creazione.
  function renderAnamneses(list) {
    const host = $("anamnesisList");
    const empty = $("anamnesisEmpty");
    if (!host || !empty) return;

    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
      host.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }

    empty.classList.add("hidden");

    const cards = items
      .slice()
      .sort((a, b) => (APL.utils.parseApiDate(b.createdAtUtc)?.getTime() || 0) - (APL.utils.parseApiDate(a.createdAtUtc)?.getTime() || 0))
      .map((a) => {
        const when = fmtDateTime(a.createdAtUtc);
        const content = escapeHtml(a.content || "");
        return `
          <div class="rounded-2xl border bg-slate-50 p-4">
            <div class="flex items-center justify-between gap-3">
              <div class="text-xs font-medium text-slate-500">Registrata</div>
              <div class="text-xs text-slate-600">${escapeHtml(when)}</div>
            </div>
            <div class="mt-2 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap break-words">${content}</div>
          </div>
        `;
      })
      .join("");

    host.innerHTML = cards;
  }

  // Renderizza la tabella dei parametri vitali ordinandoli dal più recente.
  function renderVitalSigns(list) {
    const tbody = $("vitalSignsTbody");
    if (!tbody) return;

    const items = Array.isArray(list) ? list : [];
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-600">Nessun valore registrato.</td></tr>`;
      return;
    }

    const rows = items
      .slice()
      .sort(
        (a, b) =>
          (APL.utils.parseApiDate(b.measuredAtUtc || b.MeasuredAtUtc)?.getTime() || 0) -
          (APL.utils.parseApiDate(a.measuredAtUtc || a.MeasuredAtUtc)?.getTime() || 0)
      )
      .map((v) => {
        const when = fmtDateTime(v.measuredAtUtc || v.MeasuredAtUtc);
        const type = escapeHtml(v.type || v.Type || "—");
        const value = escapeHtml(String(v.value ?? v.Value ?? "—"));
        const unit = escapeHtml(v.unit || v.Unit || "—");

        return `
          <tr>
            <td class="py-4 pr-4 text-slate-800">${when}</td>
            <td class="py-4 pr-4 text-slate-700">${type}</td>
            <td class="py-4 pr-4 text-slate-700">${value}</td>
            <td class="py-4 pr-4 text-slate-700">${unit}</td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = rows;
  }

  // Raggruppa le esecuzioni cliniche per ordine, così da facilitarne la resa in tabella.
  function groupExecutionsByOrder(executions) {
    const m = new Map();
    const items = Array.isArray(executions) ? executions : [];

    for (const e of items) {
      const orderId = String(e.orderId || e.OrderId || "");
      if (!orderId) continue;
      if (!m.has(orderId)) m.set(orderId, []);
      m.get(orderId).push(e);
    }

    return m;
  }

  // Renderizza la tabella ordini e procedure, arricchendo ogni ordine con le sue esecuzioni.
  function renderOrders(orders, executions, serviceMap) {
    const tbody = $("ordersTbody");
    if (!tbody) return;

    const list = Array.isArray(orders) ? orders : [];
    const exByOrder = groupExecutionsByOrder(executions);

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-600">Nessun ordine registrato.</td></tr>`;
      return;
    }

    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

    const rows = list
      .slice()
      .sort((a, b) => (APL.utils.parseApiDate(b.createdAtUtc)?.getTime() || 0) - (APL.utils.parseApiDate(a.createdAtUtc)?.getTime() || 0))
      .map((o) => {
        const when = fmtDate(o.createdAtUtc);
        const status = escapeHtml(String(o.status || "—"));
        const notes = o.notes ? escapeHtml(String(o.notes)) : "—";

        const cid = String(o.catalogItemId || "");
        const svc = cid ? serviceMap.get(cid) : null;
        const svcLabel = svc?.name ? `${svc.name}` : cid ? "Prestazione" : "—";
        const svcCode = svc?.code ? ` (${svc.code})` : "";

        const orderId = String(o.id || "");
        const exList = exByOrder.get(orderId) || [];
        const exCount = exList.length;

        // Mostra un hint sintetico sul numero di esecuzioni e, se presente, sull’ultimo esito registrato.
        let exHint = exCount ? `${exCount} esecuz.` : "—";
        if (exCount) {
          const latest = exList
            .slice()
            .sort((a, b) => (APL.utils.parseApiDate(b.performedAtUtc)?.getTime() || 0) - (APL.utils.parseApiDate(a.performedAtUtc)?.getTime() || 0))[0];
          const out = latest?.outcome ? String(latest.outcome) : "";
          if (out) exHint = `${exCount} esecuz. (ultimo esito: ${out})`;
        }

        return `
          <tr>
            <td class="py-4 pr-4 text-slate-800">${escapeHtml(when)}</td>
            <td class="py-4 pr-4 text-slate-700">
              <div class="font-medium text-slate-900">${escapeHtml(svcLabel)}${escapeHtml(svcCode)}</div>
              <div class="mt-1 text-xs text-slate-600">${escapeHtml(exHint)}</div>
            </td>
            <td class="py-4 pr-4 text-slate-700">${status}</td>
            <td class="py-4 pr-4 text-slate-600 max-w-[320px] truncate" title="${escapeHtml(notes)}">${notes}</td>
            <td class="py-4 text-right">
              <button type="button" class="${btnCls}" data-action="record-exec" data-order-id="${escapeHtml(orderId)}">
                Registra esecuzione
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = rows;
  }

  // Renderizza la sezione referto mostrando stato, metadati e contenuto attuale.
  function renderReport(report) {
    const statusEl = $("reportStatus");
    const metaEl = $("reportMeta");
    const ta = $("reportContent");

    if (!statusEl || !metaEl || !ta) return;

    if (!report) {
      statusEl.textContent = "Non disponibile";
      metaEl.textContent = "Creare una bozza per procedere.";
      ta.value = "";
      return;
    }

    const st = String(report.status || "").toUpperCase();

    if (st === "PUBLISHED") {
      statusEl.textContent = "Pubblicato";
    } else if (st === "SIGNED") {
      statusEl.textContent = "Firmato";
    } else {
      statusEl.textContent = "Bozza";
    }

    const created = report.createdAtUtc ? fmtDateTime(report.createdAtUtc) : "—";
    const signed = report.signedAtUtc ? fmtDateTime(report.signedAtUtc) : null;
    const published = report.publishedAtUtc ? fmtDateTime(report.publishedAtUtc) : null;

    if (published && signed) {
      metaEl.textContent = `Creato: ${created} · Firmato: ${signed} · Pubblicato: ${published}`;
    } else if (published) {
      metaEl.textContent = `Creato: ${created} · Pubblicato: ${published}`;
    } else if (signed) {
      metaEl.textContent = `Creato: ${created} · Firmato: ${signed}`;
    } else {
      metaEl.textContent = `Creato: ${created}`;
    }

    ta.value = String(report.content || "");
  }

  // Renderizza l’intero dettaglio encounter, pilotando anche la visibilità del blocco
  // "visita non ancora avviata" e resettando le sezioni quando l’encounter non esiste.
  function renderEncounterDetail(detail) {
    const has = !!detail?.encounter?.id;

    setVisible("notStartedBox", !has);

    if (!has) {
      setHtml("encounterStatusPill", statusPill("Non avviata", "slate"));
      setText("encounterRef", "—", true);
      setText("encounterStart", "—");
      setText("encounterEnd", "—");
      setText("encounterNotesBox", "—");
      renderAnamneses([]);
      renderVitalSigns([]);
      renderOrders([], [], new Map());
      renderReport(null);
      return;
    }

    const es = encounterState(detail);
    setHtml("encounterStatusPill", statusPill(es.label, es.tone));

    setText("encounterRef", detail.encounter.id ? String(detail.encounter.id) : "—", true);
    setText("encounterStart", detail.encounter.startedAtUtc ? fmtDateTime(detail.encounter.startedAtUtc) : "—");
    setText("encounterEnd", detail.encounter.endedAtUtc ? fmtDateTime(detail.encounter.endedAtUtc) : "—");

    const notes = detail.encounter.notes ? String(detail.encounter.notes) : "Nessuna nota di apertura.";
    setText("encounterNotesBox", notes);

    renderAnamneses(detail.anamneses);
    renderVitalSigns(detail.vitalSigns);
    renderReport(detail.report);
  }

  // Recupera gli appuntamenti del clinico nel range temporale indicato.
  async function fetchAppointmentsRange(fromUtc, toUtc) {
    const params = new URLSearchParams();
    params.set("fromUtc", fromUtc);
    params.set("toUtc", toUtc);
    const data = await apiJson("GET", `${API_CLINICIAN_APPTS}?${params.toString()}`);
    return Array.isArray(data) ? data : [];
  }

  // Cerca un appuntamento specifico per id, allargando se necessario il perimetro temporale di ricerca.
  async function fetchAppointmentById(appointmentId) {
    const r = isoRangeAround(null, 180);
    const list = (await fetchAppointmentsRange(r.fromUtc, r.toUtc)).map(normalizeClinicianAppt);

    const found =
      list.find((x) => String(x.appointmentId) === String(appointmentId)) ||
      list.find((x) => String(x.raw?.appointmentId) === String(appointmentId)) ||
      null;

    if (found) return found;

    // Se non trovato nel primo tentativo, amplia ulteriormente il range di ricerca.
    const r2 = isoRangeAround(null, 365);
    const list2 = (await fetchAppointmentsRange(r2.fromUtc, r2.toUtc)).map(normalizeClinicianAppt);

    return list2.find((x) => String(x.appointmentId) === String(appointmentId)) || null;
  }

  // Carica il catalogo prestazioni e lo indicizza per id.
  // In caso di errore restituisce comunque una mappa vuota per non bloccare la pagina.
  async function fetchServicesMap() {
    try {
      const data = await apiJson("GET", API_SERVICES);
      const list = Array.isArray(data) ? data : [];
      const map = new Map();

      for (const s of list) {
        if (!s || !s.id) continue;
        map.set(String(s.id), {
          id: String(s.id),
          code: s.code ? String(s.code) : "",
          name: s.name ? String(s.name) : "Prestazione",
        });
      }

      return map;
    } catch (_) {
      return new Map();
    }
  }

  // Popola il selettore delle prestazioni usato per la creazione di nuovi ordini.
  function fillOrderServicesSelect(serviceMap) {
    const sel = $("orderService");
    if (!sel) return;

    const current = String(sel.value || "");
    const items = Array.from(serviceMap.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "it")
    );

    const opts = [
      `<option value="">Selezionare…</option>`,
      ...items.map((s) => {
        const label = s.code
          ? `${escapeHtml(s.name)} (${escapeHtml(s.code)})`
          : `${escapeHtml(s.name)}`;
        return `<option value="${escapeHtml(s.id)}">${label}</option>`;
      }),
    ];

    sel.innerHTML = opts.join("");
    if (current) sel.value = current;
  }

  // Cerca l’eventuale encounter associato all’appuntamento corrente.
  async function findEncounterIdForAppointment(appt) {
    const r = isoRangeAround(appt?.startUtc, 60);
    const params = new URLSearchParams();
    params.set("fromUtc", r.fromUtc);
    params.set("toUtc", r.toUtc);

    const data = await apiJson("GET", `${API_CLINICIAN_ENCOUNTERS}?${params.toString()}`);
    const list = Array.isArray(data) ? data : [];

    const found = list.find((e) => String(e.appointmentId) === String(appt.appointmentId)) || null;
    return found?.id ? String(found.id) : null;
  }

  // Recupera il dettaglio completo di un encounter.
  async function fetchEncounterDetails(encounterId) {
    return await apiJson("GET", `${API_CLINICIAN_ENCOUNTERS}/${encodeURIComponent(String(encounterId))}`);
  }

  // Recupera il pre-triage dell’appuntamento, se disponibile.
  // Un eventuale 404 viene trattato come assenza fisiologica del questionario.
  async function fetchPretriage(appointmentId) {
    try {
      const dto = await apiJson("GET", `${API_PRETRIAGE}/${encodeURIComponent(String(appointmentId))}`);
      return dto || null;
    } catch (err) {
      const st = Number(err?.status || 0);
      if (st === 404) return null;
      return null;
    }
  }

  // Apre la modale di avvio visita, consentendo l’inserimento facoltativo
  // di una nota di apertura encounter.
  async function openStartEncounterModal() {
    const ok = await ensureModalReady(10000);
    if (!ok) {
      APL.utils.toast("Interfaccia in caricamento. Riprovi tra qualche istante.", "error");
      return null;
    }

    return await new Promise((resolve) => {
      const body = `
        <div class="space-y-3">
          <div class="text-sm text-slate-700 leading-relaxed">
            Inserire un’eventuale nota di apertura (facoltativa).
          </div>
          <label class="text-sm font-medium text-slate-700" for="startEncounterNotes">Nota</label>
          <textarea id="startEncounterNotes" rows="4"
            class="mt-2 w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            placeholder="Facoltativa"></textarea>
        </div>
      `;

      APL.ui.modal.open({
        title: "Avvia visita",
        bodyHtml: body,
        actions: [
          {
            label: "Annulla",
            kind: "secondary",
            closeOnClick: true,
            onClick: () => resolve(null),
          },
          {
            label: "Conferma",
            kind: "primary",
            closeOnClick: true,
            onClick: () => {
              const ta = document.getElementById("startEncounterNotes");
              const notes = ta ? String(ta.value || "").trim() : "";
              resolve(notes);
            },
          },
        ],
      });
    });
  }

  // Apre una modale di conferma generica per azioni sensibili o irreversibili.
  async function confirmAction(title, message, dangerLabel) {
    const ok = await ensureModalReady(10000);
    if (!ok) return false;

    return await new Promise((resolve) => {
      const body = `
        <div class="space-y-3">
          <div class="text-sm text-slate-700 leading-relaxed">${escapeHtml(message)}</div>
        </div>
      `;

      APL.ui.modal.open({
        title,
        bodyHtml: body,
        actions: [
          { label: "Annulla", kind: "secondary", closeOnClick: true, onClick: () => resolve(false) },
          { label: dangerLabel || "Conferma", kind: "danger", closeOnClick: true, onClick: () => resolve(true) },
        ],
      });
    });
  }

  // Apre la modale che consente di registrare un’esecuzione clinica per un ordine.
  async function openRecordExecutionModal() {
    const ok = await ensureModalReady(10000);
    if (!ok) return null;

    return await new Promise((resolve) => {
      const body = `
        <div class="space-y-4">
          <div class="text-sm text-slate-700 leading-relaxed">
            Registrare l’esito della procedura e, se necessario, aggiungere una nota.
          </div>

          <div>
            <label class="text-sm font-medium text-slate-700" for="execOutcome">Esito</label>
            <input id="execOutcome" type="text" placeholder="Es. Completata, Negativa, Positiva…"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100" />
          </div>

          <div>
            <label class="text-sm font-medium text-slate-700" for="execNotes">Note</label>
            <textarea id="execNotes" rows="4" placeholder="Facoltative"
              class="mt-2 w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"></textarea>
          </div>
        </div>
      `;

      APL.ui.modal.open({
        title: "Registra esecuzione",
        bodyHtml: body,
        actions: [
          { label: "Annulla", kind: "secondary", closeOnClick: true, onClick: () => resolve(null) },
          {
            label: "Conferma",
            kind: "primary",
            closeOnClick: true,
            onClick: () => {
              const outcome = String(document.getElementById("execOutcome")?.value || "").trim();
              const notes = String(document.getElementById("execNotes")?.value || "").trim();

              if (!outcome) {
                APL.utils.toast("Inserire un esito per procedere.", "error");
                resolve(null);
                return;
              }

              resolve({ outcome, notes: notes || null });
            },
          },
        ],
      });
    });
  }

  // Stato locale della pagina:
  // - _appointment: appuntamento corrente;
  // - _serviceMap: catalogo prestazioni indicizzato;
  // - _encounterId: eventuale encounter corrente;
  // - _detail: dettaglio completo dell’encounter.
  let _appointment = null;
  let _serviceMap = new Map();
  let _encounterId = null;
  let _detail = null;

  // Carica l’intero stato necessario alla pagina e aggiorna tutte le sezioni rilevanti.
  async function loadAll() {
    clearError();
    setLoading(true);

    try {
      const { appointmentId, encounterId } = readQuery();

      _serviceMap = await fetchServicesMap();
      fillOrderServicesSelect(_serviceMap);

      // Se la pagina è stata aperta partendo da encounterId, carica prima l’encounter
      // e usa il suo appointmentId per recuperare l’appuntamento.
      if (encounterId) {
        _encounterId = encounterId;
        _detail = await fetchEncounterDetails(_encounterId);
        const apptId = _detail?.encounter?.appointmentId ? String(_detail.encounter.appointmentId) : null;

        if (!apptId) throw new Error("Dati visita non disponibili.");

        _appointment = await fetchAppointmentById(apptId);
        if (!_appointment) throw new Error("Prenotazione non disponibile.");
      } else {
        // Se la pagina è stata aperta partendo da appointmentId, recupera l’appuntamento
        // e cerca se esiste già un encounter associato.
        if (!appointmentId) throw new Error("Informazioni visita non disponibili.");
        _appointment = await fetchAppointmentById(appointmentId);
        if (!_appointment) throw new Error("Prenotazione non disponibile.");

        _encounterId = await findEncounterIdForAppointment(_appointment);
        _detail = _encounterId ? await fetchEncounterDetails(_encounterId) : null;
      }

      renderAppointment(_appointment, _serviceMap);

      const pre = _appointment?.appointmentId ? await fetchPretriage(_appointment.appointmentId) : null;
      renderPretriage(pre);

      if (_detail) {
        renderEncounterDetail(_detail);
      } else {
        // In assenza di encounter la pagina resta in stato pre-avvio.
        renderEncounterDetail(null);
        renderOrders([], [], _serviceMap);
        renderReport(null);
      }

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);

      // Se il dettaglio encounter contiene ordini o esecuzioni, aggiorna anche quella sezione.
      if (_detail?.orders || _detail?.executions) {
        renderOrders(_detail.orders, _detail.executions, _serviceMap);
      } else {
        renderOrders([], [], _serviceMap);
      }

      if (_detail?.report) {
        renderReport(_detail.report);
      }
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare i dettagli.");
    } finally {
      setLoading(false);
    }
  }

  // Avvia la visita creando un nuovo encounter per l’appuntamento corrente.
  async function startEncounter() {
    if (!_appointment) return;

    const notes = await openStartEncounterModal();
    if (notes === null) {
      return;
    }

    setLoading(true);
    clearError();

    try {
      const payload = {
        appointmentId: _appointment.appointmentId,
        notes: notes || null,
      };

      const created = await apiJson("POST", API_CLINICIAN_ENCOUNTERS, payload);
      const newId = created?.id ? String(created.id) : null;
      if (!newId) throw new Error("Avvio visita non riuscito.");

      APL.utils.toast("Visita avviata.", "success");

      _encounterId = newId;
      _detail = await fetchEncounterDetails(_encounterId);

      renderEncounterDetail(_detail);
      renderOrders(_detail.orders, _detail.executions, _serviceMap);
      renderReport(_detail.report);

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } catch (err) {
      const code = String(err?.data?.code || "").toLowerCase();

      // Se il backend segnala che l’encounter esiste già, prova a recuperarlo e ad aprirlo.
      if (Number(err?.status || 0) === 409 || code === "encounter_already_exists") {
        try {
          const foundId = await findEncounterIdForAppointment(_appointment);
          if (foundId) {
            _encounterId = foundId;
            _detail = await fetchEncounterDetails(_encounterId);
            renderEncounterDetail(_detail);
            renderOrders(_detail.orders, _detail.executions, _serviceMap);
            renderReport(_detail.report);
            updateActionHint(_appointment, _detail);
            applyActionsEnabled(_appointment, _detail);
            APL.utils.toast("Visita già presente: apertura completata.", "success");
            return;
          }
        } catch (_) { }
      }

      if (code === "appointment_not_checked_in") {
        APL.utils.toast("Accettazione non completata: impossibile avviare la visita.", "error");
      } else if (code === "missing_required_consents") {
        APL.utils.toast("Consensi obbligatori mancanti: impossibile avviare la visita.", "error");
      } else {
        APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
      }

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } finally {
      setLoading(false);
    }
  }

  // Salva una nuova nota anamnestica sull’encounter corrente.
  async function addAnamnesis() {
    const ta = $("anamnesisContent");
    const btn = $("btnAddAnamnesis");
    if (!ta || !btn) return;

    const content = String(ta.value || "").trim();
    if (!content) {
      APL.utils.toast("Inserire una nota per procedere.", "error");
      return;
    }
    if (!_encounterId) return;

    APL.utils.setLoading(btn, true, "Salvataggio…");
    clearError();

    try {
      await apiJson(
        "POST",
        `${API_CLINICIAN_ENCOUNTERS}/${encodeURIComponent(_encounterId)}/anamneses`,
        { content }
      );
      ta.value = "";
      APL.utils.toast("Nota salvata.", "success");

      // Dopo ogni mutazione ricarica il dettaglio per riallineare la pagina allo stato backend.
      _detail = await fetchEncounterDetails(_encounterId);
      renderEncounterDetail(_detail);
      renderOrders(_detail.orders, _detail.executions, _serviceMap);
      renderReport(_detail.report);

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
    } finally {
      APL.utils.setLoading(btn, false);
    }
  }

  // Registra un nuovo parametro vitale sull’encounter corrente.
  async function addVitalSign() {
    const type = String($("vitalType")?.value || "").trim();
    const valueRaw = String($("vitalValue")?.value || "").trim();
    const unit = String($("vitalUnit")?.value || "").trim();
    const btn = $("btnAddVital");

    if (!btn) return;
    if (!_encounterId) return;

    if (!type || !valueRaw || !unit) {
      APL.utils.toast("Compilare tipo, valore e unità.", "error");
      return;
    }

    const value = Number(valueRaw);
    if (!Number.isFinite(value)) {
      APL.utils.toast("Valore non valido.", "error");
      return;
    }

    APL.utils.setLoading(btn, true, "Registrazione…");
    clearError();

    try {
      const payload = { type, value, unit, measuredAtUtc: new Date().toISOString() };
      await apiJson(
        "POST",
        `${API_CLINICIAN_ENCOUNTERS}/${encodeURIComponent(_encounterId)}/vital-signs`,
        payload
      );

      $("vitalValue").value = "";
      $("vitalUnit").value = "";

      APL.utils.toast("Parametro registrato.", "success");

      _detail = await fetchEncounterDetails(_encounterId);
      renderEncounterDetail(_detail);
      renderOrders(_detail.orders, _detail.executions, _serviceMap);
      renderReport(_detail.report);

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
    } finally {
      APL.utils.setLoading(btn, false);
    }
  }

  // Crea un nuovo ordine clinico per l’encounter corrente.
  async function addOrder() {
    const sel = $("orderService");
    const notes = String($("orderNotes")?.value || "").trim();
    const btn = $("btnAddOrder");
    if (!sel || !btn) return;
    if (!_encounterId) return;

    const id = String(sel.value || "").trim();
    if (!id) {
      APL.utils.toast("Selezionare una prestazione.", "error");
      return;
    }

    APL.utils.setLoading(btn, true, "Creazione…");
    clearError();

    try {
      const payload = { catalogItemId: id, notes: notes || null };
      await apiJson(
        "POST",
        `${API_CLINICIAN_ENCOUNTERS}/${encodeURIComponent(_encounterId)}/orders`,
        payload
      );

      $("orderNotes").value = "";
      sel.value = "";

      APL.utils.toast("Ordine creato.", "success");

      _detail = await fetchEncounterDetails(_encounterId);
      renderEncounterDetail(_detail);
      renderOrders(_detail.orders, _detail.executions, _serviceMap);
      renderReport(_detail.report);

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
    } finally {
      APL.utils.setLoading(btn, false);
    }
  }

  // Registra un’esecuzione clinica per l’ordine selezionato.
  async function recordExecution(orderId) {
    if (!_encounterId) return;
    const data = await openRecordExecutionModal();
    if (!data) return;

    setLoading(true);
    clearError();

    try {
      const payload = {
        performedAtUtc: new Date().toISOString(),
        outcome: data.outcome,
        notes: data.notes || null,
      };

      await apiJson(
        "POST",
        `/api/clinical/clinicians/me/orders/${encodeURIComponent(String(orderId))}/executions`,
        payload
      );

      APL.utils.toast("Esecuzione registrata.", "success");

      _detail = await fetchEncounterDetails(_encounterId);
      renderEncounterDetail(_detail);
      renderOrders(_detail.orders, _detail.executions, _serviceMap);
      renderReport(_detail.report);

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
    } finally {
      setLoading(false);
    }
  }

  // Salva o aggiorna la bozza del referto.
  async function saveDraft() {
    const ta = $("reportContent");
    const btn = $("btnSaveDraft");
    if (!ta || !btn) return;
    if (!_encounterId) return;

    const content = String(ta.value || "").trim();
    if (!content) {
      APL.utils.toast("Inserire un contenuto per procedere.", "error");
      return;
    }

    APL.utils.setLoading(btn, true, "Salvataggio…");
    clearError();

    try {
      await apiJson(
        "PUT",
        `${API_CLINICIAN_ENCOUNTERS}/${encodeURIComponent(_encounterId)}/report`,
        { content }
      );
      APL.utils.toast("Bozza salvata.", "success");

      _detail = await fetchEncounterDetails(_encounterId);
      renderEncounterDetail(_detail);
      renderOrders(_detail.orders, _detail.executions, _serviceMap);
      renderReport(_detail.report);

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
    } finally {
      APL.utils.setLoading(btn, false);
    }
  }

  // Firma il referto corrente, congelandone il contenuto.
  async function signReport() {
    if (!_encounterId) return;

    const ta = $("reportContent");
    const content = String(ta?.value || "").trim();

    // Se non esiste ancora un report e il contenuto è vuoto, la firma non può procedere.
    if (!_detail?.report?.id && !content) {
      APL.utils.toast("Inserire un contenuto e salvare prima la bozza del referto.", "error");
      return;
    }

    // Se il contenuto locale differisce dalla bozza caricata, propone prima il salvataggio.
    if (content) {
      const reportContent = String(_detail?.report?.content || "").trim();
      if (reportContent !== content) {
        const okSave = await confirmAction(
          "Salvare e firmare",
          "Sono presenti modifiche non ancora salvate. Salvare la bozza e procedere con la firma?",
          "Salva e firma"
        );

        if (!okSave) return;

        setLoading(true);
        clearError();

        try {
          await apiJson(
            "PUT",
            `${API_CLINICIAN_ENCOUNTERS}/${encodeURIComponent(_encounterId)}/report`,
            { content }
          );
        } catch (err) {
          APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
          return;
        } finally {
          setLoading(false);
        }
      }
    }

    const ok = await confirmAction(
      "Firma referto",
      "La firma congela il contenuto del referto. Dopo la firma non sarà più possibile modificarlo e si potrà solo pubblicarlo. Procedere?",
      "Firma"
    );

    if (!ok) return;

    setLoading(true);
    clearError();

    try {
      await apiJson(
        "POST",
        `${API_CLINICIAN_ENCOUNTERS}/${encodeURIComponent(_encounterId)}/report/sign`,
        { sign: true }
      );

      APL.utils.toast("Referto firmato.", "success");

      _detail = await fetchEncounterDetails(_encounterId);
      renderEncounterDetail(_detail);
      renderOrders(_detail.orders, _detail.executions, _serviceMap);
      renderReport(_detail.report);

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
    } finally {
      setLoading(false);
    }
  }

  // Pubblica il referto firmato, rendendolo disponibile al paziente.
  async function publishReport() {
    if (!_encounterId) return;

    const ok = await confirmAction(
      "Pubblica referto",
      "La pubblicazione rende il referto firmato disponibile al paziente. Procedere?",
      "Pubblica"
    );

    if (!ok) return;

    setLoading(true);
    clearError();

    try {
      await apiJson(
        "POST",
        `${API_CLINICIAN_ENCOUNTERS}/${encodeURIComponent(_encounterId)}/report/publish`,
        { publish: true }
      );
      APL.utils.toast("Referto pubblicato.", "success");

      _detail = await fetchEncounterDetails(_encounterId);
      renderEncounterDetail(_detail);
      renderOrders(_detail.orders, _detail.executions, _serviceMap);
      renderReport(_detail.report);

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
    } finally {
      setLoading(false);
    }
  }

  // Conclude formalmente l’encounter, bloccando le ulteriori modifiche cliniche.
  async function completeEncounter() {
    if (!_encounterId) return;

    const ok = await confirmAction(
      "Concludi visita",
      "La conclusione blocca le modifiche cliniche. Procedere?",
      "Concludi"
    );

    if (!ok) return;

    setLoading(true);
    clearError();

    try {
      await apiJson("POST", `${API_CLINICIAN_ENCOUNTERS}/${encodeURIComponent(_encounterId)}/complete`);
      APL.utils.toast("Visita conclusa.", "success");

      // Dopo la conclusione prova a ricaricare anche l’appuntamento,
      // così da riflettere eventuali cambi di stato lato scheduling.
      if (_appointment?.appointmentId) {
        const refreshedAppointment = await fetchAppointmentById(_appointment.appointmentId);
        if (refreshedAppointment) {
          _appointment = refreshedAppointment;
          renderAppointment(_appointment, _serviceMap);
        }
      }

      _detail = await fetchEncounterDetails(_encounterId);
      renderEncounterDetail(_detail);
      renderOrders(_detail.orders, _detail.executions, _serviceMap);
      renderReport(_detail.report);

      updateActionHint(_appointment, _detail);
      applyActionsEnabled(_appointment, _detail);
    } catch (err) {
      APL.utils.toast(APL.utils.humanizeError(err) || "Operazione non riuscita.", "error");
    } finally {
      setLoading(false);
    }
  }

  // Collega tutti i controlli della pagina ai relativi comportamenti applicativi.
  function wireEvents() {
    const startBtns = [$("btnStartEncounter"), $("btnStartEncounterInline")].filter(Boolean);
    for (const b of startBtns) b.addEventListener("click", startEncounter);

    const btnComplete = $("btnCompleteEncounter");
    if (btnComplete) btnComplete.addEventListener("click", completeEncounter);

    const signBtns = [$("btnSignReport"), $("btnSignReportInline")].filter(Boolean);
    for (const b of signBtns) b.addEventListener("click", signReport);

    const pubBtns = [$("btnPublishReport"), $("btnPublishReportInline")].filter(Boolean);
    for (const b of pubBtns) b.addEventListener("click", publishReport);

    const btnSave = $("btnSaveDraft");
    if (btnSave) btnSave.addEventListener("click", saveDraft);

    const anamForm = $("anamnesisForm");
    if (anamForm) {
      anamForm.addEventListener("submit", (ev) => {
        ev.preventDefault();
        addAnamnesis();
      });
    }

    const vitalForm = $("vitalForm");
    if (vitalForm) {
      vitalForm.addEventListener("submit", (ev) => {
        ev.preventDefault();
        addVitalSign();
      });
    }

    const orderForm = $("orderForm");
    if (orderForm) {
      orderForm.addEventListener("submit", (ev) => {
        ev.preventDefault();
        addOrder();
      });
    }

    // Event delegation sulla tabella ordini per registrare esecuzioni sulle righe esistenti.
    const ordersTbody = $("ordersTbody");
    if (ordersTbody) {
      ordersTbody.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-action][data-order-id]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const orderId = btn.getAttribute("data-order-id");
        if (!orderId) return;

        if (action === "record-exec") {
          if (_detail && isEncounterClosed(_detail)) {
            APL.utils.toast("Visita conclusa: operazione non disponibile.", "error");
            return;
          }
          await recordExecution(orderId);
        }
      });
    }
  }

  // Inizializza la pagina dettaglio visita al caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Clinician.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    wireEvents();
    await loadAll();
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
