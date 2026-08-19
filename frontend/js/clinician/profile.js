/**
 * File: frontend/js/clinician/profile.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina del profilo professionale
 * del clinico, comprendendo il caricamento del profilo corrente, la compilazione
 * del form, la validazione dei dati inseriti, il salvataggio delle modifiche e
 * l’aggiornamento dei riepiloghi mostrati nella UI.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Profilo professionale"
 * dell’area Clinician. Si integra con i moduli condivisi del front-end per
 * autenticazione, sessione, richieste HTTP e utilità generali, e dialoga con
 * i servizi di identità e registry per consentire al professionista sanitario
 * di consultare e aggiornare i propri dati professionali.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Clinician;
 * - recuperare i dati dell’utente autenticato dall’endpoint `/api/me`;
 * - recuperare il profilo professionale del clinico dall’endpoint dedicato;
 * - gestire il caso in cui il profilo professionale non sia ancora presente;
 * - popolare sia il riepilogo laterale sia il form principale della pagina;
 * - validare i campi obbligatori e i vincoli di lunghezza;
 * - inviare al backend l’aggiornamento del profilo professionale;
 * - aggiornare banner, avatar, stato e riepilogo dopo il salvataggio;
 * - gestire loading, errori globali e toast di feedback.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.session.clearAuth` nei casi di sessione non più valida;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading` e `APL.utils.toast`;
 * - interagisce con gli endpoint:
 *   `/api/me`
 *   e `/api/registry/clinicians/me/profile`.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina distingue chiaramente i dati dell’account autenticato dai dati del
 * profilo professionale del clinico: i primi derivano da `/api/me`, i secondi
 * dal servizio di registry. Quando il profilo non esiste ancora, la UI entra
 * in modalità di configurazione iniziale.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina profilo clinico.
  const EXPECTED_ROLE = "Clinician";

  // Endpoint che restituisce le informazioni base dell’utente autenticato.
  const API_ME = "/api/me";

  // Endpoint che restituisce e aggiorna il profilo professionale del clinico autenticato.
  const API_PROFILE = "/api/registry/clinicians/me/profile";

  // Vincoli massimi di lunghezza applicati lato client ai campi del profilo.
  // Sono usati sia per la validazione sia come riferimento documentale nel codice.
  const MAX_FIRST_NAME = 100;
  const MAX_LAST_NAME = 100;
  const MAX_PHONE = 50;
  const MAX_SPECIALTY = 120;
  const MAX_LICENSE = 64;
  const MAX_OFFICE = 120;

  // Utility locale per recuperare rapidamente un elemento DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore globale nel box principale della pagina.
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

  // Aggiorna lo stato di caricamento globale della vista.
  // Oltre al badge, disabilita i controlli modificabili e gestisce il pulsante Salva.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const btnSave = $("btnSave");
    if (btnSave) APL.utils.setLoading(btnSave, loading, "Salvataggio…");

    const ids = [
      "firstName",
      "lastName",
      "phone",
      "specialty",
      "licenseNumber",
      "officeLocation",
      "btnReset",
    ];

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

  // Calcola le iniziali da mostrare nell’avatar del clinico.
  // La priorità è:
  // 1) nome e cognome del profilo professionale;
  // 2) parte locale dell’email dell’account autenticato;
  // 3) placeholder.
  function initialsFromName(firstName, lastName, email) {
    const a = String(firstName || "").trim().slice(0, 1).toUpperCase();
    const b = String(lastName || "").trim().slice(0, 1).toUpperCase();

    if (a || b) return `${a}${b}`.trim();

    const s = String(email || "").trim();
    if (!s) return "—";

    const at = s.indexOf("@");
    const left = (at > 0 ? s.slice(0, at) : s).trim();
    const parts = left.split(/[.\-_]/g).filter(Boolean);

    const c = (parts[0] || left).slice(0, 1).toUpperCase();
    const d = (parts[1] || "").slice(0, 1).toUpperCase();

    return (c + d) || c || "—";
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
      id: x?.id ?? x?.Id ?? "",
      email: x?.email ?? x?.Email ?? "",
      role: x?.role ?? x?.Role ?? "",
    };
  }

  // Normalizza il payload del profilo professionale del clinico.
  function normalizeProfile(x) {
    return {
      userId: x?.userId ?? x?.UserId ?? "",
      firstName: x?.firstName ?? x?.FirstName ?? "",
      lastName: x?.lastName ?? x?.LastName ?? "",
      phone: x?.phone ?? x?.Phone ?? "",
      specialty: x?.specialty ?? x?.Specialty ?? "",
      licenseNumber: x?.licenseNumber ?? x?.LicenseNumber ?? "",
      officeLocation: x?.officeLocation ?? x?.OfficeLocation ?? "",
    };
  }

  // Mostra o nasconde il banner che segnala l’assenza di configurazione del profilo.
  function setProfileMissingBanner(show) {
    const b = $("profileMissingBanner");
    if (!b) return;

    b.classList.toggle("hidden", !show);
  }

  // Aggiorna la colonna laterale di riepilogo del profilo clinico.
  // Mostra nome/ruolo, email, identificativo utente, stato del profilo e avatar.
  function fillSummary(me, profile, missing) {
    const displayName = `${String(profile?.firstName || "").trim()} ${String(profile?.lastName || "").trim()}`.trim();

    setText("roleText", displayName || me?.role || "Clinician");
    setText("emailText", me?.email || "—");
    setText("userIdText", me?.id || "—");
    setText("profileStatusText", missing ? "Da completare" : "Configurato");

    const avatar = $("avatar");
    if (avatar) {
      avatar.textContent = initialsFromName(profile?.firstName, profile?.lastName, me?.email);
      avatar.title = displayName || me?.email || "";
    }

    const emailInput = $("email");
    if (emailInput) emailInput.value = me?.email || "";

    setProfileMissingBanner(!!missing);
  }

  // Popola il form principale con i dati del profilo professionale corrente.
  // L’email è sempre derivata dall’account autenticato e resta in sola lettura.
  function fillForm(profile, me) {
    $("firstName").value = profile?.firstName || "";
    $("lastName").value = profile?.lastName || "";
    $("phone").value = profile?.phone || "";
    $("specialty").value = profile?.specialty || "";
    $("licenseNumber").value = profile?.licenseNumber || "";
    $("officeLocation").value = profile?.officeLocation || "";

    const emailInput = $("email");
    if (emailInput) emailInput.value = me?.email || "";
  }

  // Legge lo stato corrente del form e costruisce il modello lato client.
  function readForm() {
    return {
      firstName: String($("firstName").value || "").trim(),
      lastName: String($("lastName").value || "").trim(),
      phone: String($("phone").value || "").trim(),
      specialty: String($("specialty").value || "").trim(),
      licenseNumber: String($("licenseNumber").value || "").trim(),
      officeLocation: String($("officeLocation").value || "").trim(),
    };
  }

  // Valida il modello letto dal form.
  // Restituisce il primo messaggio di errore riscontrato oppure `null` se il modello è valido.
  function validate(model) {
    // Campi obbligatori richiesti dalla configurazione professionale del clinico.
    if (!model.firstName) return "Inserire il nome.";
    if (!model.lastName) return "Inserire il cognome.";
    if (!model.specialty) return "Inserire la specializzazione.";
    if (!model.licenseNumber) return "Inserire il numero di iscrizione.";
    if (!model.officeLocation) return "Inserire la sede principale.";

    // Vincoli massimi di lunghezza per evitare input eccedenti rispetto ai limiti previsti.
    if (model.firstName.length > MAX_FIRST_NAME) return "Il nome è troppo lungo.";
    if (model.lastName.length > MAX_LAST_NAME) return "Il cognome è troppo lungo.";
    if (model.phone.length > MAX_PHONE) return "Il numero di telefono è troppo lungo.";
    if (model.specialty.length > MAX_SPECIALTY) return "La specializzazione è troppo lunga.";
    if (model.licenseNumber.length > MAX_LICENSE) return "Il numero di iscrizione è troppo lungo.";
    if (model.officeLocation.length > MAX_OFFICE) return "La sede principale è troppo lunga.";

    return null;
  }

  // Carica il profilo completo della pagina:
  // - dati account autenticato;
  // - eventuale profilo professionale del clinico.
  async function load() {
    clearError();
    setLoading(true);

    try {
      // Recupera sempre le informazioni dell’account autenticato.
      const me = normalizeMe(await requestJson("GET", API_ME));
      state.me = me;

      let profile = null;
      let missing = false;

      try {
        // Tenta di recuperare il profilo professionale del clinico.
        profile = normalizeProfile(await requestJson("GET", API_PROFILE));
      } catch (e) {
        // Se il backend restituisce 404, il profilo viene considerato ancora non configurato.
        if (Number(e?.status || 0) === 404) {
          missing = true;
        } else {
          throw e;
        }
      }

      state.profile = profile;
      state.missing = missing;

      // Aggiorna sia il riepilogo laterale sia il form centrale.
      fillSummary(state.me, state.profile, state.missing);
      fillForm(state.profile, state.me);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il profilo.");
    } finally {
      setLoading(false);
    }
  }

  // Salva il profilo professionale del clinico usando i dati attualmente inseriti nel form.
  async function save() {
    clearError();

    const model = readForm();
    const validation = validate(model);
    if (validation) {
      APL.utils.toast(validation, "error");
      return;
    }

    // Costruisce il payload applicando `null` ai campi facoltativi vuoti.
    const payload = {
      firstName: model.firstName,
      lastName: model.lastName,
      phone: model.phone || null,
      specialty: model.specialty,
      licenseNumber: model.licenseNumber,
      officeLocation: model.officeLocation,
    };

    setLoading(true);

    try {
      // Aggiorna il profilo professionale lato backend e normalizza la risposta.
      const updated = normalizeProfile(await requestJson("PUT", API_PROFILE, payload));
      state.profile = updated;
      state.missing = false;

      // Aggiorna immediatamente il riepilogo e il form con i valori confermati dal backend.
      fillSummary(state.me, state.profile, false);
      fillForm(state.profile, state.me);

      APL.utils.toast("Profilo aggiornato.", "success");
    } catch (err) {
      const msg = APL.utils.humanizeError(err) || "Operazione non riuscita.";
      APL.utils.toast(msg, "error");
      showError(msg);

      // In caso di errore ripristina nel form l’ultimo stato noto in memoria.
      fillForm(state.profile, state.me);
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
        fillForm(state.profile, state.me);
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
  // - profile: profilo professionale del clinico;
  // - missing: indica se il profilo professionale non è ancora configurato.
  const state = {
    me: null,
    profile: null,
    missing: false,
  };

  // Inizializza la pagina profilo clinico al caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Clinician.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    wire();
    await load();
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
