/**
 * File: frontend/js/common/utils.js
 *
 * Scopo
 * -----
 * Centralizzare un insieme di utility condivise del front-end, comprendenti
 * helper per il DOM, gestione di date e orari nel fuso Europe/Rome, normalizzazione
 * dei payload API, supporto alla UX tramite loading state e toast, interpretazione
 * degli errori applicativi e wrapper semplificato per richieste JSON.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file costituisce uno dei moduli trasversali più importanti del front-end:
 * espone nel namespace globale `window.APL.utils` funzioni riutilizzabili da più
 * pagine e componenti, riducendo duplicazioni e uniformando il comportamento
 * dell’interfaccia nei punti più sensibili del progetto.
 *
 * Responsabilità principali
 * -------------------------
 * - definire costanti condivise di localizzazione e parsing temporale;
 * - fornire utility di supporto per query DOM e lettura della query string;
 * - normalizzare date e orari provenienti dalle API;
 * - convertire date/orari locali di Roma in istanti UTC ISO;
 * - fornire helper per range temporali, giorno corrente e chiavi giornaliere;
 * - gestire stati di loading dei pulsanti e notifiche toast;
 * - interpretare payload di errore eterogenei in forma leggibile;
 * - uniformare il comportamento di `Date.prototype.toLocale*` per il contesto italiano;
 * - offrire un wrapper comune per richieste HTTP JSON tramite `fetch`.
 *
 * Interazioni principali
 * ----------------------
 * - estende il namespace globale `window.APL.utils`;
 * - interagisce con il DOM per toast, query selector e stato dei pulsanti;
 * - utilizza `Intl.DateTimeFormat` per la gestione robusta del fuso orario di Roma;
 * - utilizza `fetch` per effettuare richieste HTTP verso gli endpoint applicativi;
 * - viene richiamato da più pagine e script del front-end come libreria condivisa.
 *
 * Note
 * ----
 * Il file adotta una IIFE per evitare l’inquinamento del global scope, lasciando
 * esposto solo il namespace applicativo controllato. Alcune utility relative a date
 * e orari sono particolarmente importanti perché il progetto opera con logiche
 * temporali che devono rimanere coerenti rispetto al fuso Europe/Rome.
 */

