/**
 * File: frontend/js/patient/profile.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina del profilo personale
 * del paziente, comprendendo il caricamento dei dati dell’account e del
 * profilo anagrafico, la compilazione del form, la validazione dei campi,
 * il salvataggio delle modifiche e l’aggiornamento del riepilogo mostrato
 * nella UI.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Profilo"
 * dell’area Patient. Si integra con i moduli condivisi del front-end
 * per autenticazione, sessione, richieste HTTP e utilità generali,
 * e dialoga con i servizi di identità e registry per consentire
 * al paziente di consultare e aggiornare i propri dati anagrafici
 * e di contatto.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Patient;
 * - recuperare i dati dell’utente autenticato dall’endpoint `/api/me`;
 * - recuperare il profilo personale del paziente dall’endpoint dedicato;
 * - gestire il caso in cui il profilo non sia ancora presente;
 * - popolare sia il riepilogo laterale sia il form principale della pagina;
 * - convertire correttamente la data di nascita tra input HTML e formato UTC ISO;
 * - validare i campi obbligatori prima del salvataggio;
 * - inviare al backend l’aggiornamento del profilo personale;
 * - aggiornare banner, avatar, riepiloghi e stato del profilo dopo il salvataggio;
 * - gestire loading, errori globali e toast di feedback.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.session.clearAuth` nei casi di sessione non più valida;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading`,
 *   `APL.utils.parseApiDate` e `APL.utils.toRomeDateInputValue`;
 * - interagisce con gli endpoint:
 *   `/api/me`
 *   e `/api/registry/patients/me/profile`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina distingue i dati dell’account autenticato dai dati del profilo
 * anagrafico del paziente: i primi derivano da `/api/me`, i secondi dal
 * servizio di registry. In assenza del profilo, la UI entra in modalità
 * di configurazione iniziale.
 */

