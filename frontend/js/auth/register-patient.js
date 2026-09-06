/**
 * File: frontend/js/auth/register-patient.js
 *
 * Scopo
 * -----
 * Gestire il flusso di registrazione self-service del paziente lato client,
 * comprendendo validazione dei campi, trasformazione dei dati nel formato
 * richiesto dalle API, invio della richiesta di registrazione e reindirizzamento
 * verso la pagina di attivazione in attesa di conferma e-mail.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica operativa della pagina di registrazione
 * paziente. Si integra con le utility condivise del front-end per governare
 * interazione con il DOM, chiamate HTTP, visualizzazione degli errori,
 * notifiche di successo e stato di loading del pulsante di submit.
 *
 * Responsabilità principali
 * -------------------------
 * - recuperare i riferimenti agli elementi del form di registrazione;
 * - validare i campi obbligatori e la coerenza dei dati inseriti;
 * - convertire la data di nascita nel formato UTC ISO richiesto dal back-end;
 * - inviare la richiesta di registrazione all’endpoint dedicato;
 * - mostrare messaggi di errore dettagliati, includendo eventuale Request-ID;
 * - notificare il completamento della registrazione;
 * - costruire l’URL della pagina di attivazione pendente e reindirizzare l’utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `window.APL.utils` per query DOM, richieste JSON, parsing errori,
 *   toast, loading state e lettura della query string;
 * - interagisce con l’endpoint `/api/auth/register/patient`;
 * - aggiorna dinamicamente la UI della pagina di registrazione in base all’esito
 *   del flusso.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * Il redirect finale dopo la registrazione non porta direttamente al login,
 * ma alla pagina di attivazione pendente, così da mantenere coerente il flusso
 * di onboarding dell’utente.
 */

(function () {
  // Estrae dal namespace applicativo le utility condivise usate dalla pagina.
  const { qs, requestJson, parseErrorMessage, toast, setLoading, readQuery } = window.APL.utils;

  // Recupera i principali riferimenti DOM del form di registrazione.
  const form = qs("#registerForm");
  const firstNameEl = qs("#firstName");
  const lastNameEl = qs("#lastName");
  const dateOfBirthEl = qs("#dateOfBirth");
  const phoneEl = qs("#phone");
  const addressEl = qs("#address");
  const emailEl = qs("#email");
  const pwdEl = qs("#password");
  const confirmEl = qs("#confirmPassword");
  const submitBtn = qs("#submitBtn");
  const errorBox = qs("#errorBox");

  // Recupera l’eventuale redirect richiesto in query string.
  // In assenza di valore esplicito, usa la home pubblica come fallback.
  const redirect = (readQuery().get("redirect") || "../../index.html").toString();

  // Mostra un messaggio di errore nel contenitore dedicato.
  // Se disponibile, aggiunge anche il Request-ID per facilitare il troubleshooting.
  const showError = (msg, requestId) => {
    const rid = requestId ? ` (Request-ID: ${requestId})` : "";
    errorBox.textContent = `${msg}${rid}`;
    errorBox.classList.remove("hidden");
  };

  // Ripulisce e nasconde il contenitore degli errori.
  const clearError = () => {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  };

  // Verifica la validità sintattica minima di un indirizzo e-mail.
  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

  // Converte una data nel formato input `YYYY-MM-DD` in una stringa UTC ISO.
  const dateInputToUtcIso = (dateStr) => {
    // Ripulisce il valore ricevuto.
    const s = String(dateStr || "").trim();

    // Verifica il formato atteso dell’input date.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";

    // Estrae anno, mese e giorno come numeri.
    const [y, m, d] = s.split("-").map((x) => Number(x));

    // Costruisce una data UTC all’inizio del giorno.
    const dt = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));

    // Restituisce la serializzazione ISO.
    return dt.toISOString();
  };

  // Costruisce l’URL della pagina di attivazione pendente,
  // propagando i parametri utili al prosieguo del flusso.
  const buildPendingActivationUrl = (payload, redirectValue) => {
    // Costruisce l’URL relativo alla pagina di attivazione pendente.
    const url = new URL("./activation-pending.html", window.location.href);

    // Se l’API restituisce l’e-mail, la propaga in query string.
    if (payload?.email) {
      url.searchParams.set("email", payload.email);
    }

    // Se l’API restituisce il ruolo, lo propaga in query string.
    if (payload?.role) {
      url.searchParams.set("role", payload.role);
    }

    // Propaga anche l’eventuale redirect originale, se presente.
    if (redirectValue) {
      url.searchParams.set("redirect", redirectValue);
    }

    return url.toString();
  };

  // Gestisce l’invio del form di registrazione paziente.
  form?.addEventListener("submit", async (e) => {
    // Evita il submit HTML tradizionale per gestire il flusso via JavaScript.
    e.preventDefault();

    // Ripulisce eventuali errori mostrati da tentativi precedenti.
    clearError();

    // Recupera e normalizza i valori inseriti nel form.
    const firstName = (firstNameEl?.value || "").trim();
    const lastName = (lastNameEl?.value || "").trim();
    const dateOfBirth = (dateOfBirthEl?.value || "").trim();
    const phone = (phoneEl?.value || "").trim();
    const address = (addressEl?.value || "").trim();
    const email = (emailEl?.value || "").trim();
    const password = (pwdEl?.value || "").trim();
    const confirm = (confirmEl?.value || "").trim();

    // Verifica la presenza di tutti i campi obbligatori.
    if (!firstName || !lastName || !dateOfBirth || !email || !password || !confirm) {
      showError("Compila tutti i campi obbligatori.");
      return;
    }

    // Verifica la validità sintattica dell’indirizzo e-mail.
    if (!isValidEmail(email)) {
      showError("Inserisci un indirizzo e-mail valido.");
      return;
    }

    // Verifica la lunghezza minima della password.
    if (password.length < 8) {
      showError("La password deve contenere almeno 8 caratteri.");
      return;
    }

    // Verifica che password e conferma coincidano.
    if (password !== confirm) {
      showError("Le password non coincidono.");
      return;
    }

    // Converte la data di nascita nel formato UTC ISO richiesto dal back-end.
    const dateOfBirthUtc = dateInputToUtcIso(dateOfBirth);
    if (!dateOfBirthUtc) {
      showError("La data di nascita non è valida.");
      return;
    }

    // Mette il pulsante di submit in stato di loading per evitare invii multipli.
    setLoading(submitBtn, true, "Creazione in corso...");

    try {
      // Invia la richiesta di registrazione all’endpoint dedicato.
      const res = await requestJson("/api/auth/register/patient", {
        method: "POST",
        json: {
          email,
          password,
          firstName,
          lastName,
          dateOfBirthUtc,
          phone: phone || null,
          address: address || null,
        },
      });

      // Se la risposta API non è positiva, mostra il messaggio di errore restituito.
      if (!res.ok) {
        showError(parseErrorMessage(res.data), res.requestId);
        return;
      }

      // In caso di successo, mostra una notifica di completamento.
      toast("Registrazione completata. Controlla la tua e-mail per attivare l’account.", "success");

      // Costruisce la destinazione finale verso la pagina di attivazione pendente.
      const nextUrl = buildPendingActivationUrl(res.data, redirect);

      // Ritarda leggermente il redirect per consentire la percezione del feedback visivo.
      setTimeout(() => {
        window.location.assign(nextUrl);
      }, 700);
    } catch (err) {
      // Gestisce errori di rete o problemi imprevisti nel flusso di registrazione.
      showError(String(err));
    } finally {
      // Ripristina sempre il pulsante allo stato normale.
      setLoading(submitBtn, false);
    }
  });
})();
