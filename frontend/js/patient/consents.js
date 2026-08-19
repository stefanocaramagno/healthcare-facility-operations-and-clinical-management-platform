/**
 * File: frontend/js/patient/consents.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina consensi dell’area
 * Patient, comprendendo il caricamento dei consensi registrati, la
 * sincronizzazione dello stato dell’interfaccia, la rilevazione di
 * modifiche non salvate, la validazione dei dati inseriti e il
 * salvataggio delle preferenze aggiornate.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script rappresenta il controller front-end della vista
 * `consents.html`. Coordina l’interazione tra interfaccia utente,
 * servizi API dell’area profilo/registry e componenti condivisi
 * dell’applicazione, traducendo i consensi restituiti dal backend in una
 * UI modificabile e consentendo al paziente di aggiornare le proprie
 * preferenze in modo esplicito e tracciabile.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare l’accesso alla pagina per il ruolo Patient;
 * - recuperare i dati sintetici dell’utente autenticato;
 * - recuperare i consensi registrati lato backend;
 * - normalizzare i dati ricevuti e sincronizzarli con la UI;
 * - aggiornare pill, metadati, contatori e banner derivati;
 * - rilevare la presenza di modifiche locali non ancora salvate;
 * - evidenziare l’assenza di consensi essenziali;
 * - validare il contenuto delle note prima del salvataggio;
 * - inviare al backend le nuove preferenze di consenso;
 * - gestire loading, errori globali e feedback all’utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth(EXPECTED_ROLE)` per il controllo di accesso;
 * - utilizza `APL.session.authHeader()` per autenticare le richieste HTTP;
 * - utilizza `APL.session.clearAuth()` nei casi di sessione scaduta;
 * - utilizza `APL.utils.requestJson()` come base per le chiamate API;
 * - utilizza `APL.utils.parseErrorMessage()` e `APL.utils.humanizeError()`
 *   per normalizzare i messaggi di errore;
 * - utilizza `APL.utils.setLoading()` per aggiornare lo stato visuale del pulsante salva;
 * - utilizza `APL.utils.toast()` per il feedback all’utente;
 * - utilizza `APL.utils.parseApiDate()` per la formattazione delle date;
 * - interagisce con gli endpoint:
 *   - `/api/me`
 *   - `/api/registry/patients/me/consents`
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare la diffusione di simboli nel
 * global scope. Lo stato locale mantiene sia i DTO caricati dal backend sia
 * un modello sintetico dei consensi utile per confrontare l’interfaccia
 * corrente con lo stato persistito e rilevare modifiche non salvate.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Patient";

  // Endpoint per il recupero del profilo sintetico dell’utente autenticato.
  const API_ME = "/api/me";

  // Endpoint per il recupero e il salvataggio dei consensi del paziente autenticato.
  const API_CONSENTS = "/api/registry/patients/me/consents";

  // Definizione centralizzata dei consensi gestiti nella pagina.
  // Per ciascun consenso vengono specificati tipo logico, carattere essenziale/facoltativo,
  // label utente e riferimenti agli elementi DOM collegati.
  const CONSENT_DEFS = [
    {
      type: "Treatment",
      required: true,
      label: "Consenso al trattamento sanitario",
      ids: {
        granted: "treatmentGranted",
        notes: "treatmentNotes",
        count: "treatmentNotesCount",
        pill: "treatmentStatusPill",
        meta: "treatmentMeta",
      },
    },
    {
      type: "DataProcessing",
      required: true,
      label: "Consenso al trattamento dei dati",
      ids: {
        granted: "dataProcessingGranted",
        notes: "dataProcessingNotes",
        count: "dataProcessingNotesCount",
        pill: "dataProcessingStatusPill",
        meta: "dataProcessingMeta",
      },
    },
    {
      type: "Marketing",
      required: false,
      label: "Consenso a comunicazioni informative",
      ids: {
        granted: "marketingGranted",
        notes: "marketingNotes",
        count: "marketingNotesCount",
        pill: "marketingStatusPill",
        meta: "marketingMeta",
      },
    },
  ];

  // Lunghezza massima ammessa per i campi note associati ai consensi.
  const MAX_NOTES_LEN = 255;

  // Utility sintetica per recuperare un elemento del DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel box globale della pagina.
  function showError(message) {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");

    // In assenza del nodo DOM non è possibile mostrare il messaggio.
    if (!box) return;

    // Scrive il testo di errore usando un fallback di sicurezza.
    box.textContent = message || "Errore imprevisto.";

    // Rende visibile il contenitore.
    box.classList.remove("hidden");
  }

  // Ripristina lo stato normale della pagina nascondendo l’eventuale errore globale.
  function clearError() {
    // Recupera il contenitore predisposto per gli errori globali.
    const box = $("pageError");

    // Se il box non esiste non c’è nulla da resettare.
    if (!box) return;

    // Pulisce il testo precedentemente mostrato.
    box.textContent = "";

    // Nasconde nuovamente il contenitore.
    box.classList.add("hidden");
  }

  // Aggiorna lo stato di caricamento della vista.
  // Oltre al badge, blocca temporaneamente i controlli di editing per evitare modifiche concorrenti.
  function setLoading(loading) {
    // Mostra o nasconde il badge globale di caricamento della pagina.
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Aggiorna il pulsante di salvataggio con lo stato visuale condiviso.
    const btnSave = $("btnSave");
    if (btnSave) APL.utils.setLoading(btnSave, loading, "Salvataggio…");

    // Disabilita il pulsante di ripristino durante il loading.
    const btnReset = $("btnReset");
    if (btnReset) btnReset.disabled = !!loading;

    // Disabilita checkbox e textarea di tutti i consensi finché l’operazione non termina.
    for (const d of CONSENT_DEFS) {
      const g = $(d.ids.granted);
      const n = $(d.ids.notes);
      if (g) g.disabled = !!loading;
      if (n) n.disabled = !!loading;
    }
  }

  // Formatta una data API in rappresentazione estesa per metadati e dettagli temporali.
  function fmtDateTime(isoUtc) {
    // In assenza del dato, restituisce il placeholder standard di pagina.
    if (!isoUtc) return "—";

    // Prova a convertire il valore API in oggetto Date tramite utility condivisa.
    const d = APL.utils.parseApiDate(isoUtc);

    // Se il parsing fallisce mantiene il placeholder.
    if (!d) return "—";

    // Restituisce data e ora in formato italiano.
    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Normalizza il payload di un consenso per gestire differenze di naming
  // tra proprietà camelCase e PascalCase provenienti dal backend.
  function normalizeConsent(x) {
    return {
      id: x?.id ?? x?.Id ?? "",
      patientUserId: x?.patientUserId ?? x?.PatientUserId ?? "",
      type: x?.type ?? x?.Type ?? "",
      granted: Boolean(x?.granted ?? x?.Granted ?? false),
      grantedAtUtc: x?.grantedAtUtc ?? x?.GrantedAtUtc ?? "",
      revokedAtUtc: x?.revokedAtUtc ?? x?.RevokedAtUtc ?? null,
      notes: x?.notes ?? x?.Notes ?? null,
      createdAtUtc: x?.createdAtUtc ?? x?.CreatedAtUtc ?? "",
    };
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione uniforme
  // di sessione scaduta, accesso negato ed errori applicativi.
  async function apiJson(method, url, json) {
    // Invia la richiesta HTTP JSON includendo l’header di autenticazione utente.
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Se la risposta non è positiva, viene applicata una gestione errori coerente.
    if (!res.ok) {
      // Sessione non più valida: pulizia locale e redirect alla schermata dedicata.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Accesso vietato: redirect alla schermata di forbidden se disponibile.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Per tutti gli altri casi costruisce un oggetto Error arricchito
      // con metadati utili per logging e gestione a livello superiore.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    // In caso di successo restituisce direttamente il payload deserializzato.
    return res.data;
  }

  // Aggiorna il riepilogo utente mostrato in testa alla pagina.
  function setUserSummary(me) {
    // Popola l’email del paziente autenticato se disponibile.
    if ($("emailText")) $("emailText").textContent = me?.email ? String(me.email) : "—";

    // Popola l’identificativo utente se disponibile.
    if ($("userIdText")) $("userIdText").textContent = me?.id ? String(me.id) : "—";
  }

  // Aggiorna il contatore caratteri associato alle note di uno specifico consenso.
  function setNotesCount(def) {
    // Recupera textarea e contenitore del contatore per il consenso indicato.
    const el = $(def.ids.notes);
    const out = $(def.ids.count);

    // Se uno dei due elementi manca non è possibile aggiornare il contatore.
    if (!el || !out) return;

    // Calcola la lunghezza del contenuto corrente della textarea.
    const len = String(el.value || "").length;

    // Mostra il rapporto tra lunghezza attuale e limite massimo consentito.
    out.textContent = `${len}/${MAX_NOTES_LEN}`;
  }

  // Aggiorna la pill visuale che rappresenta lo stato del consenso.
  function setPill(def, granted, hasRecord) {
    // Recupera il nodo DOM della pill associata al consenso.
    const pill = $(def.ids.pill);
    if (!pill) return;

    // Imposta valori di default.
    let label = "—";
    let cls = "bg-slate-100 text-slate-700";

    // Se il consenso non è mai stato registrato, mostra stato neutro.
    if (!hasRecord) {
      label = "Non espresso";
      cls = "bg-slate-100 text-slate-700";
    } else if (granted) {
      // Consenso attualmente concesso.
      label = "Concesso";
      cls = "bg-emerald-50 text-emerald-700";
    } else {
      // Consenso esplicitamente revocato.
      label = "Revocato";
      cls = "bg-blue-50 text-blue-700";
    }

    // Aggiorna classi e contenuto testuale della pill.
    pill.className = `inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}`;
    pill.textContent = label;
  }

  // Aggiorna il testo descrittivo dei metadati temporali per uno specifico consenso.
  function setMeta(def, dto) {
    // Recupera il nodo DOM dedicato ai metadati del consenso.
    const el = $(def.ids.meta);
    if (!el) return;

    // Se non esiste alcun record persistito, espone uno stato iniziale.
    if (!dto) {
      el.textContent = "Non ancora registrato.";
      return;
    }

    // Se il consenso è concesso, mostra la data di concessione.
    if (dto.granted) {
      el.textContent = `Concesso il ${fmtDateTime(dto.grantedAtUtc)}.`;
      return;
    }

    // Se il consenso è revocato e il backend espone la data di revoca, la usa esplicitamente.
    if (dto.revokedAtUtc) {
      el.textContent = `Revocato il ${fmtDateTime(dto.revokedAtUtc)}.`;
      return;
    }

    // Fallback per record non concessi ma privi di revokedAt esplicito.
    el.textContent = `Aggiornato il ${fmtDateTime(dto.grantedAtUtc)}.`;
  }

  // Popola l’interfaccia a partire dal modello sintetico dei consensi.
  function fillUiFromModel(model) {
    // Itera su tutte le definizioni note per sincronizzare checkbox e note.
    for (const def of CONSENT_DEFS) {
      const m = model[def.type] || { granted: false, notes: "" };
      const g = $(def.ids.granted);
      const n = $(def.ids.notes);

      // Aggiorna lo stato della checkbox.
      if (g) g.checked = !!m.granted;

      // Aggiorna il contenuto della textarea note.
      if (n) n.value = m.notes || "";

      // Riallinea il contatore dei caratteri per la textarea corrente.
      setNotesCount(def);
    }

    // Dopo la sincronizzazione ricalcola banner e stato derivato.
    updateComputedBanners();
  }

  // Legge lo stato corrente dell’interfaccia e lo converte in un modello sintetico.
  function readUiModel() {
    const model = {};

    // Per ciascun consenso legge checkbox e note attualmente inserite.
    for (const def of CONSENT_DEFS) {
      const g = $(def.ids.granted);
      const n = $(def.ids.notes);

      const granted = !!g?.checked;
      const notesRaw = String(n?.value || "");
      const notesTrim = notesRaw.trim();

      model[def.type] = {
        granted,
        notes: notesTrim,
      };
    }

    return model;
  }

  // Confronta due modelli di consenso per determinare se sono equivalenti.
  function modelsEqual(a, b) {
    // Il confronto è effettuato consenso per consenso su granted e notes.
    for (const def of CONSENT_DEFS) {
      const x = a?.[def.type] || { granted: false, notes: "" };
      const y = b?.[def.type] || { granted: false, notes: "" };

      // Una differenza sul flag granted rende i modelli diversi.
      if (Boolean(x.granted) !== Boolean(y.granted)) return false;

      // Una differenza sul testo delle note rende i modelli diversi.
      if (String(x.notes || "") !== String(y.notes || "")) return false;
    }

    // In assenza di differenze tutti i consensi coincidono.
    return true;
  }

  // Mostra o nasconde il banner che segnala modifiche locali non salvate.
  function setDirty(dirty) {
    // Recupera il banner dedicato allo stato dirty.
    const box = $("dirtyBanner");

    // Aggiorna la visibilità in base alla presenza di differenze.
    if (box) box.classList.toggle("hidden", !dirty);
  }

  // Ricalcola tutti i banner derivati in base allo stato corrente della UI.
  function updateComputedBanners() {
    // Legge il modello corrente direttamente dall’interfaccia.
    const current = readUiModel();

    // Confronta il modello corrente con quello caricato dal backend per rilevare modifiche pendenti.
    setDirty(!modelsEqual(current, state.loadedModel));

    // Costruisce l’elenco dei consensi essenziali ancora non concessi.
    const missing = [];
    for (const def of CONSENT_DEFS) {
      if (!def.required) continue;
      if (!current[def.type]?.granted) missing.push(def.label);
    }

    // Aggiorna il banner dei consensi essenziali mancanti.
    const rb = $("requiredBanner");
    const rl = $("requiredList");
    if (rb && rl) {
      if (missing.length) {
        rl.textContent = missing.join(", ");
        rb.classList.remove("hidden");
      } else {
        rb.classList.add("hidden");
        rl.textContent = "";
      }
    }
  }

  // Applica all’interfaccia i DTO restituiti dal backend e aggiorna anche lo stato locale persistito.
  function applyServerDtosToUi(dtos) {
    // Mappa i DTO per tipo di consenso così da facilitarne il lookup.
    const map = new Map();
    (Array.isArray(dtos) ? dtos : []).forEach((x) => {
      const c = normalizeConsent(x);
      if (c.type) map.set(String(c.type), c);
    });

    // Modello sintetico che rappresenta lo stato caricato dal backend.
    const loadedModel = {};

    // Per ogni definizione aggiorna pill, metadati e modello persistito.
    for (const def of CONSENT_DEFS) {
      const dto = map.get(def.type) || null;

      const hasRecord = !!dto;
      const granted = dto ? !!dto.granted : false;
      const notes = dto && dto.notes ? String(dto.notes) : "";

      // Aggiorna lo stato visuale della pill.
      setPill(def, granted, hasRecord);

      // Aggiorna i metadati descrittivi mostrati nella card.
      setMeta(def, dto);

      // Costruisce il modello persistito normalizzato per quel consenso.
      loadedModel[def.type] = {
        granted,
        notes: (notes || "").trim(),
      };
    }

    // Memorizza sia i DTO completi sia il modello sintetico caricato.
    state.loadedDtos = map;
    state.loadedModel = loadedModel;

    // Allinea checkbox e note della UI al modello appena caricato.
    fillUiFromModel(state.loadedModel);
  }

  // Valida il modello prima del salvataggio lato backend.
  function validateBeforeSave(model) {
    // Controlla la lunghezza delle note per ciascun consenso definito.
    for (const def of CONSENT_DEFS) {
      const notes = String(model[def.type]?.notes || "");
      if (notes.length > MAX_NOTES_LEN) {
        return "Le note superano la lunghezza massima consentita.";
      }
    }

    // Restituisce null se tutte le validazioni sono superate.
    return null;
  }

  // Carica profilo sintetico e consensi dal backend, quindi sincronizza la UI.
  async function loadConsents() {
    // Riparte sempre da uno stato visivo pulito.
    clearError();
    setLoading(true);

    try {
      // Recupera i dati sintetici dell’utente autenticato.
      const me = await apiJson("GET", API_ME);

      // Aggiorna il riepilogo utente mostrato nella pagina.
      setUserSummary(me);

      // Recupera l’elenco dei consensi attualmente registrati.
      const list = await apiJson("GET", API_CONSENTS);

      // Applica i DTO alla UI e allo stato locale persistito.
      applyServerDtosToUi(list);
    } catch (err) {
      // In caso di errore mostra un messaggio globale coerente.
      showError(APL.utils.humanizeError(err) || "Impossibile caricare i consensi.");
    } finally {
      // Ripristina sempre lo stato di non-caricamento a fine flusso.
      setLoading(false);
    }
  }

  // Salva lato backend il modello di consensi correntemente impostato nella UI.
  async function saveConsents() {
    // Riparte da uno stato visivo pulito.
    clearError();

    // Legge il modello corrente dalla UI.
    const model = readUiModel();

    // Esegue la validazione preventiva prima di costruire il payload.
    const validation = validateBeforeSave(model);
    if (validation) {
      APL.utils.toast(validation, "error");
      return;
    }

    // Costruisce il payload nel formato atteso dal backend.
    const payload = {
      consents: CONSENT_DEFS.map((def) => ({
        type: def.type,
        granted: Boolean(model[def.type]?.granted),
        notes: model[def.type]?.notes ? String(model[def.type].notes).trim() : null,
      })),
    };

    // Attiva il loading dell’intera sezione di editing.
    setLoading(true);

    try {
      // Invia il payload aggiornato al backend.
      const updated = await apiJson("PUT", API_CONSENTS, payload);

      // Notifica il successo dell’operazione.
      APL.utils.toast("Consensi aggiornati.", "success");

      // Risincronizza interamente UI e stato persistito con la risposta server.
      applyServerDtosToUi(updated);
    } catch (err) {
      // Produce un messaggio coerente sia per toast sia per box errore globale.
      const msg = APL.utils.humanizeError(err) || "Operazione non riuscita.";
      APL.utils.toast(msg, "error");
      showError(msg);

      // In caso di errore, ripristina l’interfaccia allo stato persistito più recente.
      fillUiFromModel(state.loadedModel);
    } finally {
      // Ripristina lo stato visuale di non-caricamento.
      setLoading(false);
    }
  }

  // Collega tutti gli eventi della pagina ai rispettivi controlli UI.
  function wireEvents() {
    // Collega il pulsante di salvataggio al flusso di persistenza lato backend.
    const btnSave = $("btnSave");
    if (btnSave) btnSave.addEventListener("click", saveConsents);

    // Collega il pulsante di ripristino al reset dello stato locale della UI.
    const btnReset = $("btnReset");
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        // Ripristina l’interfaccia allo stato caricato dal backend.
        fillUiFromModel(state.loadedModel);

        // Comunica all’utente che le modifiche locali sono state annullate.
        APL.utils.toast("Modifiche non salvate annullate.", "info");
      });
    }

    // Collega gli eventi specifici di ciascun consenso definito.
    for (const def of CONSENT_DEFS) {
      const g = $(def.ids.granted);
      const n = $(def.ids.notes);

      if (g) {
        g.addEventListener("change", () => {
          // Aggiorna subito la pill visuale del consenso in base al nuovo valore della checkbox.
          setPill(def, !!g.checked, true);

          // Ricalcola dirty state e banner dei consensi essenziali mancanti.
          updateComputedBanners();
        });
      }

      if (n) {
        n.addEventListener("input", () => {
          // Aggiorna il contatore dei caratteri mentre l’utente digita.
          setNotesCount(def);

          // Ricalcola dirty state e banner dipendenti dal modello corrente.
          updateComputedBanners();
        });
      }
    }
  }

  // Stato locale della pagina usato per conservare sia i DTO caricati
  // sia il modello sintetico persistito da confrontare con la UI corrente.
  const state = {
    loadedDtos: new Map(),
    loadedModel: {
      Treatment: { granted: false, notes: "" },
      DataProcessing: { granted: false, notes: "" },
      Marketing: { granted: false, notes: "" },
    },
  };

  // Inizializza la pagina consensi.
  // Coordina autenticazione, binding degli eventi e primo caricamento dei dati.
  async function init() {
    // Verifica la disponibilità dei moduli condivisi richiesti dalla pagina.
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Impone l’accesso al solo ruolo Patient.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Collega gli eventi della pagina ai rispettivi controlli.
    wireEvents();

    // Esegue il primo caricamento completo di profilo sintetico e consensi.
    await loadConsents();
  }

  // Avvia l’inizializzazione della vista quando il DOM è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