(function () {
  "use strict";

  // Ruolo richiesto per accedere correttamente alla pagina profilo del paziente.
  const EXPECTED_ROLE = "Patient";

  // Endpoint che restituisce le informazioni base dell’utente autenticato.
  const API_ME = "/api/me";

  // Endpoint che restituisce e aggiorna il profilo personale del paziente autenticato.
  const API_PROFILE = "/api/registry/patients/me/profile";

  // Utility locale per recuperare rapidamente un elemento DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore globale nel box dedicato della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;
    box.textContent = message || "Errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il box degli errori globali.
  function clearError() {
    const box = $("pageError");
    if (!box) return;
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna lo stato di caricamento globale della pagina.
  // Oltre al badge, gestisce il pulsante Salva e disabilita temporaneamente
  // i controlli editabili per evitare modifiche concorrenti.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const btnSave = $("btnSave");
    if (btnSave) APL.utils.setLoading(btnSave, loading, "Salvataggio…");

    const ids = ["firstName", "lastName", "dateOfBirth", "phone", "address", "btnReset"];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Imposta il testo di un elemento DOM usando "—" come placeholder nei casi vuoti.
  function setText(id, value) {
    const el = $(id);
    if (!el) return;
    el.textContent = value == null || value === "" ? "—" : String(value);
  }

  // Formattta una data API in sola componente giorno/mese/anno per il riepilogo UI.
  function fmtDate(isoUtc) {
    if (!isoUtc) return "—";
    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";
    return d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  // Converte una data ISO UTC nel formato richiesto dagli input HTML di tipo date.
  function toDateInputValue(isoUtc) {
    if (!isoUtc) return "";
    return APL.utils.toRomeDateInputValue(isoUtc);
  }

  // Converte il valore dell’input date nel corrispondente timestamp UTC ISO.
  // La conversione viene eseguita forzando la mezzanotte UTC del giorno selezionato.
  function dateInputToUtcIso(dateStr) {
    const s = String(dateStr || "").trim();
    if (!s) return null;

    const parts = s.split("-");
    if (parts.length !== 3) return null;

    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

    const ms = Date.UTC(y, m - 1, d, 0, 0, 0);
    const dt = new Date(ms);
    if (!Number.isFinite(dt.getTime())) return null;

    return dt.toISOString();
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione coerente
  // di sessione scaduta, accesso vietato ed errori applicativi generici.
  async function requestJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // Se la sessione non è più valida, ripulisce l’autenticazione locale
      // e delega il redirect alla vista di sessione scaduta.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        const err = new Error("Sessione scaduta.");
        err.status = 401;
        throw err;
      }

      // Se l’utente non possiede i permessi richiesti, delega il redirect alla vista forbidden.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        const err = new Error("Accesso non autorizzato.");
        err.status = 403;
        throw err;
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

  // Normalizza il payload dell’endpoint `/api/me` in una struttura uniforme lato client.
  function normalizeMe(x) {
    return {
      id: x?.id || x?.Id || "",
      email: x?.email || x?.Email || "",
      role: x?.role || x?.Role || "",
    };
  }

  // Normalizza il payload del profilo personale del paziente.
  function normalizeProfile(x) {
    return {
      id: x?.id || x?.Id || "",
      userId: x?.userId || x?.UserId || "",
      firstName: x?.firstName || x?.FirstName || "",
      lastName: x?.lastName || x?.LastName || "",
      dateOfBirthUtc: x?.dateOfBirthUtc || x?.DateOfBirthUtc || "",
      phone: x?.phone || x?.Phone || "",
      address: x?.address || x?.Address || "",
    };
  }

  // Aggiorna il riepilogo laterale del profilo del paziente.
  // Mostra nome completo, email, identificativo, telefono, stato informativo
  // dell’ultimo aggiornamento e avatar.
  function fillSummary(me, profile) {
    const fullName = profile
      ? `${(profile.firstName || "").trim()} ${(profile.lastName || "").trim()}`.trim()
      : "";

    setText("fullName", fullName || "—");
    setText("emailText", me?.email || "—");
    setText("userIdText", me?.id || profile?.userId || "—");
    setText("phoneText", (profile?.phone || "").trim() || "—");

    // In questa UI l’ultimo aggiornamento non usa un timestamp reale,
    // ma una semplice indicazione di disponibilità del profilo.
    setText("updatedText", profile?.id ? "Disponibile" : "—");

    const avatar = $("avatar");
    if (avatar) {
      const a = (profile?.firstName || "").trim().slice(0, 1).toUpperCase();
      const b = (profile?.lastName || "").trim().slice(0, 1).toUpperCase();
      avatar.textContent = (a + b) || "—";
      avatar.title = fullName || (me?.email || "");
    }
  }

  // Popola il form principale con i dati del profilo attualmente noto.
  // L’email viene sempre derivata dall’account autenticato ed è in sola lettura.
  function fillForm(me, profile) {
    $("firstName").value = profile?.firstName || "";
    $("lastName").value = profile?.lastName || "";
    $("dateOfBirth").value = toDateInputValue(profile?.dateOfBirthUtc);
    $("phone").value = profile?.phone || "";
    $("address").value = profile?.address || "";
    $("email").value = me?.email || "";
  }

  // Mostra o nasconde il banner che segnala l’assenza di configurazione del profilo.
  function setProfileMissingBanner(show) {
    const b = $("profileMissingBanner");
    if (!b) return;
    b.classList.toggle("hidden", !show);
  }

  // Legge lo stato corrente del form e costruisce il modello lato client.
  function readForm() {
    return {
      firstName: String($("firstName").value || "").trim(),
      lastName: String($("lastName").value || "").trim(),
      dateOfBirth: String($("dateOfBirth").value || "").trim(),
      phone: String($("phone").value || "").trim(),
      address: String($("address").value || "").trim(),
    };
  }

  // Valida i campi del form.
  // Restituisce il primo messaggio di errore riscontrato oppure `null` se il modello è valido.
  function validate(model) {
    if (!model.firstName) return "Inserire il nome.";
    if (!model.lastName) return "Inserire il cognome.";
    if (!model.dateOfBirth) return "Inserire la data di nascita.";

    const dobIso = dateInputToUtcIso(model.dateOfBirth);
    if (!dobIso) return "La data di nascita non è valida.";

    return null;
  }

  // Carica il profilo completo della pagina:
  // - dati account autenticato;
  // - eventuale profilo personale del paziente.
  async function load() {
    clearError();
    setLoading(true);

    try {
      // Recupera sempre le informazioni base dell’account autenticato.
      const me = normalizeMe(await requestJson("GET", API_ME));
      state.me = me;

      try {
        // Tenta di recuperare il profilo personale del paziente.
        const prof = normalizeProfile(await requestJson("GET", API_PROFILE));
        state.profile = prof;
        state.profileMissing = false;
      } catch (e) {
        // Se il backend restituisce 404, il profilo viene considerato non ancora configurato.
        if (Number(e?.status || 0) === 404) {
          state.profile = null;
          state.profileMissing = true;
        } else {
          throw e;
        }
      }

      // Aggiorna banner, riepilogo laterale e form principale.
      setProfileMissingBanner(state.profileMissing);
      fillSummary(state.me, state.profile);
      fillForm(state.me, state.profile);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il profilo.");
    } finally {
      setLoading(false);
    }
  }

  // Salva il profilo personale del paziente usando i dati attualmente inseriti nel form.
  async function save() {
    clearError();

    const model = readForm();
    const validation = validate(model);
    if (validation) {
      APL.utils.toast(validation, "error");
      return;
    }

    const dobIso = dateInputToUtcIso(model.dateOfBirth);

    // Costruisce il payload applicando `null` ai campi facoltativi vuoti.
    const payload = {
      firstName: model.firstName,
      lastName: model.lastName,
      dateOfBirthUtc: dobIso,
      phone: model.phone || null,
      address: model.address || null,
    };

    setLoading(true);

    try {
      // Aggiorna il profilo personale lato backend e normalizza la risposta.
      const updated = normalizeProfile(await requestJson("PUT", API_PROFILE, payload));
      state.profile = updated;
      state.profileMissing = false;

      // Dopo il salvataggio il profilo è da considerarsi configurato.
      setProfileMissingBanner(false);
      fillSummary(state.me, state.profile);
      fillForm(state.me, state.profile);

      APL.utils.toast("Profilo salvato.", "success");
    } catch (err) {
      const msg = APL.utils.humanizeError(err) || "Operazione non riuscita.";
      APL.utils.toast(msg, "error");
      showError(msg);

      // In caso di errore ripristina nel form l’ultimo stato noto in memoria.
      fillForm(state.me, state.profile);
    } finally {
      setLoading(false);
    }
  }

  // Collega i controlli della pagina ai relativi comportamenti applicativi.
  function wire() {
    const btnReset = $("btnReset");
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        // Ripristina il form all’ultimo stato caricato/salvato.
        fillForm(state.me, state.profile);
        APL.utils.toast("Modifiche non salvate annullate.", "info");
      });
    }

    const form = $("profileForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await save();
      });
    }
  }

  // Stato locale della pagina:
  // - me: informazioni dell’account autenticato;
  // - profile: profilo personale del paziente;
  // - profileMissing: indica se il profilo non è ancora configurato.
  const state = {
    me: null,
    profile: null,
    profileMissing: false,
  };

  // Inizializza la pagina profilo paziente al caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Patient.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    wire();
    await load();
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
