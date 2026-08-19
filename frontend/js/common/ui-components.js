/**
 * File: frontend/js/common/ui-components.js
 *
 * Scopo
 * -----
 * Gestire il caricamento e l’inizializzazione dei componenti UI condivisi del front-end,
 * in particolare navbar, footer e modale riutilizzabile, coordinando anche la
 * navigazione per ruolo e il popolamento dinamico delle informazioni di sessione.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file rappresenta il modulo di orchestrazione dei componenti grafici comuni
 * dell’applicazione. Espone e inizializza elementi trasversali che devono comparire
 * in più pagine, mantenendo uniformità visiva, coerenza di navigazione e integrazione
 * con sessione, autenticazione e contesto utente corrente.
 *
 * Responsabilità principali
 * -------------------------
 * - definire etichette, sottotitoli e menu di navigazione per ciascun ruolo;
 * - caricare dinamicamente i componenti HTML condivisi;
 * - inizializzare navbar, footer e API modale lato client;
 * - popolare la navbar con informazioni di ruolo, email e stato sessione;
 * - gestire il rendering della navigazione desktop e mobile;
 * - esporre una API JavaScript per apertura e chiusura della modale;
 * - avviare il bootstrap dei componenti al `DOMContentLoaded`.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `window.APL`, `APL.session` e `APL.auth` per recuperare sessione e profilo utente;
 * - carica componenti HTML da `/components/*.html` tramite `fetch`;
 * - interagisce con il DOM per sostituire placeholder e inizializzare elementi condivisi;
 * - espone `APL.ui.modal` come API pubblica per l’uso della modale da altri script.
 *
 * Note
 * ----
 * Il file usa una IIFE per evitare l’inquinamento del global scope. Il caricamento
 * dei componenti HTML è supportato da una cache in memoria, così da evitare richieste
 * duplicate per lo stesso frammento durante il ciclo di vita della pagina.
 */

