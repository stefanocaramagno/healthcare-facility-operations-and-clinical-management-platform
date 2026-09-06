/**
 * File: frontend/js/common/session.js
 *
 * Scopo
 * -----
 * Gestire la persistenza e il recupero della sessione autenticata lato client,
 * centralizzando il salvataggio dei dati di autenticazione, la lettura del token,
 * il controllo della scadenza e la costruzione dell’header Authorization.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file costituisce il modulo condiviso del front-end dedicato alla sessione
 * utente. Espone nel namespace globale `window.APL.session` un insieme di utility
 * riutilizzabili dalle pagine applicative per leggere lo stato autenticativo e
 * interagire correttamente con gli endpoint protetti.
 *
 * Responsabilità principali
 * -------------------------
 * - definire la chiave standard di persistenza della sessione nel browser;
 * - normalizzare strutture di autenticazione provenienti da sorgenti eterogenee;
 * - salvare e recuperare i dati di sessione da `localStorage`;
 * - rimuovere la sessione quando necessario;
 * - verificare l’eventuale scadenza temporale del token;
 * - esporre helper per token, ruolo e header Authorization.
 *
 * Interazioni principali
 * ----------------------
 * - estende il namespace globale `window.APL.session`;
 * - utilizza `localStorage` per la persistenza client-side della sessione;
 * - si appoggia a `APL.utils.parseApiDate`, se disponibile, per il parsing coerente
 *   delle date di scadenza provenienti dalle API;
 * - viene richiamato dagli altri script del front-end per gestire accesso e chiamate
 *   verso endpoint autenticati.
 *
 * Note
 * ----
 * Il modulo è racchiuso in una IIFE per evitare l’inquinamento del global scope,
 * lasciando esposto solo il namespace applicativo controllato. La normalizzazione
 * dei campi di autenticazione rende il front-end più robusto rispetto a payload
 * con convenzioni di naming differenti.
 */

(function () {
  // Recupera o inizializza il namespace applicativo globale.
  const APL = (window.APL = window.APL || {});

  // Recupera o inizializza il sotto-namespace dedicato alla gestione della sessione.
  const session = (APL.session = APL.session || {});

  // Chiave unica usata per salvare i dati di autenticazione nel localStorage.
  const KEY = "apl.auth.v1";

  // Normalizza un generico oggetto di autenticazione in una struttura coerente.
  // Questo consente di gestire payload con nomi proprietà diversi ma semanticamente equivalenti.
  const normalizeAuth = (obj) => {
    // Se il valore non è un oggetto valido, non è possibile costruire una sessione utilizzabile.
    if (!obj || typeof obj !== "object") return null;

    // Recupera i campi supportando sia naming camelCase sia PascalCase,
    // oltre ad alcune varianti più generiche.
    const userId = obj.userId || obj.UserId || obj.id || obj.Id || "";
    const email = obj.email || obj.Email || "";
    const role = obj.role || obj.Role || "";
    const accessToken = obj.accessToken || obj.AccessToken || "";
    const expiresAtUtc = obj.expiresAtUtc || obj.ExpiresAtUtc || "";

    // Restituisce una struttura uniforme in cui tutti i campi sono convertiti a stringa.
    return {
      userId: String(userId),
      email: String(email),
      role: String(role),
      accessToken: String(accessToken),
      expiresAtUtc: String(expiresAtUtc),
    };
  };

  // Salva nel localStorage una sessione autenticata, se valida e dotata di access token.
  session.setAuth = (authLike) => {
    // Normalizza il payload ricevuto così da ottenere una struttura stabile.
    const auth = normalizeAuth(authLike);

    // Se l’oggetto non è valido o manca il token, non viene salvato nulla.
    if (!auth || !auth.accessToken) return;

    // Serializza e persiste la sessione nel browser.
    localStorage.setItem(KEY, JSON.stringify(auth));
  };

  // Recupera dal localStorage la sessione salvata, restituendola in forma normalizzata.
  session.getAuth = () => {
    // Legge il valore grezzo associato alla chiave di sessione.
    const raw = localStorage.getItem(KEY);

    // Se non esiste alcun dato salvato, restituisce null.
    if (!raw) return null;

    try {
      // Effettua il parsing JSON e normalizza l’oggetto ottenuto.
      return normalizeAuth(JSON.parse(raw));
    } catch {
      // In caso di contenuto non valido, evita eccezioni verso l’esterno.
      return null;
    }
  };

  // Elimina la sessione persistita nel browser.
  session.clearAuth = () => {
    localStorage.removeItem(KEY);
  };

  // Verifica se una sessione risulta scaduta rispetto all’istante corrente.
  session.isExpired = (auth) => {
    // Se manca l’oggetto sessione o la data di scadenza, non considera la sessione scaduta.
    if (!auth || !auth.expiresAtUtc) return false;

    // Prova a effettuare il parsing della data usando l’utility condivisa,
    // se disponibile; altrimenti usa il costruttore Date nativo.
    const expiresAt = APL.utils?.parseApiDate
      ? APL.utils.parseApiDate(auth.expiresAtUtc)
      : new Date(auth.expiresAtUtc);

    // Se la data non è interpretabile, evita di marcare la sessione come scaduta.
    if (!expiresAt || !Number.isFinite(expiresAt.getTime())) return false;

    // Confronta l’istante corrente con la scadenza memorizzata.
    return Date.now() >= expiresAt.getTime();
  };

  // Restituisce l’access token corrente solo se la sessione esiste e non è scaduta.
  session.getAccessToken = () => {
    // Recupera la sessione dal localStorage.
    const auth = session.getAuth();

    // Se non esiste alcuna sessione, restituisce stringa vuota.
    if (!auth) return "";

    // Se la sessione è scaduta, non espone il token.
    if (session.isExpired(auth)) return "";

    // Restituisce il token disponibile oppure stringa vuota come fallback.
    return auth.accessToken || "";
  };

  // Restituisce il ruolo associato alla sessione corrente.
  session.getRole = () => {
    // Recupera la sessione dal localStorage.
    const auth = session.getAuth();

    // Se la sessione non esiste, restituisce stringa vuota.
    if (!auth) return "";

    // Restituisce il ruolo disponibile oppure stringa vuota.
    return auth.role || "";
  };

  // Costruisce l’header Authorization da usare nelle richieste protette.
  session.authHeader = () => {
    // Recupera l’eventuale access token valido.
    const token = session.getAccessToken();

    // Se il token esiste, costruisce l’header Bearer; altrimenti restituisce un oggetto vuoto.
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
})();
