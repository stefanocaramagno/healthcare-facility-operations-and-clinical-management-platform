/**
 * File: frontend/js/auth/reset-password.js
 *
 * Scopo
 * -----
 * Gestire il flusso di reimpostazione password lato client, comprendendo lettura
 * dei parametri di query, precompilazione del token quando disponibile, validazione
 * dei campi inseriti, invio della richiesta all’endpoint dedicato e successivo
 * reindirizzamento al login.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica operativa della pagina finale del recupero
 * credenziali. Si integra con le utility condivise del front-end per governare
 * interazione con il DOM, chiamate HTTP, gestione degli errori, notifiche utente
 * e stato di loading del pulsante di conferma.
 *
 * Responsabilità principali
 * -------------------------
 * - recuperare i riferimenti agli elementi del form di reset password;
 * - leggere eventuali parametri `redirect` e `token` dalla query string;
 * - precompilare il codice di reset quando presente nell’URL;
 * - aggiornare il link di ritorno al login in base al redirect richiesto;
 * - validare i campi obbligatori e la coerenza della nuova password;
 * - inviare la richiesta di reset password all’endpoint dedicato;
 * - mostrare messaggi di errore o conferma in base all’esito della richiesta;
 * - reindirizzare l’utente al login dopo il completamento del flusso.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `window.APL.utils` per query DOM, richieste JSON, parsing errori,
 *   toast, loading state e lettura della query string;
 * - interagisce con l’endpoint `/api/auth/password/reset`;
 * - aggiorna dinamicamente la UI della pagina di reset password in base all’esito
 *   del flusso.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La presenza del token in query string consente di semplificare l’esperienza
 * utente quando il reset viene avviato da un link ricevuto via e-mail.
 */

// Blocco di inizializzazione immediata dello script di reset password.
// Isola lo scope del file, acquisisce le utility condivise e prepara il flusso del form.
(function () {
  // Estrae dal namespace applicativo le utility condivise usate dalla pagina.
  const { qs, requestJson, parseErrorMessage, toast, setLoading, readQuery } = window.APL.utils;

  // Recupera i principali riferimenti DOM del form di reimpostazione password.
  const form = qs("#resetForm");
  const tokenEl = qs("#token");
  const newPwdEl = qs("#newPassword");
  const confirmEl = qs("#confirmPassword");
  const submitBtn = qs("#submitBtn");
  const errorBox = qs("#errorBox");
  const okBox = qs("#okBox");
  const backToLogin = qs("#backToLogin");

  // Legge i parametri della query string corrente.
  const q = readQuery();

  // Recupera l’eventuale redirect finale; in assenza di valore esplicito usa il login come fallback.
  const redirect = (q.get("redirect") || "./login.html").toString();

  // Recupera l’eventuale token di reset passato via query string.
  const tokenFromQuery = (q.get("token") || "").trim();

  // Se il token è presente nell’URL, lo precompila nel relativo campo del form.
  if (tokenFromQuery) tokenEl.value = tokenFromQuery;

  // Se è disponibile un link di ritorno al login, lo aggiorna con il redirect desiderato.
  if (backToLogin && redirect) {
    backToLogin.href = redirect;
  }

  // Mostra un messaggio di errore nel contenitore dedicato.
  // Se disponibile, aggiunge anche il Request-ID per facilitare il troubleshooting.
  const showError = (msg, requestId) => {
    const rid = requestId ? ` (Request-ID: ${requestId})` : "";
    errorBox.textContent = `${msg}${rid}`;
    errorBox.classList.remove("hidden");
  };

  // Ripulisce e nasconde sia il box degli errori sia quello dei messaggi di conferma.
  const clearBoxes = () => {
    // Ripristina il contenitore degli errori allo stato iniziale.
    errorBox.textContent = "";
    errorBox.classList.add("hidden");

    // Ripristina il contenitore dei messaggi positivi allo stato iniziale.
    okBox.textContent = "";
    okBox.classList.add("hidden");
  };

  // Gestisce l’invio del form di reimpostazione password.
  form?.addEventListener("submit", async (e) => {
    // Evita il submit HTML tradizionale per gestire il flusso via JavaScript.
    e.preventDefault();

    // Ripulisce eventuali messaggi mostrati da tentativi precedenti.
    clearBoxes();

    // Recupera e normalizza i valori inseriti nel form.
    const token = (tokenEl.value || "").trim();
    const newPassword = (newPwdEl.value || "").trim();
    const confirm = (confirmEl.value || "").trim();

    // Verifica la presenza di tutti i campi obbligatori.
    if (!token || !newPassword || !confirm) {
      showError("Compila tutti i campi.");
      return;
    }

    // Verifica la lunghezza minima della nuova password.
    if (newPassword.length < 8) {
      showError("La password deve contenere almeno 8 caratteri.");
      return;
    }

    // Verifica che nuova password e conferma coincidano.
    if (newPassword !== confirm) {
      showError("Le password non coincidono.");
      return;
    }

    // Mette il pulsante di submit in stato di loading per evitare invii multipli.
    setLoading(submitBtn, true, "Reimpostazione...");

    try {
      // Invia la richiesta di reimpostazione password all’endpoint dedicato.
      const res = await requestJson("/api/auth/password/reset", {
        method: "POST",
        json: { token, newPassword },
      });

      // Se la risposta API non è positiva, mostra il messaggio di errore restituito.
      if (!res.ok) {
        showError(parseErrorMessage(res.data), res.requestId);
        return;
      }

      // In caso di successo, mostra un messaggio di conferma nella pagina.
      okBox.classList.remove("hidden");
      okBox.textContent = "Password reimpostata correttamente. Verrai reindirizzato al login.";

      // Mostra anche una notifica sintetica di conferma.
      toast("Password aggiornata.", "success");

      // Dopo un breve intervallo reindirizza l’utente al login o al redirect richiesto.
      setTimeout(() => {
        window.location.assign(redirect);
      }, 1100);
    } catch (err) {
      // Gestisce errori di rete o problemi imprevisti nel flusso di reset password.
      showError(String(err));
    } finally {
      // Ripristina sempre il pulsante allo stato normale.
      setLoading(submitBtn, false);
    }
  });
})();
