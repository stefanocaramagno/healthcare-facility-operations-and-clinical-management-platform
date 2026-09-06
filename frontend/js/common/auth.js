/**
 * File: frontend/js/common/auth.js
 *
 * Scopo
 * -----
 * Centralizzare la logica condivisa di autenticazione e autorizzazione lato client,
 * gestendo normalizzazione dei ruoli, riconoscimento del contesto pagina, costruzione
 * degli URL di login, protezione delle pagine riservate, recupero del profilo corrente
 * e flusso di logout.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo modulo espone nel namespace globale `window.APL.auth` le utility principali
 * usate dal front-end per governare l’accesso alle aree protette del portale,
 * coordinandosi con il modulo di sessione e con le API esposte dal back-end.
 *
 * Responsabilità principali
 * -------------------------
 * - normalizzare i ruoli provenienti da query string, path o payload API;
 * - dedurre il ruolo atteso in base al pathname corrente;
 * - costruire URL di login con parametri di redirect e ruolo;
 * - reindirizzare verso le pagine di errore corrette nei casi di 403 o sessione scaduta;
 * - proteggere le pagine riservate tramite verifica della sessione e del ruolo atteso;
 * - recuperare il profilo dell’utente autenticato tramite `/api/me`;
 * - gestire il logout applicativo e la successiva pulizia della sessione client-side.
 *
 * Interazioni principali
 * ----------------------
 * - estende il namespace globale `window.APL.auth`;
 * - utilizza `APL.session` per leggere e cancellare la sessione autenticata;
 * - utilizza `APL.utils.requestJson` e `APL.utils.parseErrorMessage` per le chiamate API;
 * - interagisce con `window.location` per costruire redirect e navigazioni;
 * - invoca gli endpoint `/api/me` e `/api/auth/logout`.
 *
 * Note
 * ----
 * Il modulo è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La cache interna `_mePromise` evita chiamate duplicate a `/api/me` durante il
 * ciclo di vita della pagina quando più componenti richiedono le stesse informazioni.
 */

