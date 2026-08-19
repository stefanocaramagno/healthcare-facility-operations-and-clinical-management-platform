/**
 * File: frontend/js/auth/login.js
 *
 * Scopo
 * -----
 * Gestire il flusso di autenticazione lato client della pagina di login,
 * comprendendo personalizzazione per ruolo, validazione dei dati inseriti,
 * invio delle credenziali alle API, gestione dei casi di account non attivato,
 * persistenza della sessione e reindirizzamento post-login.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica operativa della pagina di accesso del portale.
 * Si integra con i moduli condivisi `APL.utils` e `APL.session` per governare
 * interazione con il DOM, chiamate HTTP, messaggistica utente e salvataggio
 * della sessione autenticata nel browser.
 *
 * Responsabilità principali
 * -------------------------
 * - leggere e interpretare i parametri della query string;
 * - adattare la UI in base al ruolo suggerito nel link di ingresso;
 * - gestire visibilità password, errori e messaggi di stato;
 * - validare i dati minimi richiesti per il login;
 * - inviare la richiesta di autenticazione all’endpoint dedicato;
 * - salvare la sessione autenticata lato client;
 * - determinare il redirect corretto dopo il login;
 * - gestire il caso di account non ancora attivato e il reinvio del link.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `window.APL.utils` per query DOM, query string, richieste JSON,
 *   parsing errori, toast e loading state;
 * - utilizza `window.APL.session` per salvare i dati di autenticazione;
 * - interagisce con gli endpoint `/api/auth/login` e `/api/auth/activation/resend`;
 * - aggiorna dinamicamente la UI della pagina di login in base all’esito del flusso.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * Una parte importante della logica riguarda la sanitizzazione del redirect,
 * così da evitare navigazioni incoerenti o non compatibili con il ruolo autenticato.
 */

