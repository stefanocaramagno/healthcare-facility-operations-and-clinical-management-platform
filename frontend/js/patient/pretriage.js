/**
 * File: frontend/js/patient/pretriage.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina di pre-triage
 * dell’area Patient, comprendendo il caricamento dell’appuntamento
 * selezionato, il recupero dell’eventuale questionario già salvato,
 * la compilazione del form, la validazione dei dati inseriti e il
 * salvataggio delle informazioni preliminari alla visita.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `pretriage.html`. Coordina l’interazione tra interfaccia utente,
 * servizi API dell’area scheduling e clinical e componenti condivisi
 * dell’applicazione, traducendo il contesto dell’appuntamento in una
 * UI compilabile e consentendo al paziente di modificare il pre-triage
 * solo quando lo stato della prenotazione lo permette.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Patient;
 * - leggere l’identificativo dell’appuntamento dalla query string;
 * - recuperare i dati dell’appuntamento associato al pre-triage;
 * - recuperare l’eventuale contenuto di pre-triage già salvato;
 * - aggiornare riepilogo appuntamento, stato e ultimo salvataggio;
 * - abilitare o bloccare il form in base allo stato dell’appuntamento;
 * - validare i dati inseriti prima del salvataggio;
 * - serializzare il contenuto del questionario nel formato atteso dal backend;
 * - gestire il ripristino dei campi tramite conferma modale;
 * - gestire loading, errori globali, alert di form e toast di feedback.
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
 * - utilizza utility temporali come `APL.utils.romeTodayDateInputValue()`,
 *   `APL.utils.addDaysToDateInput()` e `APL.utils.romeDateRangeToUtc()`;
 * - utilizza `APL.ui.modal.open()` per la conferma del ripristino;
 * - interagisce con gli endpoint:
 *   - `/api/scheduling/patients/me/appointments`
 *   - `/api/clinical/patients/me/pretriage`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. Il contenuto del questionario viene serializzato lato client
 * come stringa JSON, così da mantenere una struttura coerente e facilmente
 * estendibile per i dati di pre-visita.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Patient";

  // Endpoint per il recupero degli appuntamenti del paziente autenticato.
  const API_APPOINTMENTS = "/api/scheduling/patients/me/appointments";

  // Endpoint per il recupero e il salvataggio del pre-triage del paziente autenticato.
  const API_PRETRIAGE = "/api/clinical/patients/me/pretriage";

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel box globale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;
    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Ripristina lo stato normale della pagina nascondendo l’eventuale errore globale.
  function clearError() {
    const box = $("pageError");
    if (!box) return;
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Mostra o nasconde il messaggio contestuale relativo al form di pre-triage.
  function showFormAlert(message) {
    const box = $("formAlert");
    if (!box) return;
    if (!message) {
      box.textContent = "";
      box.classList.add("hidden");
      return;
    }
    box.textContent = message;
    box.classList.remove("hidden");
  }

  // Aggiorna lo stato di caricamento della vista.
  // Oltre al badge, disabilita temporaneamente i pulsanti principali del form.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const btnSave = $("btnSave");
    const btnReset = $("btnReset");
    if (btnSave) btnSave.disabled = !!loading;
    if (btnReset) btnReset.disabled = !!loading;
  }

  // Abilita o disabilita i campi compilabili del questionario.
  // Mantiene una gestione separata del box informativo che segnala il blocco delle modifiche.
  function setFormEnabled(enabled) {
    const form = $("pretriageForm");
    if (!form) return;

    const fields = form.querySelectorAll("input, textarea, select, button");
    fields.forEach((el) => {
      if (el.id === "btnSave" || el.id === "btnReset") return;
      el.disabled = !enabled;
    });

    const btnSave = $("btnSave");
    const btnReset = $("btnReset");
    if (btnSave) btnSave.disabled = !enabled;
    if (btnReset) btnReset.disabled = !enabled;

    const lockedBox = $("lockedBox");
    if (lockedBox) lockedBox.classList.toggle("hidden", enabled);
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

  // Formatta una data UTC in una rappresentazione estesa leggibile per l’utente.
  function fmtDateTime(isoUtc) {
    if (!isoUtc) return "—";
    const d = new Date(isoUtc);
    return d.toLocaleString("it-IT", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Converte una data nel formato richiesto dagli input HTML usando il fuso di Roma.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Traduce lo stato tecnico dell’appuntamento in una pill HTML con label e stile coerenti.
  function statusPill(raw) {
    const s = String(raw || "").toUpperCase();
    const m =
      s === "BOOKED"
        ? { label: "Prenotato", cls: "bg-blue-50 text-blue-700" }
        : s === "CHECKED_IN"
          ? { label: "Accettato", cls: "bg-amber-50 text-amber-800" }
          : s === "COMPLETED"
            ? { label: "Completato", cls: "bg-emerald-50 text-emerald-700" }
            : s === "CANCELED" || s === "CANCELLED"
              ? { label: "Annullato", cls: "bg-slate-100 text-slate-700" }
              : s === "NO_SHOW"
                ? { label: "Assente", cls: "bg-slate-100 text-slate-700" }
                : { label: raw || "—", cls: "bg-slate-100 text-slate-700" };

    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${m.cls}">${escapeHtml(
      m.label
    )}</span>`;
  }

  // Attende che il sistema modale condiviso sia disponibile prima di utilizzarlo.
  async function ensureModalReady(timeoutMs = 10000) {
    const start = Date.now();
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }
    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione uniforme
  // di sessione scaduta, accesso negato ed errori applicativi.
  async function apiRequest(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // Sessione non più valida: pulizia locale e redirect alla schermata dedicata.
      if (res.status === 401) {
        try {
          APL.session.clearAuth();
        } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Accesso vietato: redirect alla schermata di forbidden se disponibile.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Altri errori: costruzione di un oggetto Error arricchito con metadati utili.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Estrae dalla query string l’identificativo dell’appuntamento da caricare.
  function readAppointmentId() {
    const q = new URLSearchParams(window.location.search || "");
    const v = q.get("appointmentId");
    return v ? String(v) : null;
  }

  // Recupera l’appuntamento richiesto cercandolo all’interno di una finestra temporale ampia.
  // La ricerca viene effettuata lato client sull’elenco restituito dal backend.
  async function fetchAppointmentById(appointmentId) {
    const today = APL.utils.romeTodayDateInputValue();
    const fromDay = APL.utils.addDaysToDateInput(today, -365);
    const toDay = APL.utils.addDaysToDateInput(today, 365);
    const range = APL.utils.romeDateRangeToUtc(fromDay, toDay);

    const url =
      `${API_APPOINTMENTS}?fromUtc=${encodeURIComponent(range.fromUtc)}` +
      `&toUtc=${encodeURIComponent(range.toUtc)}`;

    const data = await apiRequest("GET", url);
    const list = Array.isArray(data) ? data : [];
    return list.find((x) => String(x.id) === String(appointmentId)) || null;
  }

  // Recupera l’eventuale contenuto di pre-triage già esistente per l’appuntamento indicato.
  // Il caso 404 viene trattato come assenza di dati e non come errore bloccante.
  async function getPreTriage(appointmentId) {
    const url = `${API_PRETRIAGE}/appointments/${encodeURIComponent(String(appointmentId))}`;
    const res = await APL.utils.requestJson(url, {
      method: "GET",
      headers: { Accept: "application/json", ...APL.session.authHeader() },
    });

    if (res.ok) return res.data;

    if (res.status === 404) return null;

    // Sessione non più valida: pulizia locale e redirect alla schermata dedicata.
    if (res.status === 401) {
      try {
        APL.session.clearAuth();
      } catch (_) { }
      if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
      throw new Error("Sessione scaduta.");
    }

    // Accesso vietato: redirect alla schermata di forbidden se disponibile.
    if (res.status === 403) {
      if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
      throw new Error("Accesso non autorizzato.");
    }

    // Altri errori: costruzione di un oggetto Error arricchito con metadati utili.
    const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
    const err = new Error(msg);
    err.status = res.status;
    err.data = res.data;
    err.requestId = res.requestId;
    throw err;
  }

  // Aggiorna il collegamento verso il dettaglio appuntamento mantenendo il contesto corrente.
  function setHeaderLinks(appointmentId) {
    const btn = $("btnBackToDetail");
    if (btn) btn.href = `./appointment-detail.html?appointmentId=${encodeURIComponent(String(appointmentId))}`;
  }

  // Popola il riepilogo della vista con i dati principali dell’appuntamento.
  // Determina anche se il form può restare modificabile in base allo stato corrente.
  function setAppointmentSummary(appt) {
    if ($("apptRef")) $("apptRef").textContent = appt?.id ? String(appt.id) : "—";

    const svc = appt?.serviceCode ? String(appt.serviceCode) : "Appuntamento";
    const when = appt?.startUtc ? fmtDateTime(appt.startUtc) : "—";

    if ($("apptService")) $("apptService").textContent = svc;
    if ($("apptWhen")) $("apptWhen").textContent = when;

    const pill = $("apptStatusPill");
    if (pill) pill.innerHTML = statusPill(appt?.status);

    const st = String(appt?.status || "").toUpperCase();
    const active = st === "BOOKED" || st === "CHECKED_IN";
    setFormEnabled(active);

    return active;
  }

  // Aggiorna il campo sintetico che mostra l’ultimo timestamp di salvataggio disponibile.
  function setLastSavedText(dto) {
    const el = $("lastSaved");
    if (!el) return;

    if (!dto || !dto.updatedAtUtc) {
      el.textContent = "—";
      return;
    }

    el.textContent = fmtDateTime(dto.updatedAtUtc);
  }

  // Legge un input numerico del form restituendo `null` quando il valore non è presente o non è valido.
  function readNumber(id) {
    const v = String($(id)?.value || "").trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Costruisce il payload strutturato del questionario a partire dai campi del form.
  // Esegue anche le principali validazioni lato client prima della serializzazione finale.
  function buildContentFromForm(appointmentId) {
    const chiefComplaint = String($("chiefComplaint")?.value || "").trim();
    const symptoms = String($("symptoms")?.value || "").trim();
    const onsetDate = String($("onsetDate")?.value || "").trim() || null;
    const painScale = readNumber("painScale");

    const temperatureC = readNumber("temperatureC");
    const heartRateBpm = readNumber("heartRateBpm");
    const spo2Pct = readNumber("spo2Pct");
    const bpSystolic = readNumber("bpSystolic");
    const bpDiastolic = readNumber("bpDiastolic");

    const allergies = String($("allergies")?.value || "").trim() || null;
    const medications = String($("medications")?.value || "").trim() || null;
    const conditions = String($("conditions")?.value || "").trim() || null;
    const additionalNotes = String($("additionalNotes")?.value || "").trim() || null;

    // Il campo sintomi rappresenta il nucleo minimo richiesto per il pre-triage.
    if (!symptoms) {
      return { ok: false, message: "Inserisca una descrizione dei sintomi principali." };
    }

    // La scala del dolore deve rimanere all’interno del range dichiarato nella UI.
    if (painScale !== null && (painScale < 0 || painScale > 10)) {
      return { ok: false, message: "Il livello di dolore deve essere compreso tra 0 e 10." };
    }

    // Struttura versionata del contenuto, serializzata come stringa JSON per il backend.
    const contentObj = {
      version: 1,
      appointmentId: String(appointmentId),
      chiefComplaint: chiefComplaint || null,
      onsetDate,
      painScale,
      symptoms,
      vitals: {
        temperatureC,
        heartRateBpm,
        spo2Pct,
        bloodPressure: bpSystolic !== null || bpDiastolic !== null ? { systolic: bpSystolic, diastolic: bpDiastolic } : null,
      },
      allergies,
      medications,
      conditions,
      additionalNotes,
    };

    return { ok: true, content: JSON.stringify(contentObj) };
  }

  // Popola il form a partire dal contenuto salvato.
  // Tenta prima il parsing della struttura JSON; in caso di contenuto legacy
  // o non strutturato, utilizza il valore come descrizione libera dei sintomi.
  function fillFormFromContent(content) {
    const set = (id, val) => {
      const el = $(id);
      if (!el) return;
      el.value = val ?? "";
    };

    // Ripristino preventivo di tutti i campi per evitare residui di stato precedente.
    set("chiefComplaint", "");
    set("onsetDate", "");
    set("painScale", "");
    set("symptoms", "");
    set("temperatureC", "");
    set("heartRateBpm", "");
    set("spo2Pct", "");
    set("bpSystolic", "");
    set("bpDiastolic", "");
    set("allergies", "");
    set("medications", "");
    set("conditions", "");
    set("additionalNotes", "");

    if (!content) return;

    try {
      const obj = JSON.parse(String(content));
      if (obj && typeof obj === "object") {
        set("chiefComplaint", obj.chiefComplaint || "");
        set("onsetDate", obj.onsetDate || "");
        set("painScale", obj.painScale ?? "");
        set("symptoms", obj.symptoms || "");

        const v = obj.vitals || {};
        set("temperatureC", v.temperatureC ?? "");
        set("heartRateBpm", v.heartRateBpm ?? "");
        set("spo2Pct", v.spo2Pct ?? "");

        const bp = v.bloodPressure || null;
        set("bpSystolic", bp?.systolic ?? "");
        set("bpDiastolic", bp?.diastolic ?? "");

        set("allergies", obj.allergies || "");
        set("medications", obj.medications || "");
        set("conditions", obj.conditions || "");
        set("additionalNotes", obj.additionalNotes || "");
        return;
      }
    } catch (_) {
    }

    // Fallback compatibile con contenuti salvati come semplice testo libero.
    set("symptoms", String(content));
  }

  // Salva il questionario di pre-triage dell’appuntamento corrente.
  // Gestisce validazione, feedback utente e blocco del form nei casi in cui
  // il backend segnali che la modifica non è più consentita.
  async function savePreTriage(appointmentId) {
    showFormAlert("");
    clearError();

    const built = buildContentFromForm(appointmentId);
    if (!built.ok) {
      showFormAlert(built.message);
      return;
    }

    const url = `${API_PRETRIAGE}/appointments/${encodeURIComponent(String(appointmentId))}`;

    setLoading(true);
    try {
      const dto = await apiRequest("PUT", url, { content: built.content });
      setLastSavedText(dto);
      APL.utils.toast("Informazioni salvate.", "success");
    } catch (err) {
      const code = err?.data?.code ? String(err.data.code) : "";
      if (code === "appointment_not_active_for_pretriage") {
        setFormEnabled(false);
        showFormAlert("Le modifiche non sono disponibili per questo appuntamento.");
        return;
      }
      showFormAlert(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      setLoading(false);
    }
  }

  // Mostra il modale di conferma per il ripristino dei campi non salvati.
  async function confirmReset() {
    const ok = await ensureModalReady(10000);
    if (!ok) return false;

    return new Promise((resolve) => {
      APL.ui.modal.open({
        title: "Ripristina compilazione",
        bodyHtml:
          `<div class="text-sm text-slate-700">` +
          `Le informazioni inserite non salvate verranno rimosse. Vuole procedere?</div>`,
        actions: [
          { label: "Annulla", kind: "secondary", closeOnClick: true, onClick: () => resolve(false) },
          { label: "Ripristina", kind: "danger", closeOnClick: true, onClick: () => resolve(true) },
        ],
      });
    });
  }

  // Inizializza la pagina di pre-triage.
  // Coordina autenticazione, lettura del contesto, caricamento dei dati,
  // binding degli eventi del form e gestione delle condizioni di blocco.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    const appointmentId = readAppointmentId();
    if (!appointmentId) {
      showError("Impossibile aprire questa sezione. Acceda dal dettaglio appuntamento.");
      setFormEnabled(false);
      return;
    }

    setHeaderLinks(appointmentId);

    try {
      setLoading(true);
      await ensureModalReady(10000);

      const appt = await fetchAppointmentById(appointmentId);
      if (!appt) {
        showError("Appuntamento non trovato. Verifichi l’elenco appuntamenti.");
        setFormEnabled(false);
        setLoading(false);
        return;
      }

      const active = setAppointmentSummary(appt);
      if (!active) {
        showFormAlert("Le modifiche non sono disponibili per questo appuntamento.");
      }

      const dto = await getPreTriage(appointmentId);
      if (dto) {
        fillFormFromContent(dto.content);
        setLastSavedText(dto);
      } else {
        setLastSavedText(null);
        fillFormFromContent("");
      }

      const form = $("pretriageForm");
      if (form) {
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          if (!active) {
            showFormAlert("Le modifiche non sono disponibili per questo appuntamento.");
            return;
          }
          await savePreTriage(appointmentId);
        });
      }

      const btnReset = $("btnReset");
      if (btnReset) {
        btnReset.addEventListener("click", async () => {
          if (!active) return;
          const yes = await confirmReset();
          if (!yes) return;
          fillFormFromContent("");
          showFormAlert("");
          APL.utils.toast("Campi ripristinati.", "success");
        });
      }
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la pagina.");
      setFormEnabled(false);
    } finally {
      setLoading(false);
    }
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