(function () {
  // Recupera o inizializza il namespace applicativo globale.
  const APL = (window.APL = window.APL || {});

  // Recupera o inizializza il sotto-namespace dedicato alle utility comuni.
  const utils = (APL.utils = APL.utils || {});

  // Costanti di localizzazione e pattern di parsing usati trasversalmente nel modulo.
  const DEFAULT_LOCALE = "it-IT";
  const DEFAULT_TIME_ZONE = "Europe/Rome";
  const DATE_INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_INPUT_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
  const ISO_WITHOUT_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?$/;
  const PLAIN_OBJECT_TAG = "[object Object]";

  // Restituisce una stringa a due cifre.
  // È utile per comporre valori di data e orario in formato stabile.
  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  // Verifica se il valore ricevuto è un plain object.
  // Serve a distinguere gli oggetti “semplici” da array, date o altri tipi speciali.
  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === PLAIN_OBJECT_TAG;
  }

  // Normalizza una stringa temporale proveniente dall’API.
  // Se la stringa è in formato ISO ma senza timezone esplicito, aggiunge `Z`
  // per forzarne l’interpretazione come istante UTC.
  function normalizeApiTemporalString(value) {
    const s = String(value || "").trim();
    if (!s) return value;
    if (!ISO_WITHOUT_TZ_RE.test(s)) return value;
    return `${s}Z`;
  }

  // Applica ricorsivamente la normalizzazione temporale a strutture JSON annidate.
  // Gestisce array, stringhe e oggetti semplici, lasciando invariati gli altri valori.
  function normalizeApiTemporalValue(value) {
    // Se il valore è un array, normalizza ogni elemento ricorsivamente.
    if (Array.isArray(value)) return value.map(normalizeApiTemporalValue);

    // Se il valore è una stringa, prova a normalizzarlo come valore temporale API.
    if (typeof value === "string") return normalizeApiTemporalString(value);

    // Se non è un plain object, non richiede elaborazione ulteriore.
    if (!isPlainObject(value)) return value;

    // Se è un oggetto semplice, crea una copia normalizzando ricorsivamente ogni proprietà.
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = normalizeApiTemporalValue(child);
    }
    return out;
  }

  // Formatter dedicato all’estrazione controllata delle parti data/ora
  // nel fuso Europe/Rome.
  const zonedPartsFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // Converte un istante in un oggetto contenente anno, mese, giorno, ora,
  // minuti e secondi riferiti esplicitamente al fuso di Roma.
  function getZonedPartsFromInstant(dateLike) {
    // Converte l’input in oggetto Date se necessario.
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);

    // Se la data non è valida, restituisce null.
    if (!Number.isFinite(d.getTime())) return null;

    // Estrae le parti formattate e le riversa in una mappa chiave/valore.
    const map = {};
    for (const part of zonedPartsFormatter.formatToParts(d)) {
      if (part.type !== "literal") map[part.type] = part.value;
    }

    // Converte le parti estratte in numeri e le restituisce in forma strutturata.
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
    };
  }

  // Effettua il parsing di una data nel formato `YYYY-MM-DD`.
  // Restituisce le componenti numeriche oppure null in caso di input non valido.
  function parseDateInputValue(value) {
    // Esegue il match sul formato atteso.
    const m = String(value || "").trim().match(DATE_INPUT_RE);
    if (!m) return null;

    // Converte le tre componenti in numeri.
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);

    // Valida che i valori estratti siano numerici e in range plausibile.
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    return { year, month, day };
  }

  // Effettua il parsing di un orario nel formato `HH:mm` oppure `HH:mm:ss`.
  // Restituisce le componenti numeriche oppure null se il valore non è valido.
  function parseTimeInputValue(value) {
    // Esegue il match sul formato atteso.
    const m = String(value || "").trim().match(TIME_INPUT_RE);
    if (!m) return null;

    // Converte ora, minuti e secondi in numeri.
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    const second = m[3] ? Number(m[3]) : 0;

    // Verifica che i valori siano numerici e compresi nei limiti corretti.
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;

    return { hour, minute, second };
  }

  // Converte componenti locali riferite a Europe/Rome nel corrispondente `Date` UTC.
  // Il calcolo usa un raffinamento iterativo per ottenere l’istante corretto
  // anche in presenza di offset e regole di timezone.
  function zonedLocalPartsToUtcDate(parts) {
    // Costruisce una prima stima UTC usando direttamente le parti fornite.
    let guessUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour || 0,
      parts.minute || 0,
      parts.second || 0,
      parts.millisecond || 0
    );

    // Raffina la stima confrontando il valore rappresentato nel fuso target
    // con il valore locale desiderato.
    for (let i = 0; i < 4; i++) {
      const represented = getZonedPartsFromInstant(guessUtcMs);
      if (!represented) break;

      // Traduce l’istante rappresentato in millisecondi UTC “comparabili”.
      const representedAsUtcMs = Date.UTC(
        represented.year,
        represented.month - 1,
        represented.day,
        represented.hour,
        represented.minute,
        represented.second,
        parts.millisecond || 0
      );

      // Traduce anche il target locale desiderato in millisecondi UTC “comparabili”.
      const targetAsUtcMs = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour || 0,
        parts.minute || 0,
        parts.second || 0,
        parts.millisecond || 0
      );

      // Calcola lo scarto tra target desiderato e valore attualmente rappresentato.
      const diff = targetAsUtcMs - representedAsUtcMs;
      if (!diff) break;

      // Corregge la stima corrente con lo scarto rilevato.
      guessUtcMs += diff;
    }

    return new Date(guessUtcMs);
  }

  // Espone le costanti di localizzazione nel namespace condiviso.
  utils.DEFAULT_LOCALE = DEFAULT_LOCALE;
  utils.DEFAULT_TIME_ZONE = DEFAULT_TIME_ZONE;

  // Espone helper sintetici per query DOM e lettura della query string corrente.
  utils.qs = (sel, root = document) => root.querySelector(sel);
  utils.qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  utils.readQuery = () => new URLSearchParams(window.location.search);

  // Espone le utility di normalizzazione e parsing temporale.
  utils.normalizeApiTemporalString = normalizeApiTemporalString;
  utils.normalizeApiTemporalValue = normalizeApiTemporalValue;
  utils.parseDateInputValue = parseDateInputValue;
  utils.parseTimeInputValue = parseTimeInputValue;

  // Effettua il parsing robusto di una data proveniente dall’API.
  // Prima normalizza l’eventuale assenza del timezone, poi costruisce un oggetto Date valido.
  utils.parseApiDate = (value) => {
    if (!value) return null;
    const normalized = normalizeApiTemporalString(value);
    const d = new Date(normalized);
    return Number.isFinite(d.getTime()) ? d : null;
  };

  // Converte un istante in una stringa `YYYY-MM-DD` coerente con il fuso di Roma.
  utils.toRomeDateInputValue = (dateLike) => {
    // Estrae le parti temporali nel fuso target.
    const parts = getZonedPartsFromInstant(dateLike || new Date());
    if (!parts) return "";

    // Ricompone la data nel formato richiesto dagli input HTML.
    return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  };

  // Restituisce la data odierna nel formato input date, riferita a Europe/Rome.
  utils.romeTodayDateInputValue = () => utils.toRomeDateInputValue(new Date());

  // Aggiunge un numero di giorni a una data nel formato input.
  // Restituisce la nuova data nel medesimo formato `YYYY-MM-DD`.
  utils.addDaysToDateInput = (dateStr, days) => {
    // Esegue il parsing della data di partenza.
    const parts = parseDateInputValue(dateStr);
    if (!parts) return "";

    // Crea una data UTC appoggiandosi a un orario centrale per ridurre ambiguità temporali.
    const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0), 12, 0, 0, 0));

    // Restituisce la data risultante nel formato richiesto.
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  };

  // Restituisce il giorno della settimana corrispondente alla data fornita.
  utils.weekdayFromDateInput = (dateStr) => {
    // Esegue il parsing della data.
    const parts = parseDateInputValue(dateStr);
    if (!parts) return null;

    // Calcola il giorno della settimana appoggiandosi a una data UTC stabile.
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0)).getUTCDay();
  };

  // Converte una coppia data/orario locali di Roma nel corrispondente timestamp UTC ISO.
  utils.romeDateTimeToUtcIso = (dateStr, timeStr, options = {}) => {
    // Esegue il parsing separato di data e ora.
    const dateParts = parseDateInputValue(dateStr);
    const timeParts = parseTimeInputValue(timeStr);
    if (!dateParts || !timeParts) return "";

    // Compone le parti e calcola il corrispondente istante UTC.
    const d = zonedLocalPartsToUtcDate({
      ...dateParts,
      ...timeParts,
      millisecond: Number(options.millisecond || 0),
    });

    // Restituisce il timestamp ISO se valido.
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  };

  // Converte un intervallo di date locali in un intervallo UTC completo.
  // L’estremo iniziale parte dall’inizio del giorno, quello finale arriva alla fine del giorno.
  utils.romeDateRangeToUtc = (fromDateStr, toDateStr) => {
    // Esegue il parsing delle due date estreme.
    const from = parseDateInputValue(fromDateStr);
    const to = parseDateInputValue(toDateStr);
    if (!from || !to) return null;

    // Costruisce l’istante UTC corrispondente all’inizio del giorno iniziale.
    const fromUtc = zonedLocalPartsToUtcDate({
      ...from,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    }).toISOString();

    // Costruisce l’istante UTC corrispondente alla fine del giorno finale.
    const toUtc = zonedLocalPartsToUtcDate({
      ...to,
      hour: 23,
      minute: 59,
      second: 59,
      millisecond: 999,
    }).toISOString();

    return { fromUtc, toUtc };
  };

  // Restituisce una chiave giornaliera coerente con il fuso di Roma
  // a partire da un valore ISO proveniente dall’API.
  utils.romeDayKeyFromIso = (isoValue) => {
    // Esegue il parsing robusto del valore ISO.
    const d = utils.parseApiDate(isoValue);
    if (!d) return "";

    // Converte la data nell’equivalente stringa `YYYY-MM-DD`.
    return utils.toRomeDateInputValue(d);
  };

  // Gestisce lo stato di loading di un pulsante.
  // Disabilita il controllo, aggiorna la label e memorizza il testo precedente per il ripristino.
  utils.setLoading = (btn, loading, loadingLabel = "Attendere...") => {
    if (!btn) return;

    if (loading) {
      // Salva la label precedente e porta il pulsante in stato di attesa.
      btn.dataset.prevLabel = btn.textContent;
      btn.disabled = true;
      btn.classList.add("opacity-80", "cursor-not-allowed");
      btn.textContent = loadingLabel;
    } else {
      // Ripristina lo stato normale del pulsante e la label precedente.
      btn.disabled = false;
      btn.classList.remove("opacity-80", "cursor-not-allowed");
      btn.textContent = btn.dataset.prevLabel || btn.textContent;
      delete btn.dataset.prevLabel;
    }
  };

  // Garantisce l’esistenza del contenitore DOM destinato ai toast.
  // Se non presente, lo crea e lo inserisce nel body.
  utils.ensureToastHost = () => {
    let host = document.getElementById("toastHost");

    if (!host) {
      // Crea dinamicamente il contenitore che ospiterà le notifiche temporanee.
      host = document.createElement("div");
      host.id = "toastHost";
      host.className =
        "fixed top-4 right-4 z-50 flex flex-col gap-2 w-[min(92vw,360px)]";
      document.body.appendChild(host);
    }

    return host;
  };

  // Mostra una notifica toast con stile coerente in base al tipo di messaggio.
  utils.toast = (message, kind = "info") => {
    // Recupera o crea il contenitore dei toast.
    const host = utils.ensureToastHost();

    // Determina il colore di sfondo in base alla tipologia del messaggio.
    const bg =
      kind === "success"
        ? "bg-blue-600"
        : kind === "error"
          ? "bg-red-600"
          : "bg-slate-900";

    // Crea l’elemento DOM del toast.
    const el = document.createElement("div");
    el.className =
      `${bg} text-white rounded-xl shadow-lg px-4 py-3 text-sm leading-snug ` +
      "animate-[fadeIn_150ms_ease-out]";
    el.textContent = message;

    // Inserisce il toast nel contenitore.
    host.appendChild(el);

    // Dopo un intervallo predefinito, avvia la dissolvenza e poi rimuove l’elemento.
    setTimeout(() => {
      el.classList.add("opacity-0");
      el.classList.add("transition-opacity");
      el.classList.add("duration-200");
      setTimeout(() => el.remove(), 220);
    }, 3200);
  };

  // Interpreta un payload di errore eterogeneo e restituisce un messaggio leggibile.
  utils.parseErrorMessage = (payload) => {
    // Gestisce il caso di payload assente.
    if (!payload) return "Errore imprevisto.";

    // Se il payload è già una stringa, la restituisce direttamente.
    if (typeof payload === "string") return payload;

    // Gestisce il caso tipico di payload con campo `message`.
    if (payload.message) return String(payload.message);

    // Gestisce la struttura tipica di validation problem con `title` ed `errors`.
    if (payload.title && payload.errors && typeof payload.errors === "object") {
      const parts = [];

      // Appiattisce tutti i messaggi di errore presenti nei vari campi.
      for (const k of Object.keys(payload.errors)) {
        const arr = payload.errors[k];
        if (Array.isArray(arr)) {
          for (const msg of arr) parts.push(String(msg));
        }
      }

      return parts.length ? parts.join(" ") : String(payload.title);
    }

    // Gestisce forme alternative comunemente usate dagli endpoint.
    if (payload.detail) return String(payload.detail);
    if (payload.code && payload.message) return String(payload.message);

    // Come fallback finale, prova a serializzare il payload intero.
    try {
      return JSON.stringify(payload);
    } catch {
      return "Errore imprevisto.";
    }
  };

  // Converte diversi tipi di errore JavaScript / HTTP / applicativi
  // in una descrizione sintetica e leggibile per l’interfaccia.
  utils.humanizeError = (err) => {
    // Gestisce il caso di errore assente.
    if (!err) return "Errore imprevisto.";

    // Se l’errore è già una stringa, la restituisce direttamente.
    if (typeof err === "string") return err;

    // Se è un oggetto Error nativo, usa il messaggio incorporato.
    if (err instanceof Error) return err.message || "Errore imprevisto.";

    // Se è un oggetto generico, prova a ricavare una descrizione utile.
    if (typeof err === "object") {
      if (err.message) return String(err.message);
      if (err.data) return utils.parseErrorMessage(err.data);
      if (err.status) return `Errore HTTP ${err.status}.`;
    }

    // Come fallback finale, prova a serializzare l’oggetto intero.
    try {
      return JSON.stringify(err);
    } catch {
      return "Errore imprevisto.";
    }
  };

  // Salva i riferimenti ai metodi nativi di localizzazione di Date
  // prima di introdurre il comportamento coerente con il fuso Europe/Rome.
  const nativeToLocaleString = Date.prototype.toLocaleString;
  const nativeToLocaleDateString = Date.prototype.toLocaleDateString;
  const nativeToLocaleTimeString = Date.prototype.toLocaleTimeString;

  // Stabilisce se è opportuno iniettare automaticamente il timezone di Roma.
  // L’iniezione avviene solo quando non è già specificato un timezone esplicito
  // e quando il contesto locale è assente oppure italiano.
  function shouldInjectRomeTimeZone(locale, options) {
    // Se il chiamante ha già fornito un timezone, non va alterato il comportamento.
    if (options && options.timeZone) return false;

    // Se il locale non è specificato, si applica il comportamento di default del progetto.
    if (locale == null) return true;

    // Se il locale è un array, considera il primo valore; altrimenti usa direttamente la stringa.
    const first = Array.isArray(locale) ? locale[0] : locale;

    // Applica il timezone di Roma solo nel contesto del locale di default italiano.
    return String(first || "").toLowerCase() === DEFAULT_LOCALE.toLowerCase();
  }

  // Sovrascrive `toLocaleString` per garantire coerenza temporale
  // in assenza di un timezone esplicito.
  Date.prototype.toLocaleString = function (locale, options) {
    // Se non è necessario forzare il timezone di Roma, delega al comportamento nativo.
    if (!shouldInjectRomeTimeZone(locale, options)) {
      return nativeToLocaleString.call(this, locale, options);
    }

    // In caso contrario, usa il locale di default e inietta il timezone di progetto.
    return nativeToLocaleString.call(this, locale || DEFAULT_LOCALE, {
      ...(options || {}),
      timeZone: DEFAULT_TIME_ZONE,
    });
  };

  // Sovrascrive `toLocaleDateString` per uniformare la resa delle date
  // nel contesto italiano del progetto.
  Date.prototype.toLocaleDateString = function (locale, options) {
    // Mantiene il comportamento nativo se il timezone non deve essere forzato.
    if (!shouldInjectRomeTimeZone(locale, options)) {
      return nativeToLocaleDateString.call(this, locale, options);
    }

    // Applica il timezone di Roma quando opportuno.
    return nativeToLocaleDateString.call(this, locale || DEFAULT_LOCALE, {
      ...(options || {}),
      timeZone: DEFAULT_TIME_ZONE,
    });
  };

  // Sovrascrive `toLocaleTimeString` per evitare discrepanze di orario
  // tra browser e logica temporale del progetto.
  Date.prototype.toLocaleTimeString = function (locale, options) {
    // Mantiene il comportamento nativo se il timezone non deve essere forzato.
    if (!shouldInjectRomeTimeZone(locale, options)) {
      return nativeToLocaleTimeString.call(this, locale, options);
    }

    // Applica il timezone di Roma quando opportuno.
    return nativeToLocaleTimeString.call(this, locale || DEFAULT_LOCALE, {
      ...(options || {}),
      timeZone: DEFAULT_TIME_ZONE,
    });
  };

  // Wrapper condiviso per richieste JSON.
  // Uniforma header, serializzazione del body, parsing della risposta
  // e acquisizione dell’eventuale request ID esposto dal back-end.
  utils.requestJson = async (url, options = {}) => {
    // Crea una copia locale delle opzioni per evitare effetti collaterali sull’oggetto originale.
    const init = { ...options };

    // Garantisce che la richiesta dichiari la preferenza per una risposta JSON.
    init.headers = { ...(options.headers || {}), Accept: "application/json" };

    // Se il chiamante ha passato un payload `json`, lo serializza nel body
    // e imposta l’header Content-Type appropriato.
    if (options.json !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.json);
      delete init.json;
    }

    // Esegue la richiesta HTTP.
    const res = await fetch(url, init);

    // Recupera un eventuale request ID esposto dal gateway o dal back-end.
    const requestId =
      res.headers.get("X-Request-ID") ||
      res.headers.get("x-request-id") ||
      "";

    // Legge il corpo della risposta come testo per poter gestire sia JSON sia fallback testuali.
    const text = await res.text();
    let data = null;

    // Se la risposta contiene testo, prova prima a interpretarlo come JSON.
    if (text) {
      try {
        data = normalizeApiTemporalValue(JSON.parse(text));
      } catch {
        data = text;
      }
    }

    // Restituisce un oggetto uniforme contenente esito HTTP, status, payload e request ID.
    return { ok: res.ok, status: res.status, data, requestId };
  };
})();