(function () {
  "use strict";

  // Garantisce l’esistenza del namespace applicativo globale.
  if (!window.APL) window.APL = {};
  const A = window.APL;

  // Mappa tra ruolo normalizzato e prefisso di path delle rispettive aree applicative.
  const ROLE_PREFIX = {
    Admin: "/pages/admin/",
    Clinician: "/pages/clinician/",
    Patient: "/pages/patient/",
    Delegate: "/pages/delegate/",
  };

  // Normalizza una rappresentazione di ruolo in una forma canonica usata dal front-end.
  function normalizeRole(raw) {
    // Converte il valore in stringa ripulita.
    const s = String(raw || "").trim();
    if (!s) return "";

    // Lavora su una versione lowercase per confronti robusti.
    const low = s.toLowerCase();

    // Ricompone eventuali alias o varianti verso il nome standard del ruolo.
    if (low === "admin" || low === "administrator") return "Admin";
    if (low === "clinician" || low === "doctor") return "Clinician";
    if (low === "patient") return "Patient";
    if (low === "delegate") return "Delegate";

    // Se non esiste una normalizzazione specifica, restituisce il valore originale.
    return s;
  }

  // Deduce il ruolo atteso partendo dal pathname della pagina corrente.
  function roleFromPath(pathname) {
    // Usa il pathname fornito oppure, in fallback, quello della location corrente.
    const p = String(pathname || window.location.pathname || "");

    // Cerca il segmento `/pages/<role>/` per individuare l’area applicativa.
    const m = p.match(/\/pages\/(admin|clinician|patient|delegate)\//i);
    if (!m) return "";

    // Normalizza il segmento trovato per ottenere il ruolo canonico.
    const seg = m[1].toLowerCase();
    return normalizeRole(seg);
  }

  // Costruisce l’URL della pagina di login includendo redirect e, se disponibile, il ruolo.
  function buildLoginUrl(role, redirectPath) {
    // Codifica il percorso di ritorno, usando la pagina corrente come fallback.
    const r = encodeURIComponent(redirectPath || (window.location.pathname + window.location.search));

    // Se il ruolo è noto, lo aggiunge come parametro informativo alla pagina di login.
    const roleParam = role ? `&role=${encodeURIComponent(String(role).toUpperCase())}` : "";

    return `/pages/auth/login.html?redirect=${r}${roleParam}`;
  }

  // Reindirizza l’utente verso la pagina di accesso negato.
  function redirectToForbidden() {
    // Propaga il percorso corrente come informazione utile per eventuali flussi futuri.
    const r = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/_errors/403.html?redirect=${r}`;
  }

  // Reindirizza l’utente verso la pagina di sessione scaduta.
  function redirectToSessionExpired() {
    // Recupera il ruolo dalla sessione corrente; in fallback lo deduce dal path.
    const role = normalizeRole(A.session?.getAuth?.()?.role) || roleFromPath();

    // Propaga il percorso corrente così da poter riprendere il flusso dopo nuovo login.
    const r = encodeURIComponent(window.location.pathname + window.location.search);

    // Se il ruolo è disponibile, lo inoltra come parametro contestuale.
    const roleParam = role ? `&role=${encodeURIComponent(String(role).toUpperCase())}` : "";
    window.location.href = `/_errors/session-expired.html?redirect=${r}${roleParam}`;
  }

  // Verifica che esista una sessione valida e, opzionalmente, che il ruolo coincida con quello atteso.
  function requireAuth(expectedRole) {
    // Se il modulo sessione non è disponibile, non può essere eseguita alcuna verifica affidabile.
    if (!A.session || !A.session.getAuth) {
      return null;
    }

    // Recupera la sessione autenticata dal modulo condiviso.
    const auth = A.session.getAuth();

    // Se non esiste una sessione, reindirizza al login contestualizzando il ruolo atteso.
    if (!auth) {
      const role = expectedRole || roleFromPath();
      window.location.href = buildLoginUrl(role, window.location.pathname + window.location.search);
      return null;
    }

    // Normalizza il ruolo reale della sessione per confrontarlo in modo coerente.
    const actualRole = normalizeRole(auth.role);

    // Se è richiesto un ruolo specifico e non coincide con quello reale, nega l’accesso.
    if (expectedRole && actualRole !== normalizeRole(expectedRole)) {
      redirectToForbidden();
      return null;
    }

    // Restituisce la sessione corrente quando i controlli sono soddisfatti.
    return auth;
  }

  // Cache interna della Promise associata al recupero del profilo utente corrente.
  let _mePromise = null;

  // Recupera il profilo dell’utente autenticato tramite l’endpoint `/api/me`.
  async function getMe() {
    // Se è già in corso o disponibile una richiesta precedente, riusa quella Promise.
    if (_mePromise) return _mePromise;

    // Costruisce e memorizza la richiesta in modo che chiamate concorrenti condividano lo stesso risultato.
    _mePromise = (async () => {
      // Esegue la chiamata protetta verso l’endpoint che restituisce il profilo corrente.
      const res = await A.utils.requestJson("/api/me", {
        headers: { Accept: "application/json", ...A.session.authHeader() },
      });

      // Se la risposta non è positiva, gestisce i principali casi applicativi.
      if (!res.ok) {
        // In caso di 401, svuota la sessione locale e reindirizza alla pagina di sessione scaduta.
        if (res.status === 401) {
          try {
            A.session.clearAuth();
          } catch (_) { }
          redirectToSessionExpired();
          throw new Error("Sessione scaduta.");
        }

        // In caso di 403, reindirizza alla pagina di accesso negato.
        if (res.status === 403) {
          redirectToForbidden();
          throw new Error("Accesso non autorizzato.");
        }

        // Per gli altri errori, prova a ricavare un messaggio leggibile dal payload ricevuto.
        throw new Error(A.utils.parseErrorMessage ? A.utils.parseErrorMessage(res.data) : "Errore.");
      }

      // Se la risposta è valida, restituisce il payload del profilo utente.
      return res.data;
    })();

    return _mePromise;
  }

  // Esegue il logout applicativo, prova a notificare il back-end e poi pulisce la sessione locale.
  async function logout(options) {
    // Determina il ruolo corrente da usare per costruire un eventuale login contestualizzato successivo.
    const role = normalizeRole(A.session?.getAuth?.()?.role) || roleFromPath();

    // Recupera un eventuale redirect richiesto dal chiamante.
    const redirect = options?.redirect || "";

    try {
      // Prova a notificare al back-end l’uscita dell’utente.
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { ...A.session.authHeader(), "Content-Type": "application/json" },
      });
    } catch (_) {
      // Eventuali errori di rete o back-end non bloccano comunque la chiusura lato client.
    } finally {
      try {
        // Pulisce sempre la sessione locale del browser.
        A.session.clearAuth();
      } catch (_) { }

      // Reindirizza l’utente al login, mantenendo il ruolo e un redirect coerente.
      window.location.href = buildLoginUrl(role, redirect || "/index.html");
    }
  }

  // Espone nel namespace applicativo le utility pubbliche del modulo auth.
  A.auth = {
    normalizeRole,
    roleFromPath,
    requireAuth,
    getMe,
    logout,
    redirectToForbidden,
    redirectToSessionExpired,
    buildLoginUrl,
  };
})();