(function () {
  // Estrae dal namespace applicativo le utility comuni usate dal flusso di login.
  const { qs, readQuery, requestJson, parseErrorMessage, toast, setLoading } = window.APL.utils;

  // Estrae dal modulo sessione la funzione di persistenza dell’autenticazione.
  const { setAuth } = window.APL.session;

  // Mappa usata per mostrare un’etichetta di ruolo leggibile nella UI.
  const roleMap = {
    admin: "Amministrazione",
    clinician: "Area Clinica",
    patient: "Paziente",
    delegate: "Delegato",
  };

  // Dashboard di default verso cui reindirizzare l’utente dopo il login, in base al ruolo.
  const DASHBOARD_BY_ROLE = {
    Admin: "/pages/admin/dashboard.html",
    Clinician: "/pages/clinician/dashboard.html",
    Patient: "/pages/patient/dashboard.html",
    Delegate: "/pages/delegate/dashboard.html",
  };

  // Prefissi di path validi per ciascun ruolo, usati per verificare la compatibilità del redirect.
  const ROLE_PREFIX_BY_ROLE = {
    Admin: "/pages/admin/",
    Clinician: "/pages/clinician/",
    Patient: "/pages/patient/",
    Delegate: "/pages/delegate/",
  };

  // Recupera i principali riferimenti DOM usati dalla pagina di login.
  const form = qs("#loginForm");
  const emailEl = qs("#email");
  const pwdEl = qs("#password");
  const togglePwd = qs("#togglePwd");
  const submitBtn = qs("#submitBtn");
  const errorBox = qs("#errorBox");
  const roleBadge = qs("#roleBadge");
  const operatorNote = qs("#operatorNote");

  const forgotLink = qs("#forgotLink");
  const registerPatientLink = qs("#registerPatientLink");
  const registerDelegateLink = qs("#registerDelegateLink");

  const postAuthBox = qs("#postAuthBox");
  const activationBox = qs("#activationBox");
  const activationText = qs("#activationText");
  const resendActivationBtn = qs("#resendActivationBtn");

  // Legge i parametri della query string corrente.
  const q = readQuery();

  // Ruolo suggerito nel link di ingresso, usato per personalizzare la UI.
  const roleHint = (q.get("role") || "").toLowerCase().trim();

  // Redirect richiesto dal chiamante, da validare prima dell’uso.
  const redirectParamRaw = (q.get("redirect") || "").trim();

  // Applica alla pagina eventuali personalizzazioni basate sul ruolo suggerito nella query string.
  const applyRoleHint = () => {
    // Se il ruolo non è presente o non è riconosciuto, non modifica la UI.
    if (!roleHint || !roleMap[roleHint]) return;

    // Mostra il badge di ruolo con un’etichetta leggibile.
    if (roleBadge) {
      roleBadge.classList.remove("hidden");
      roleBadge.textContent = roleMap[roleHint];
    }

    // Per i ruoli interni all’organizzazione nasconde la self-registration
    // e mostra una nota informativa coerente con il flusso previsto.
    if (roleHint === "admin" || roleHint === "clinician") {
      if (registerPatientLink) registerPatientLink.classList.add("hidden");
      if (registerDelegateLink) registerDelegateLink.classList.add("hidden");
      if (operatorNote) operatorNote.classList.remove("hidden");
    }
  };

  // Mostra un messaggio di errore nel box dedicato.
  const showError = (msg) => {
    if (!errorBox) return;
    errorBox.textContent = msg;
    errorBox.classList.remove("hidden");
  };

  // Ripulisce e nasconde il box degli errori.
  const clearError = () => {
    if (!errorBox) return;
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  };

  // Mostra il messaggio transitorio che segnala completamento del login
  // e reindirizzamento imminente.
  const showPostAuth = () => {
    if (!postAuthBox) return;
    postAuthBox.classList.remove("hidden");
    postAuthBox.textContent = "Accesso completato. Reindirizzamento in corso...";
  };

  // Nasconde il box dedicato all’account non attivato e ne svuota il contenuto.
  const hideActivationBox = () => {
    if (!activationBox) return;
    activationBox.classList.add("hidden");
    if (activationText) activationText.textContent = "";
  };

  // Mostra il box dedicato al reinvio del link di attivazione.
  const showActivationBox = (email) => {
    if (!activationBox) return;

    // Rende visibile il contenitore.
    activationBox.classList.remove("hidden");

    // Personalizza il messaggio usando l’e-mail inserita, se disponibile.
    if (activationText) {
      activationText.textContent = email
        ? `L’account associato a ${email} non è ancora attivo. Verifica l’e-mail ricevuta oppure richiedi un nuovo link di attivazione.`
        : "L’account non è ancora attivo. Verifica l’e-mail ricevuta oppure richiedi un nuovo link di attivazione.";
    }
  };

  // Normalizza un ruolo in una forma canonica usata dal front-end.
  function normalizeRole(raw) {
    // Converte il valore in stringa ripulita.
    const s = String(raw || "").trim();
    if (!s) return "";

    // Lavora su una versione lowercase per confronti robusti.
    const low = s.toLowerCase();

    // Traduce eventuali alias verso i nomi standard del progetto.
    if (low === "admin" || low === "administrator") return "Admin";
    if (low === "clinician" || low === "doctor") return "Clinician";
    if (low === "patient") return "Patient";
    if (low === "delegate") return "Delegate";

    // Se non esiste una mappatura nota, restituisce il valore originale.
    return s;
  }

  // Sanifica il parametro di redirect per evitare destinazioni non ammesse o incoerenti.
  function sanitizeRedirect(value) {
    // Se il valore è assente, restituisce stringa vuota.
    if (!value) return "";

    // Ripulisce il valore in input.
    const v = String(value).trim();
    if (!v) return "";

    // Blocca redirect assoluti verso altri domini o protocol-relative URL.
    if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("//")) return "";

    let u;
    try {
      // Costruisce un URL relativo all’origin corrente per validarne la struttura.
      u = new URL(v, window.location.origin);
    } catch {
      return "";
    }

    // Consente solo redirect interni allo stesso origin.
    if (u.origin !== window.location.origin) return "";

    // Richiede la presenza di un pathname effettivo.
    if (!u.pathname) return "";

    // Esclude i redirect verso le pagine di autenticazione per evitare loop o flussi impropri.
    if (u.pathname.startsWith("/pages/auth/")) return "";

    // Esclude anche redirect banali verso home o root pubblica.
    if (u.pathname === "/" || u.pathname === "/index.html") return "";

    // Restituisce il percorso interno sanificato, comprensivo di query e hash.
    return u.pathname + u.search + u.hash;
  }

  // Verifica che un redirect sia compatibile con il ruolo autenticato.
  function isRedirectCompatibleWithRole(path, role) {
    // Se manca il path, il redirect non è valido.
    if (!path) return false;

    // Se il path punta a un’area applicativa riservata, deve appartenere al prefisso del ruolo corretto.
    if (path.startsWith("/pages/") && !path.startsWith("/pages/auth/")) {
      const expectedPrefix = ROLE_PREFIX_BY_ROLE[role];
      if (!expectedPrefix) return false;
      return path.startsWith(expectedPrefix);
    }

    // Per altri path interni, il redirect è considerato accettabile.
    return true;
  }

  // Determina il redirect finale dopo il login, scegliendo tra redirect richiesto e dashboard di default.
  function computePostLoginRedirect(authData) {
    // Normalizza il ruolo ottenuto dal payload di autenticazione.
    const role = normalizeRole(authData?.role);

    // Calcola la dashboard di fallback coerente con il ruolo.
    const defaultDash = DASHBOARD_BY_ROLE[role] || "/index.html";

    // Sanifica il redirect richiesto nella query string.
    const candidate = sanitizeRedirect(redirectParamRaw);

    // Se il redirect esiste ed è compatibile con il ruolo, lo usa come destinazione finale.
    if (candidate && isRedirectCompatibleWithRole(candidate, role)) {
      return candidate;
    }

    // In caso contrario, usa la dashboard standard del ruolo autenticato.
    return defaultDash;
  }

  // Reinvia il link di attivazione per un account non ancora attivo.
  async function resendActivationEmail() {
    // Pulisce eventuali errori precedenti.
    clearError();

    // Recupera l’e-mail attualmente inserita nel form.
    const email = (emailEl?.value || "").trim();

    // L’e-mail è necessaria per richiedere il reinvio del link.
    if (!email) {
      showError("Inserisci l’e-mail dell’account per reinviare il link di attivazione.");
      return;
    }

    // Mette il pulsante in stato di loading per evitare invii ripetuti.
    setLoading(resendActivationBtn, true, "Invio in corso...");

    try {
      // Invoca l’endpoint dedicato al reinvio del link di attivazione.
      const res = await requestJson("/api/auth/activation/resend", {
        method: "POST",
        json: { email },
      });

      // Se la richiesta non va a buon fine, mostra il messaggio restituito dall’API.
      if (!res.ok) {
        showError(parseErrorMessage(res.data));
        return;
      }

      // In caso di esito positivo, mostra una notifica non invasiva.
      toast("Se l’account non è ancora attivo, riceverai un nuovo link di attivazione.", "success");
    } catch (err) {
      // Gestisce gli errori di rete o altri problemi non previsti.
      showError("Impossibile reinviare il link di attivazione. Riprova tra qualche istante.");
    } finally {
      // Ripristina il pulsante allo stato normale.
      setLoading(resendActivationBtn, false);
    }
  }

  // Gestisce il toggle di visibilità della password nel campo di input.
  togglePwd?.addEventListener("click", () => {
    // Determina se il campo è attualmente in modalità password.
    const isPwd = pwdEl.type === "password";

    // Alterna il tipo del campo tra testo e password.
    pwdEl.type = isPwd ? "text" : "password";

    // Aggiorna l’etichetta del pulsante in coerenza con lo stato corrente.
    togglePwd.textContent = isPwd ? "Nascondi" : "Mostra";
  });

  // Propaga il parametro di redirect nel link "password dimenticata",
  // così da mantenere il flusso previsto anche nel recupero credenziali.
  if (forgotLink && redirectParamRaw) {
    const u = new URL(forgotLink.href, window.location.href);
    u.searchParams.set("redirect", redirectParamRaw);
    forgotLink.href = u.toString();
  }

  // Applica eventuali personalizzazioni UI basate sul ruolo suggerito.
  applyRoleHint();

  // All’avvio la sezione di attivazione deve rimanere nascosta.
  hideActivationBox();

  // Collega il pulsante di reinvio attivazione al relativo flusso.
  resendActivationBtn?.addEventListener("click", resendActivationEmail);

  // Gestisce l’invio del form di login.
  form?.addEventListener("submit", async (e) => {
    // Evita il submit HTML tradizionale per gestire il flusso via JavaScript.
    e.preventDefault();

    // Ripulisce lo stato visivo precedente prima di un nuovo tentativo.
    clearError();
    hideActivationBox();

    // Recupera e ripulisce i valori inseriti nei campi del form.
    const email = (emailEl?.value || "").trim();
    const password = (pwdEl?.value || "").trim();

    // Verifica minima di presenza dei campi obbligatori.
    if (!email || !password) {
      showError("E-mail e password sono obbligatori.");
      return;
    }

    // Mette il pulsante di submit in stato di loading per evitare invii multipli.
    setLoading(submitBtn, true, "Accesso in corso...");

    try {
      // Invoca l’endpoint di login inviando e-mail e password.
      const res = await requestJson("/api/auth/login", {
        method: "POST",
        json: { email, password },
      });

      // Se il login non va a buon fine, mostra il messaggio applicativo appropriato.
      if (!res.ok) {
        const message = parseErrorMessage(res.data);
        showError(message);

        // Gestisce il caso speciale di account non ancora attivato.
        if (res.status === 403 && res.data?.code === "account_not_activated") {
          showActivationBox(email);
        }

        return;
      }

      // Persiste i dati di autenticazione nel browser.
      setAuth(res.data);

      // Mostra un feedback positivo immediato.
      toast("Accesso effettuato.", "success");

      // Rende visibile il messaggio transitorio di reindirizzamento.
      showPostAuth();

      // Calcola la destinazione finale coerente con ruolo e redirect richiesto.
      const nextUrl = computePostLoginRedirect(res.data);

      // Ritarda leggermente la navigazione per consentire la percezione del feedback visivo.
      setTimeout(() => {
        window.location.assign(nextUrl);
      }, 650);
    } catch (err) {
      // Gestisce errori di rete o fallimenti non previsti nel flusso di autenticazione.
      showError("Impossibile completare l’accesso. Riprova tra qualche istante.");
    } finally {
      // Ripristina sempre il pulsante allo stato normale.
      setLoading(submitBtn, false);
    }
  });
})();
