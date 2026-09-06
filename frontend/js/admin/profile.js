/**
 * File: frontend/js/admin/profile.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina amministrativa dedicata
 * al profilo dell’account autenticato, comprendendo il caricamento delle
 * informazioni utente, il popolamento dei campi di sola consultazione e la
 * gestione dello stato di caricamento e degli eventuali errori globali.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Profilo" dell’area
 * Admin. Si integra con i moduli condivisi del front-end per autenticazione,
 * sessione, richieste HTTP e utilità generali, e interroga l’endpoint
 * dell’identità corrente per mostrare all’utente amministrativo i dati
 * essenziali del proprio account.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - recuperare dal backend i dati dell’utente corrente;
 * - normalizzare il payload ricevuto dall’endpoint `/api/me`;
 * - aggiornare i campi della UI con ruolo, email, identificativo e stato sessione;
 * - generare le iniziali mostrate nell’avatar del profilo;
 * - gestire caricamento, errori globali e redirect nei casi di sessione scaduta
 *   o accesso non autorizzato.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.session.clearAuth` nei casi di sessione non più valida;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`
 *   e `APL.utils.humanizeError`;
 * - interagisce con l’endpoint `/api/me` per recuperare i dati dell’utente
 *   autenticato.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina è puramente consultiva: non espone azioni di modifica diretta
 * dei dati account, ma solo la visualizzazione delle informazioni e il rinvio
 * alla procedura di reimpostazione password.
 */

(function () {
  "use strict";

  // Ruolo richiesto per l’accesso alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint dedicato al recupero del profilo dell’utente autenticato.
  const API_ME = "/api/me";

  // Utility locale per recuperare rapidamente un elemento DOM tramite id.
  function $(id) {
    return document.getElementById(id);
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

  // Aggiorna lo stato dell’indicatore di caricamento globale.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);
  }

  // Imposta il contenuto testuale di un elemento DOM, usando un placeholder
  // leggibile quando il valore non è disponibile.
  function setText(id, value) {
    const el = $(id);
    if (!el) return;

    el.textContent = value == null || value === "" ? "—" : String(value);
  }

  // Ricava le iniziali da mostrare nell’avatar partendo dalla parte locale dell’email.
  // Gestisce indirizzi con separatori comuni come punto, trattino e underscore.
  function initialsFromEmail(email) {
    const s = String(email || "").trim();
    if (!s) return "—";

    const at = s.indexOf("@");
    const left = (at > 0 ? s.slice(0, at) : s).trim();
    const parts = left.split(/[.\-_]/g).filter(Boolean);

    const a = (parts[0] || left).slice(0, 1).toUpperCase();
    const b = (parts[1] || "").slice(0, 1).toUpperCase();

    return (a + b) || a || "—";
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione coerente
  // dei casi di sessione scaduta, accesso vietato ed errore applicativo generico.
  async function requestJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // Se la sessione è scaduta, ripulisce lo stato locale e delega il redirect
      // alla vista di sessione scaduta.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }

        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();

        const err = new Error("Sessione scaduta.");
        err.status = 401;
        throw err;
      }

      // Se l’utente non ha i privilegi richiesti, delega il redirect alla vista forbidden.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();

        const err = new Error("Accesso non autorizzato.");
        err.status = 403;
        throw err;
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

  // Normalizza il payload dell’endpoint `/api/me` in una struttura uniforme lato client.
  // Questo evita di dipendere nel resto del file da varianti di naming dei campi.
  function normalizeMe(x) {
    return {
      id: x?.id ?? x?.Id ?? "",
      email: x?.email ?? x?.Email ?? "",
      role: x?.role ?? x?.Role ?? "Admin",
    };
  }

  // Popola la UI della pagina con i dati del profilo corrente.
  function fill(me) {
    // Aggiorna i campi testuali principali del riepilogo profilo.
    setText("roleText", me.role || "Admin");
    setText("emailText", me.email || "—");
    setText("userIdText", me.id || "—");

    // La pagina rappresenta una sessione attualmente autenticata e attiva.
    setText("sessionText", "Attiva");

    // Aggiorna l’avatar testuale con le iniziali derivate dall’email.
    const avatar = $("avatar");
    if (avatar) {
      avatar.textContent = initialsFromEmail(me.email);
      avatar.title = me.email || "";
    }

    // Popola il campo email di sola lettura nella sezione dati account.
    const email = $("email");
    if (email) email.value = me.email || "";
  }

  // Carica il profilo dell’utente autenticato dal backend e aggiorna la pagina.
  async function load() {
    clearError();
    setLoading(true);

    try {
      // Recupera, normalizza e memorizza localmente il profilo corrente.
      const me = normalizeMe(await requestJson("GET", API_ME));
      state.me = me;

      // Popola la UI con i dati ottenuti.
      fill(me);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare il profilo.");
    } finally {
      setLoading(false);
    }
  }

  // Punto previsto per eventuali binding futuri della pagina.
  // Al momento la vista è puramente consultiva e non richiede listener dedicati.
  function wire() {
  }

  // Stato locale della pagina.
  // Conserva il profilo corrente già caricato, utile per eventuali estensioni future.
  const state = { me: null };

  // Inizializza la pagina quando il DOM è pronto.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non possiede il ruolo amministrativo richiesto.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Collega eventuali eventi della pagina.
    wire();

    // Carica i dati iniziali del profilo.
    await load();
  }

  // Avvia l’inizializzazione al completamento del parsing del documento.
  document.addEventListener("DOMContentLoaded", init);
})();