(function () {
  "use strict";

  // Garantisce l’esistenza del namespace applicativo globale.
  if (!window.APL) window.APL = {};
  const A = window.APL;

  // Etichette user-friendly mostrate nella navbar per ciascun ruolo.
  const ROLE_LABEL = {
    Admin: "Admin",
    Clinician: "Clinician",
    Patient: "Patient",
    Delegate: "Delegate",
  };

  // Sottotitoli contestuali mostrati nella navbar in base all’area applicativa corrente.
  const SUBTITLE_BY_ROLE = {
    Admin: "Dashboard amministrativa",
    Clinician: "Dashboard clinica",
    Patient: "Area paziente",
    Delegate: "Area delegato",
  };

  // Configurazione delle voci di navigazione per ciascun ruolo applicativo.
  // Ogni voce definisce URL, etichetta e, opzionalmente, l’allineamento a destra.
  const NAV_BY_ROLE = {
    Admin: [
      { href: "/pages/admin/dashboard.html", label: "Dashboard" },
      { href: "/pages/admin/patients.html", label: "Pazienti" },
      { href: "/pages/admin/delegates.html", label: "Delegati" },
      { href: "/pages/admin/clinicians.html", label: "Clinici" },
      { href: "/pages/admin/services.html", label: "Prestazioni" },
      { href: "/pages/admin/booking.html", label: "Prenota" },
      { href: "/pages/admin/slots.html", label: "Slot" },
      { href: "/pages/admin/appointments.html", label: "Appuntamenti" },
      { href: "/pages/admin/check-in.html", label: "Check-in" },
      { href: "/pages/admin/payments.html", label: "Pagamenti" },
      { href: "/pages/admin/notifications.html", label: "Notifiche" },
      { href: "/pages/admin/audit.html", label: "Audit" },
      { href: "/pages/admin/profile.html", label: "Profilo", right: true },
    ],
    Clinician: [
      { href: "/pages/clinician/dashboard.html", label: "Dashboard" },
      { href: "/pages/clinician/agenda.html", label: "Agenda" },
      { href: "/pages/clinician/ai-assistant.html", label: "Assistente AI" },
      { href: "/pages/clinician/profile.html", label: "Profilo", right: true },
    ],
    Patient: [
      { href: "/pages/patient/dashboard.html", label: "Dashboard" },
      { href: "/pages/patient/services.html", label: "Prestazioni" },
      { href: "/pages/patient/booking.html", label: "Prenota" },
      { href: "/pages/patient/appointments.html", label: "Appuntamenti" },
      { href: "/pages/patient/reports.html", label: "Referti" },
      { href: "/pages/patient/payments.html", label: "Pagamenti" },
      { href: "/pages/patient/notifications.html", label: "Notifiche" },
      { href: "/pages/patient/consents.html", label: "Consensi" },
      { href: "/pages/patient/delegations.html", label: "Deleghe" },
      { href: "/pages/patient/profile.html", label: "Profilo", right: true },
    ],
    Delegate: [
      { href: "/pages/delegate/dashboard.html", label: "Dashboard" },
      { href: "/pages/delegate/booking.html", label: "Prenota" },
      { href: "/pages/delegate/appointments.html", label: "Appuntamenti" },
      { href: "/pages/delegate/reports.html", label: "Referti" },
      { href: "/pages/delegate/payments.html", label: "Pagamenti" },
      { href: "/pages/delegate/notifications.html", label: "Notifiche" },
      { href: "/pages/delegate/account.html", label: "Account", right: true },
    ],
  };

  // Cache in memoria dei componenti HTML già richiesti.
  const cache = new Map();

  // Carica un frammento HTML dal percorso indicato, riusando la cache se disponibile.
  async function fetchHtml(path) {
    // Se il componente è già stato richiesto in precedenza, riusa la Promise salvata.
    if (cache.has(path)) return cache.get(path);

    // Esegue il fetch del componente e conserva la Promise in cache per richieste successive.
    const p = fetch(path, { headers: { Accept: "text/html" } }).then(async (r) => {
      // Se la risposta non è valida, solleva un errore esplicativo.
      if (!r.ok) throw new Error(`Impossibile caricare componente: ${path}`);

      // Restituisce il markup HTML del componente.
      return await r.text();
    });

    cache.set(path, p);
    return p;
  }

  // Determina il ruolo corrente usando prima la sessione e, in fallback, il pathname.
  function getRole() {
    // Prova a leggere il ruolo dalla sessione autenticata.
    const fromSession = A.session?.getAuth?.()?.role;

    // Se disponibile, normalizza il ruolo usando il modulo auth.
    const role = A.auth?.normalizeRole ? A.auth.normalizeRole(fromSession) : String(fromSession || "");
    if (role) return role;

    // In assenza di sessione valida, prova a dedurre il ruolo dal percorso corrente.
    const m = window.location.pathname.match(/\/pages\/(admin|clinician|patient|delegate)\//i);
    if (!m) return "";

    // Normalizza il segmento del path corrispondente al ruolo.
    const seg = m[1].toLowerCase();
    if (A.auth?.normalizeRole) return A.auth.normalizeRole(seg);
    return seg;
  }

  // Verifica se un link di navigazione corrisponde esattamente alla pagina corrente.
  function isActive(href) {
    const cur = window.location.pathname;
    return cur === href;
  }

  // Restituisce la classe CSS da applicare a un link di navigazione
  // in base allo stato attivo e al contesto desktop/mobile.
  function linkClass(active, isMobile) {
    // Se il link è attivo, usa sempre lo stile evidenziato.
    if (active) {
      return isMobile
        ? "rounded-xl bg-blue-600 px-3 py-2 font-medium text-white"
        : "rounded-xl bg-blue-600 px-3 py-2 font-medium text-white";
    }

    // Se il link non è attivo, differenzia leggermente il rendering desktop e mobile.
    return isMobile
      ? "rounded-xl border px-3 py-2"
      : "rounded-xl px-3 py-2 text-slate-700 hover:bg-slate-50";
  }

  // Renderizza il menu di navigazione nel contenitore indicato.
  function renderNav(container, role, isMobile) {
    // Se il contenitore non esiste, non c’è nulla da renderizzare.
    if (!container) return;

    // Recupera la configurazione menu del ruolo corrente oppure un array vuoto.
    const items = NAV_BY_ROLE[role] || [];

    // Pulisce il contenitore prima di rigenerare le voci.
    container.innerHTML = "";

    // Crea dinamicamente ogni link di navigazione.
    items.forEach((it) => {
      const a = document.createElement("a");
      a.href = it.href;
      a.textContent = it.label;
      a.className = linkClass(isActive(it.href), isMobile);

      // In desktop, le voci marcate con `right` vengono spinte verso destra.
      if (!isMobile && it.right) {
        a.className += " ml-auto";
      }

      container.appendChild(a);
    });
  }

  // Inizializza la navbar condivisa popolando ruolo, stato sessione e menu.
  async function setupNavbar() {
    // Determina il ruolo corrente da sessione o pathname.
    const role = getRole();

    // Recupera i principali riferimenti DOM della navbar.
    const rolePill = document.getElementById("rolePill");
    const rolePillText = document.getElementById("rolePillText");
    const subtitle = document.getElementById("navbarSubtitle");

    const loginBtn = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");

    // Recupera l’eventuale sessione autenticata.
    const auth = A.session?.getAuth?.();

    if (auth) {
      // In presenza di sessione, nasconde il pulsante di login e mostra quello di logout.
      if (loginBtn) loginBtn.classList.add("hidden");
      if (logoutBtn) logoutBtn.classList.remove("hidden");

      // Se il ruolo è noto, mostra la pillola ruolo e valorizza il testo.
      if (rolePill && rolePillText && role) {
        rolePill.classList.remove("hidden");
        rolePillText.textContent = ROLE_LABEL[role] || role;
      }

      // Aggiorna il sottotitolo della navbar con la descrizione contestuale del ruolo.
      if (subtitle && role) {
        subtitle.textContent = SUBTITLE_BY_ROLE[role] || "Portale";
      }

      // Collega il pulsante logout al flusso di uscita applicativo.
      if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
          if (A.auth?.logout) A.auth.logout({ redirect: "/index.html" });
          else {
            try {
              A.session.clearAuth();
            } catch (_) { }
            window.location.href = "/index.html";
          }
        });
      }

      // Se disponibile, recupera il profilo utente per mostrare email e stato sessione.
      if (A.auth?.getMe) {
        try {
          const me = await A.auth.getMe();
          const userEmail = document.getElementById("userEmail");
          const subline = document.getElementById("userSubline");

          // Popola i campi informativi della navbar.
          if (userEmail) userEmail.textContent = me?.email || "—";
          if (subline) subline.textContent = "Sessione attiva";
        } catch (_) { }
      }
    } else {
      // In assenza di sessione, nasconde il logout e mostra il login.
      if (logoutBtn) logoutBtn.classList.add("hidden");
      if (loginBtn) loginBtn.classList.remove("hidden");

      // Nasconde il badge ruolo e ripristina il sottotitolo generico.
      if (rolePill) rolePill.classList.add("hidden");
      if (subtitle) subtitle.textContent = "Portale";
    }

    // Renderizza i menu desktop e mobile in base al ruolo corrente.
    renderNav(document.getElementById("navDesktop"), role, false);
    renderNav(document.getElementById("navMobile"), role, true);
  }

  // Inizializza il footer valorizzando l’anno corrente.
  function setupFooter() {
    const y = document.getElementById("footerYear");
    if (y) y.textContent = String(new Date().getFullYear());
  }

  // Inizializza l’API della modale condivisa, esponendo i metodi `open` e `close`.
  function setupModalApi() {
    // Recupera i riferimenti DOM della modale condivisa.
    const root = document.getElementById("aplModal");
    const title = document.getElementById("aplModalTitle");
    const body = document.getElementById("aplModalBody");
    const actions = document.getElementById("aplModalActions");
    const closeBtn = document.getElementById("aplModalClose");

    // Chiude la modale, nascondendola e ripulendo l’area azioni.
    function close() {
      if (!root) return;

      // Nasconde il contenitore principale e aggiorna gli attributi di accessibilità.
      root.classList.add("hidden");
      root.setAttribute("aria-hidden", "true");

      // Svuota i pulsanti azione generati dinamicamente.
      if (actions) actions.innerHTML = "";
    }

    // Apre la modale e la popola dinamicamente con titolo, corpo e azioni.
    function open(opts) {
      if (!root) return;

      // Imposta il titolo e il contenuto HTML, usando fallback sensati.
      if (title) title.textContent = opts?.title || "Dettaglio";
      if (body) body.innerHTML = opts?.bodyHtml || "";

      if (actions) {
        // Ripulisce l’area azioni prima di ricrearla.
        actions.innerHTML = "";

        // Recupera l’elenco azioni, se presente.
        const list = Array.isArray(opts?.actions) ? opts.actions : [];

        // Genera dinamicamente ogni pulsante azione.
        list.forEach((a) => {
          const btn = document.createElement("button");
          btn.type = "button";

          // Determina lo stile del pulsante in base al tipo logico dell’azione.
          const kind = String(a?.kind || "secondary").toLowerCase();
          btn.className =
            kind === "primary"
              ? "h-10 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100"
              : "h-10 rounded-xl border px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

          // Imposta l’etichetta del pulsante.
          btn.textContent = a?.label || "Chiudi";

          // Collega l’azione del pulsante, chiudendo la modale salvo diversa configurazione.
          btn.addEventListener("click", async () => {
            try {
              if (typeof a?.onClick === "function") {
                await a.onClick();
              }
            } finally {
              if (a?.closeOnClick !== false) close();
            }
          });

          actions.appendChild(btn);
        });
      }

      // Rende visibile la modale e aggiorna gli attributi di accessibilità.
      root.classList.remove("hidden");
      root.setAttribute("aria-hidden", "false");
    }

    // Collega il pulsante di chiusura esplicita.
    if (closeBtn) closeBtn.addEventListener("click", close);

    // Consente la chiusura cliccando sullo sfondo esterno della modale.
    if (root) {
      root.addEventListener("click", (e) => {
        if (e.target === root) close();
      });
    }

    // Espone l’API modale nel namespace globale applicativo.
    A.ui = A.ui || {};
    A.ui.modal = { open, close };
  }

  // Carica un componente HTML a partire da un placeholder con attributo `data-component`.
  async function loadComponent(target) {
    // Recupera il nome logico del componente dal placeholder.
    const name = target.getAttribute("data-component");

    // Costruisce il percorso del frammento HTML corrispondente.
    const path = `/components/${name}.html`;

    // Carica il markup del componente.
    const html = await fetchHtml(path);

    // Sostituisce completamente il placeholder con il markup reale.
    target.outerHTML = html;
  }

  // Esegue il bootstrap completo dei componenti condivisi della pagina.
  async function bootstrapComponents() {
    // Recupera tutti i placeholder che dichiarano un componente da caricare.
    const placeholders = Array.from(document.querySelectorAll("[data-component]"));

    // Carica e sostituisce i componenti uno alla volta.
    for (const ph of placeholders) {
      await loadComponent(ph);
    }

    // Dopo il caricamento dei frammenti HTML, inizializza i comportamenti associati.
    setupNavbar();
    setupFooter();
    setupModalApi();
  }

  // Avvia il bootstrap dei componenti quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", () => {
    bootstrapComponents().catch((err) => {
      console.error(err);
    });
  });
})();
