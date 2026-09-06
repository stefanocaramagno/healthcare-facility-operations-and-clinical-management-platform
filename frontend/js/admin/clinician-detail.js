/**
 * File: frontend/js/admin/clinician-detail.js
 *
 * Scopo
 * -----
 * Gestire il caricamento, la visualizzazione e il salvataggio della scheda
 * amministrativa del clinico, includendo sia la consultazione/modifica del
 * profilo professionale esistente sia la creazione iniziale di un nuovo clinico.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della pagina di dettaglio
 * del clinico nell’area Admin. Si integra con i moduli condivisi del front-end
 * per verificare il ruolo dell’utente autenticato, interrogare gli endpoint
 * protetti, popolare i campi del profilo e gestire le operazioni di creazione
 * o aggiornamento.
 *
 * Responsabilità principali
 * -------------------------
 * - determinare se la pagina è in modalità creazione o dettaglio;
 * - recuperare l’identificativo del clinico dalla query string;
 * - caricare il profilo professionale del clinico;
 * - popolare e aggiornare l’interfaccia della scheda;
 * - validare i dati del profilo e dell’account in modalità create;
 * - creare un nuovo clinico oppure aggiornare un profilo esistente;
 * - mostrare stati di caricamento, errori globali e messaggi di conferma.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.requestJson`, `APL.utils.readQuery`,
 *   `APL.utils.parseErrorMessage`, `APL.utils.humanizeError`,
 *   `APL.utils.setLoading` e `APL.utils.toast`;
 * - interagisce con gli endpoint:
 *   `/api/registry/admin/clinicians`,
 *   `/api/registry/admin/clinicians/{userId}/profile`;
 * - aggiorna dinamicamente il DOM della pagina di dettaglio clinico.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina supporta due modalità operative:
 * - creazione di un nuovo clinico con account iniziale;
 * - visualizzazione/modifica del profilo professionale di un clinico esistente.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint base per la creazione di un nuovo clinico.
  const API_CREATE_CLINICIAN = "/api/registry/admin/clinicians";

  // Endpoint parametrizzato per il recupero e il salvataggio del profilo clinico.
  const API_CLINICIAN_PROFILE = (userId) => `/api/registry/admin/clinicians/${userId}/profile`;

  // Stato locale principale della pagina.
  let _userId = "";
  let _profile = null;
  let _requestSeq = 0;
  let _isCreateMode = false;

  // Restituisce un elemento DOM tramite il suo id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel contenitore globale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    // Imposta il testo del messaggio e rende visibile il contenitore.
    box.textContent = message || "Si è verificato un errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore globale degli errori.
  function clearError() {
    const box = $("pageError");
    if (!box) return;

    // Ripristina il contenuto e lo stato iniziale.
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna gli indicatori di caricamento e abilita/disabilita i controlli della pagina.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Aggiorna l’eventuale pulsante di refresh, se presente nel markup.
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) APL.utils.setLoading(btnRefresh, loading, "Aggiornamento…");

    // Durante il caricamento blocca il pulsante principale di salvataggio.
    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) btnSaveProfile.disabled = !!loading;

    // Disabilita i campi del form mentre è in corso un’operazione remota.
    const fieldIds = [
      "firstName",
      "lastName",
      "phone",
      "specialty",
      "licenseNumber",
      "officeLocation",
      "email",
      "password",
    ];

    for (const id of fieldIds) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Abilita o disabilita visivamente e funzionalmente una sezione della pagina.
  function setSectionEnabled(sectionId, enabled) {
    const sec = $(sectionId);
    if (!sec) return;

    // Usa classi CSS per comunicare blocco operativo e stato attenuato.
    sec.classList.toggle("opacity-60", !enabled);
    sec.classList.toggle("pointer-events-none", !enabled);
  }

  // Normalizza una stringa che potrebbe contenere un GUID.
  function normalizeGuidCandidate(value) {
    let v = String(value || "").trim();
    if (!v) return "";

    // Supporta anche GUID racchiusi tra graffe.
    if (v.startsWith("{") && v.endsWith("}")) v = v.slice(1, -1).trim();

    return v;
  }

  // Verifica se il valore passato rispetta il formato GUID atteso.
  function isGuid(value) {
    const v = normalizeGuidCandidate(value);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  }

  // Legge dalla query string l’identificativo del clinico usando più possibili alias.
  function readUserIdFromUrl() {
    const qs = APL.utils.readQuery();
    const keys = ["userId", "userid", "id", "clinicianUserId", "clinicianId"];

    // Scorre i nomi parametro supportati e restituisce il primo GUID valido trovato.
    for (const k of keys) {
      const raw = qs.get(k);
      const v = normalizeGuidCandidate(raw);
      if (isGuid(v)) return v;
    }

    return "";
  }

  // Determina se la pagina è stata aperta in modalità di creazione.
  function readCreateModeFromUrl() {
    const qs = APL.utils.readQuery();
    const mode = String(qs.get("mode") || "").trim().toLowerCase();
    const action = String(qs.get("action") || "").trim().toLowerCase();

    return mode === "create" || action === "create";
  }

  // Verifica la presenza del flag `created` nella query string.
  function hasCreatedFlag() {
    const qs = APL.utils.readQuery();
    const raw = String(qs.get("created") || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  }

  // Rimuove dalla URL il flag `created` dopo che è stato consumato.
  function consumeCreatedFlag() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("created")) return;

    url.searchParams.delete("created");
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  // Esegue una richiesta JSON autenticata e gestisce i principali casi applicativi di errore.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Se la risposta non è positiva, gestisce sessione scaduta, accesso negato e altri errori.
    if (!res.ok) {
      if (res.status === 401) {
        try {
          APL.session.clearAuth();
        } catch (_) {
        }

        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Costruisce un errore arricchito con informazioni utili per la gestione a monte.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Imposta il testo di un elemento identificato da id.
  function setText(id, value) {
    const el = $(id);
    if (!el) return;
    el.textContent = value ?? "—";
  }

  // Imposta il value di un campo input identificato da id.
  function setValue(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value ?? "";
  }

  // Mostra o nasconde un elemento in base al valore booleano passato.
  function toggleHidden(id, hidden) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("hidden", !!hidden);
  }

  // Normalizza il payload profilo proveniente dall’API gestendo sia camelCase sia PascalCase.
  function normalizeProfile(x) {
    return {
      id: x?.id ?? x?.Id ?? "",
      userId: x?.userId ?? x?.UserId ?? "",
      firstName: x?.firstName ?? x?.FirstName ?? "",
      lastName: x?.lastName ?? x?.LastName ?? "",
      phone: x?.phone ?? x?.Phone ?? "",
      specialty: x?.specialty ?? x?.Specialty ?? "",
      licenseNumber: x?.licenseNumber ?? x?.LicenseNumber ?? "",
      officeLocation: x?.officeLocation ?? x?.OfficeLocation ?? "",
    };
  }

  // Costruisce il testo da usare nel titolo della pagina a partire dal profilo.
  function profileDisplayName(profile) {
    const firstName = String(profile?.firstName || "").trim();
    const lastName = String(profile?.lastName || "").trim();
    const full = `${firstName} ${lastName}`.trim();

    // Se nome e cognome sono disponibili, usa il nominativo completo.
    if (full) return full;

    // In assenza del nominativo, prova a valorizzare il titolo con la specialità.
    const specialty = String(profile?.specialty || "").trim();
    return specialty ? `Dettaglio clinico — ${specialty}` : "Dettaglio clinico";
  }

  // Applica alla UI la modalità corrente della pagina: creazione o dettaglio esistente.
  function applyModeUi() {
    const subtitle = _isCreateMode
      ? "Inserimento di un nuovo clinico con creazione contestuale di account e profilo professionale."
      : "Visualizzazione e gestione delle informazioni professionali.";

    // Aggiorna testi principali della pagina in base alla modalità operativa.
    setText("clinicianSubtitle", subtitle);
    setText("clinicianTitleName", _isCreateMode ? "Nuovo clinico" : profileDisplayName(_profile));
    setText("clinicianUserId", _isCreateMode ? "Disponibile dopo la creazione" : (_userId || "—"));
    setText("clinicianProfileId", _isCreateMode ? "Disponibile dopo la creazione" : (_profile?.id ? String(_profile.id) : "—"));

    // Aggiorna il messaggio contestuale relativo al profilo professionale.
    const hint = $("profileHint");
    if (hint) {
      hint.textContent = _isCreateMode
        ? "Compili i dati di accesso e il profilo professionale per registrare il nuovo clinico."
        : "Le informazioni professionali non risultano ancora complete. È possibile inserirle e salvare la scheda.";
      hint.classList.toggle("hidden", !_isCreateMode && !!_profile);
    }

    // Aggiorna l’etichetta del pulsante principale di salvataggio.
    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) btnSaveProfile.textContent = _isCreateMode ? "Crea clinico" : "Salva profilo";

    // Aggiorna la nota informativa sulle operazioni di salvataggio.
    const notesBox = $("saveInfoText");
    if (notesBox) {
      notesBox.textContent = _isCreateMode
        ? "La registrazione crea il nuovo account clinico e il profilo professionale in un’unica operazione."
        : "Le modifiche vengono applicate solo dopo il salvataggio.";
    }

    // Attiva o disattiva le sezioni pertinenti alla modalità corrente.
    toggleHidden("accountSection", !_isCreateMode);
    toggleHidden("createModeNotice", !_isCreateMode);
  }

  // Aggiorna intestazione e identificativi usando i dati del profilo corrente.
  function setHeaderFromProfile() {
    // In modalità creazione si limita a riallineare la UI standard della modalità.
    if (_isCreateMode) {
      applyModeUi();
      return;
    }

    setText("clinicianUserId", _userId || "—");
    setText("clinicianProfileId", _profile?.id ? String(_profile.id) : "—");
    setText("clinicianTitleName", profileDisplayName(_profile));

    // Mostra il suggerimento di completamento profilo solo quando il profilo non è disponibile.
    const hint = $("profileHint");
    if (hint) {
      hint.textContent = "Le informazioni professionali non risultano ancora complete. È possibile inserirle e salvare la scheda.";
      hint.classList.toggle("hidden", !!_profile);
    }
  }

  // Compila i campi del form professionale con i dati del profilo corrente.
  function fillProfileForm() {
    setValue("firstName", _profile?.firstName ? String(_profile.firstName) : "");
    setValue("lastName", _profile?.lastName ? String(_profile.lastName) : "");
    setValue("phone", _profile?.phone ? String(_profile.phone) : "");
    setValue("specialty", _profile?.specialty ? String(_profile.specialty) : "");
    setValue("licenseNumber", _profile?.licenseNumber ? String(_profile.licenseNumber) : "");
    setValue("officeLocation", _profile?.officeLocation ? String(_profile.officeLocation) : "");

    // In modalità creazione i dati di accesso partono sempre vuoti.
    if (_isCreateMode) {
      setValue("email", "");
      setValue("password", "");
    }
  }

  // Legge e valida i campi del profilo professionale del clinico.
  function readProfileForm() {
    const firstName = String($("firstName")?.value || "").trim();
    const lastName = String($("lastName")?.value || "").trim();
    const phone = String($("phone")?.value || "").trim();
    const specialty = String($("specialty")?.value || "").trim();
    const licenseNumber = String($("licenseNumber")?.value || "").trim();
    const officeLocation = String($("officeLocation")?.value || "").trim();

    // Verifica la presenza dei campi professionali obbligatori.
    if (!firstName) return { ok: false, message: "Il nome è obbligatorio." };
    if (!lastName) return { ok: false, message: "Il cognome è obbligatorio." };
    if (!specialty) return { ok: false, message: "La specialità è obbligatoria." };
    if (!licenseNumber) return { ok: false, message: "Il numero di licenza è obbligatorio." };
    if (!officeLocation) return { ok: false, message: "La sede è obbligatoria." };

    return {
      ok: true,
      payload: {
        firstName,
        lastName,
        phone: phone || null,
        specialty,
        licenseNumber,
        officeLocation,
      },
    };
  }

  // Verifica la validità sintattica minima di un indirizzo e-mail.
  function isValidEmail(value) {
    const email = String(value || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Legge e valida i dati di accesso usati nella modalità di creazione del clinico.
  function readAccountForm() {
    const email = String($("email")?.value || "").trim();
    const password = String($("password")?.value || "").trim();

    // Verifica presenza e validità minima dei dati di accesso.
    if (!email) return { ok: false, message: "L’e-mail è obbligatoria." };
    if (!isValidEmail(email)) return { ok: false, message: "L’e-mail inserita non è valida." };
    if (!password) return { ok: false, message: "La password è obbligatoria." };
    if (password.length < 8) return { ok: false, message: "La password deve contenere almeno 8 caratteri." };

    return { ok: true, payload: { email, password } };
  }

  // Carica il profilo del clinico esistente e aggiorna la UI.
  async function loadProfile() {
    clearError();
    setLoading(true);
    setSectionEnabled("sectionProfile", false);

    const seq = ++_requestSeq;

    try {
      const data = normalizeProfile(await apiJson("GET", API_CLINICIAN_PROFILE(_userId)));

      // Se nel frattempo è partita un’altra richiesta, interrompe l’aggiornamento della UI.
      if (seq !== _requestSeq) return;

      _profile = data || null;

      // Aggiorna header e form con i dati appena caricati.
      setHeaderFromProfile();
      fillProfileForm();

      setSectionEnabled("sectionProfile", true);
    } catch (err) {
      if (seq !== _requestSeq) return;

      // Se il profilo non esiste ancora, abilita comunque la sezione per l’inserimento manuale.
      if (err && err.status === 404) {
        _profile = null;
        setHeaderFromProfile();
        fillProfileForm();
        setSectionEnabled("sectionProfile", true);
        return;
      }

      showError(APL.utils.humanizeError(err) || "Si è verificato un errore imprevisto.");
    } finally {
      if (seq === _requestSeq) setLoading(false);
    }
  }

  // Esegue la creazione di un nuovo clinico combinando dati di accesso e profilo professionale.
  async function createClinician() {
    const account = readAccountForm();
    if (!account.ok) {
      APL.utils.toast(account.message, "error");
      return;
    }

    const profile = readProfileForm();
    if (!profile.ok) {
      APL.utils.toast(profile.message, "error");
      return;
    }

    // Costruisce il payload di creazione combinando account e profilo.
    const payload = {
      email: account.payload.email,
      password: account.payload.password,
      firstName: profile.payload.firstName,
      lastName: profile.payload.lastName,
      phone: profile.payload.phone,
      specialty: profile.payload.specialty,
      licenseNumber: profile.payload.licenseNumber,
      officeLocation: profile.payload.officeLocation,
    };

    const created = await apiJson("POST", API_CREATE_CLINICIAN, payload);
    const newUserId = normalizeGuidCandidate(created?.userId || created?.UserId || "");

    // Verifica che il back-end abbia restituito un identificativo valido per proseguire.
    if (!isGuid(newUserId)) {
      throw new Error("Risposta del server non valida: identificativo utente non disponibile.");
    }

    // Reindirizza alla stessa pagina in modalità dettaglio, segnalando che la creazione è appena avvenuta.
    const detailUrl = new URL("./clinician-detail.html", window.location.href);
    detailUrl.searchParams.set("userId", newUserId);
    detailUrl.searchParams.set("created", "1");
    window.location.href = detailUrl.toString();
  }

  // Salva il profilo del clinico oppure crea un nuovo clinico in modalità create.
  async function saveProfile() {
    clearError();

    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) {
      APL.utils.setLoading(btnSaveProfile, true, _isCreateMode ? "Creazione…" : "Salvataggio…");
    }

    try {
      if (_isCreateMode) {
        // In modalità creazione delega l’operazione alla funzione dedicata.
        await createClinician();
        return;
      }

      // In modalità dettaglio legge e valida il profilo professionale.
      const r = readProfileForm();
      if (!r.ok) {
        APL.utils.toast(r.message, "error");
        return;
      }

      // Aggiorna il profilo lato server e riallinea lo stato locale.
      const saved = normalizeProfile(await apiJson("PUT", API_CLINICIAN_PROFILE(_userId), r.payload));
      _profile = saved || null;

      setHeaderFromProfile();
      fillProfileForm();

      APL.utils.toast("Profilo salvato correttamente.", "success");
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      if (btnSaveProfile) {
        APL.utils.setLoading(btnSaveProfile, false);
      }
    }
  }

  // Collega gli handler degli eventi principali della pagina.
  function wireHandlers() {
    const btnRefresh = $("btnRefresh");
    if (btnRefresh) btnRefresh.addEventListener("click", () => loadProfile());

    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) btnSaveProfile.addEventListener("click", () => saveProfile());
  }

  // Mostra lo stato “scheda non disponibile” e nasconde il contenuto principale.
  function showMissingState() {
    const missing = $("missingState");
    const main = $("mainContent");
    if (missing) missing.classList.remove("hidden");
    if (main) main.classList.add("hidden");

    // Blocca anche la sezione operativa del profilo.
    setSectionEnabled("sectionProfile", false);
  }

  // Inizializza la pagina verificando ruolo, modalità operativa e dati da caricare.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Determina modalità create/detail e identificativo clinico dalla URL.
    _isCreateMode = readCreateModeFromUrl();
    _userId = readUserIdFromUrl();

    wireHandlers();

    if (_isCreateMode) {
      // In modalità creazione prepara la UI senza effettuare caricamenti remoti del dettaglio.
      applyModeUi();
      fillProfileForm();
      setSectionEnabled("sectionProfile", true);
      if (hasCreatedFlag()) consumeCreatedFlag();
      return;
    }

    // Se non esiste uno userId valido in modalità dettaglio, mostra lo stato di errore contestuale.
    if (!_userId) {
      showMissingState();
      return;
    }

    // Se la pagina è stata raggiunta subito dopo una creazione, mostra il toast di conferma.
    if (hasCreatedFlag()) {
      consumeCreatedFlag();
      APL.utils.toast("Clinico registrato correttamente.", "success");
    }

    applyModeUi();
    await loadProfile();
  }

  // Avvia l’inizializzazione della pagina quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
