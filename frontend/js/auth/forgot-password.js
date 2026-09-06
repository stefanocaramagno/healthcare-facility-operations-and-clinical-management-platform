/**
 * File: frontend/js/auth/forgot-password.js
 *
 * Scopo
 * -----
 * Gestire il flusso di richiesta del recupero password lato client, comprendendo
 * lettura dei parametri di query, aggiornamento dei collegamenti di supporto,
 * validazione minima dell’e-mail, invio della richiesta all’endpoint dedicato
 * e visualizzazione dei messaggi di esito per l’utente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica operativa della pagina di recupero password.
 * Si integra con le utility condivise del front-end per governare interazione
 * con il DOM, chiamate HTTP, stato di loading del pulsante e notifiche di esito.
 *
 * Responsabilità principali
 * -------------------------
 * - recuperare i riferimenti agli elementi del form di recupero password;
 * - leggere l’eventuale parametro di redirect dalla query string;
 * - propagare il redirect al link verso la pagina di reset password;
 * - validare la presenza dell’e-mail inserita;
 * - inviare la richiesta di recupero all’endpoint dedicato;
 * - mostrare messaggi di errore o informativi in base all’esito della richiesta;
 * - notificare all’utente l’avvenuto invio della richiesta.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `window.APL.utils` per query DOM, richieste JSON, parsing errori,
 *   toast, loading state e lettura della query string;
 * - interagisce con l’endpoint `/api/auth/password/forgot`;
 * - aggiorna dinamicamente la UI della pagina di recupero password in base
 *   all’esito del flusso.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * Il messaggio informativo di successo è volutamente generico, così da non
 * esporre informazioni sensibili sull’effettiva presenza o meno dell’e-mail
 * nel sistema.
 */

(function () {
  // Estrae dal namespace applicativo le utility condivise usate dalla pagina.
  const { qs, requestJson, parseErrorMessage, toast, setLoading, readQuery } = window.APL.utils;

  // Recupera i principali riferimenti DOM del form di recupero password.
  const form = qs("#forgotForm");
  const emailEl = qs("#email");
  const submitBtn = qs("#submitBtn");
  const errorBox = qs("#errorBox");
  const infoBox = qs("#infoBox");
  const resetLink = qs("#resetLink");

  // Legge i parametri della query string corrente.
  const q = readQuery();

  // Recupera l’eventuale redirect richiesto dal chiamante.
  // In assenza di valore esplicito, usa il login come destinazione predefinita.
  const redirect = (q.get("redirect") || "./login.html").toString();

  // Se presente un link verso la pagina di reset password, propaga il parametro di redirect.
  // In questo modo il flusso successivo può mantenere il contesto di navigazione desiderato.
  if (resetLink && redirect) {
    const u = new URL(resetLink.href, window.location.href);
    u.searchParams.set("redirect", redirect);
    resetLink.href = u.toString();
  }

  // Mostra un messaggio di errore nel contenitore dedicato.
  // Se disponibile, aggiunge anche il Request-ID per facilitare il troubleshooting.
  const showError = (msg, requestId) => {
    const rid = requestId ? ` (Request-ID: ${requestId})` : "";
    errorBox.textContent = `${msg}${rid}`;
    errorBox.classList.remove("hidden");
  };

  // Ripulisce e nasconde sia il box degli errori sia quello informativo.
  const clearBoxes = () => {
    // Ripristina il contenitore degli errori allo stato iniziale.
    errorBox.textContent = "";
    errorBox.classList.add("hidden");

    // Ripristina il contenitore dei messaggi informativi allo stato iniziale.
    infoBox.textContent = "";
    infoBox.classList.add("hidden");
  };

  // Gestisce l’invio del form di recupero password.
  form?.addEventListener("submit", async (e) => {
    // Evita il submit HTML tradizionale per gestire il flusso via JavaScript.
    e.preventDefault();

    // Ripulisce eventuali messaggi mostrati da tentativi precedenti.
    clearBoxes();

    // Recupera e normalizza l’e-mail inserita dall’utente.
    const email = (emailEl.value || "").trim();

    // Verifica minima di presenza del valore richiesto.
    if (!email) {
      showError("Inserisci un indirizzo e-mail valido.");
      return;
    }

    // Mette il pulsante di submit in stato di loading per evitare invii multipli.
    setLoading(submitBtn, true, "Invio in corso...");

    try {
      // Invia la richiesta di recupero password all’endpoint dedicato.
      const res = await requestJson("/api/auth/password/forgot", {
        method: "POST",
        json: { email },
      });

      // Se la risposta API non è positiva, mostra il messaggio di errore restituito.
      if (!res.ok) {
        showError(parseErrorMessage(res.data), res.requestId);
        return;
      }

      // In caso di esito positivo, mostra un messaggio informativo generico
      // per non rivelare dettagli sull’esistenza dell’account nel sistema.
      infoBox.classList.remove("hidden");
      infoBox.textContent =
        "Se l’indirizzo è registrato, riceverai un’e-mail con il link per reimpostare la password. Controlla la tua casella di posta e segui le istruzioni ricevute.";

      // Mostra anche una notifica sintetica di conferma.
      toast("Richiesta inviata.", "success");
    } catch (err) {
      // Gestisce errori di rete o problemi imprevisti nel flusso di recupero password.
      showError(String(err));
    } finally {
      // Ripristina sempre il pulsante allo stato normale.
      setLoading(submitBtn, false);
    }
  });
})();
