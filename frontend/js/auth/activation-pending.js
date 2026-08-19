/**
 * File: frontend/js/auth/activation-pending.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina di attivazione account pendente,
 * personalizzando i contenuti in base ai parametri ricevuti, aggiornando il link
 * di ritorno al login, gestendo il reinvio del link di attivazione e mostrando
 * messaggi informativi o di errore all’utente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica operativa della pagina mostrata dopo una
 * registrazione completata ma non ancora attivata. Si integra con le utility
 * condivise del front-end per governare interazione con il DOM, chiamate HTTP,
 * notifiche utente e stato di loading del pulsante di reinvio.
 *
 * Responsabilità principali
 * -------------------------
 * - leggere i parametri della query string relativi a e-mail, ruolo e redirect;
 * - personalizzare titolo, sottotitolo e collegamento al login;
 * - disabilitare il reinvio quando l’e-mail non è disponibile;
 * - inviare la richiesta di reinvio del link di attivazione all’endpoint dedicato;
 * - mostrare messaggi informativi ed errori in base all’esito della richiesta.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `window.APL.utils` per query DOM, query string, richieste JSON,
 *   parsing errori, toast e loading state;
 * - interagisce con l’endpoint `/api/auth/activation/resend`;
 * - aggiorna dinamicamente la UI della pagina di attivazione pendente.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina è progettata per funzionare anche in assenza di alcuni parametri,
 * degradando in modo controllato il comportamento dell’interfaccia.
 */

(function () {
  // Estrae dal namespace applicativo le utility condivise usate dalla pagina.
  const { qs, readQuery, requestJson, parseErrorMessage, toast, setLoading } = window.APL.utils;

  // Recupera i principali riferimenti DOM usati per personalizzare la UI.
  const titleEl = qs("#activationTitle");
  const subtitleEl = qs("#activationSubtitle");
  const infoBox = qs("#infoBox");
  const errorBox = qs("#errorBox");
  const resendBtn = qs("#resendBtn");
  const loginLink = qs("#loginLink");

  // Legge i parametri della query string corrente.
  const q = readQuery();

  // Recupera l’e-mail da mostrare e da usare per l’eventuale reinvio del link.
  const email = (q.get("email") || "").trim();

  // Recupera l’eventuale ruolo associato all’account in attesa di attivazione.
  const role = (q.get("role") || "").trim();

  // Recupera il redirect di ritorno al login; in assenza di valore esplicito usa il login come fallback.
  const redirect = (q.get("redirect") || "./login.html").trim();

  // Mappa dei ruoli da valore tecnico a etichetta leggibile nel testo della pagina.
  const roleLabelMap = {
    Patient: "paziente",
    Delegate: "delegato",
  };

  // Mostra un messaggio di errore nel contenitore dedicato.
  // Se disponibile, aggiunge anche il Request-ID per facilitare il troubleshooting.
  const showError = (msg, requestId) => {
    const rid = requestId ? ` (Request-ID: ${requestId})` : "";
    errorBox.textContent = `${msg}${rid}`;
    errorBox.classList.remove("hidden");
  };

  // Mostra un messaggio informativo nel contenitore dedicato.
  const showInfo = (msg) => {
    infoBox.textContent = msg;
    infoBox.classList.remove("hidden");
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

  // Applica il contesto iniziale della pagina in base ai parametri presenti nella query string.
  const applyContext = () => {
    // Determina l’etichetta leggibile del ruolo; in fallback usa una descrizione generica.
    const roleLabel = roleLabelMap[role] || "utente";

    // Imposta il titolo principale della sezione operativa.
    if (titleEl) {
      titleEl.textContent = "Attivazione account richiesta";
    }

    // Personalizza il sottotitolo includendo l’e-mail e il ruolo, se disponibili.
    if (subtitleEl) {
      if (email) {
        subtitleEl.textContent = `Abbiamo inviato un link di attivazione all’indirizzo ${email}. Completa la verifica e-mail per attivare il tuo account ${roleLabel}.`;
      } else {
        subtitleEl.textContent = "Controlla la tua e-mail e utilizza il link ricevuto per attivare il tuo account.";
      }
    }

    // Se presente il link al login, propaga il redirect così da mantenere il flusso desiderato.
    if (loginLink && redirect) {
      const url = new URL(loginLink.href, window.location.href);
      url.searchParams.set("redirect", redirect);
      loginLink.href = url.toString();
    }

    // Se l’e-mail non è disponibile, disabilita il pulsante di reinvio perché non sarebbe utilizzabile.
    if (!email && resendBtn) {
      resendBtn.disabled = true;
      resendBtn.classList.add("opacity-70", "cursor-not-allowed");
      resendBtn.title = "Indirizzo e-mail non disponibile per il reinvio.";
    }
  };

  // Gestisce il click sul pulsante di reinvio del link di attivazione.
  resendBtn?.addEventListener("click", async () => {
    // Senza indirizzo e-mail non è possibile avviare il reinvio.
    if (!email) return;

    // Ripulisce eventuali messaggi mostrati da tentativi precedenti.
    clearBoxes();

    // Mette il pulsante in stato di loading per evitare invii multipli.
    setLoading(resendBtn, true, "Invio in corso...");

    try {
      // Invia la richiesta di reinvio all’endpoint dedicato.
      const res = await requestJson("/api/auth/activation/resend", {
        method: "POST",
        json: { email },
      });

      // Se la risposta API non è positiva, mostra il messaggio di errore restituito.
      if (!res.ok) {
        showError(parseErrorMessage(res.data), res.requestId);
        return;
      }

      // In caso di successo, mostra un messaggio informativo nella pagina.
      showInfo("Se l’account non è ancora attivo, riceverai nuovamente un’e-mail con il link di attivazione.");

      // Mostra anche una notifica sintetica di conferma.
      toast("Link di attivazione reinviato.", "success");
    } catch (err) {
      // Gestisce errori di rete o problemi imprevisti nel flusso di reinvio.
      showError(String(err));
    } finally {
      // Ripristina sempre il pulsante allo stato normale.
      setLoading(resendBtn, false);
    }
  });

  // Applica subito il contesto iniziale della pagina al caricamento dello script.
  applyContext();
})();
