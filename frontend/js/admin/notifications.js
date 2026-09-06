/**
 * File: frontend/js/admin/notifications.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina amministrativa dedicata
 * alle comunicazioni e ai promemoria, comprendendo il caricamento della lista,
 * il filtraggio per testo/intervallo/destinatario/stato di lettura,
 * l’apertura del dettaglio di una notifica e la creazione di una nuova
 * comunicazione da parte dell’operatore amministrativo.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Notifiche" dell’area
 * Admin. Si integra con i moduli condivisi del front-end per autenticazione,
 * sessione, richieste HTTP, formattazione date, toast e modali, e dialoga con
 * gli endpoint amministrativi del dominio Notifications per consentire la
 * consultazione dello storico delle comunicazioni e l’invio/pianificazione di
 * nuovi messaggi verso i destinatari del portale.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Admin;
 * - inizializzare i controlli della pagina e i filtri di ricerca;
 * - richiedere al backend l’elenco delle comunicazioni amministrative;
 * - normalizzare i payload ricevuti in una struttura uniforme lato client;
 * - applicare filtri client-side su testo, destinatario, intervallo e lettura;
 * - ordinare i risultati e aggiornare le statistiche sintetiche;
 * - renderizzare la tabella delle comunicazioni e lo stato vuoto;
 * - aprire una modale con il dettaglio completo della comunicazione selezionata;
 * - aprire una modale per la creazione o pianificazione di una nuova notifica;
 * - gestire caricamenti, errori globali e feedback utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare le richieste API;
 * - utilizza `APL.utils.requestJson`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.toast`,
 *   `APL.utils.toRomeDateInputValue`, `APL.utils.parseApiDate`,
 *   `APL.utils.romeDateRangeToUtc`, `APL.utils.romeTodayDateInputValue`
 *   e `APL.utils.addDaysToDateInput`;
 * - utilizza `APL.ui.modal` per il dettaglio della notifica e per la
 *   composizione guidata di una nuova comunicazione;
 * - interagisce con gli endpoint:
 *   `/api/notifications/admin`
 *   sia per la lettura della lista sia per la creazione di nuove comunicazioni.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina combina due flussi distinti ma collegati:
 * - consultazione/analisi delle comunicazioni già registrate;
 * - composizione e invio/pianificazione di una nuova comunicazione.
 */

(function () {
  "use strict";

  // Ruolo richiesto per l’accesso alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint base per il recupero della lista delle comunicazioni amministrative.
  const API_LIST = "/api/notifications/admin";

  // Endpoint base per la creazione di una nuova comunicazione amministrativa.
  const API_CREATE = "/api/notifications/admin";

  // Utility locale per recuperare rapidamente un nodo DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Esegue l’escape HTML di una stringa prima dell’inserimento in markup dinamico.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Mostra un messaggio di errore globale nel contenitore principale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    box.textContent = message || "Errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore degli errori globali.
  function clearError() {
    const box = $("pageError");
    if (!box) return;

    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna lo stato di caricamento globale della pagina.
  // Durante operazioni asincrone disabilita i controlli principali per evitare
  // interazioni concorrenti o doppie richieste.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const ids = [
      "btnOpenCreate",
      "searchInput",
      "sortSelect",
      "fromDate",
      "toDate",
      "btnLast30",
      "btnLast90",
      "btnAll",
      "btnResetFilters",
      "btnEmptyReset",
      "onlyUnread",
      "recipientInput",
    ];

    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Converte una data JavaScript nel formato compatibile con un input date.
  function toLocalDateInputValue(d) {
    return APL.utils.toRomeDateInputValue(d);
  }

  // Formattta una data/ora API in forma leggibile per un utente italiano.
  function fmtDateTime(isoUtc) {
    if (!isoUtc) return "—";

    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // Formattta solo la componente data in forma breve.
  function fmtDate(isoUtc) {
    if (!isoUtc) return "—";

    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    return d.toLocaleDateString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  // Determina se lo stato della comunicazione corrisponde a una presa visione.
  function isReadStatus(status) {
    return String(status || "").toLowerCase() === "read";
  }

  // Traduce il canale tecnico in una label leggibile dall’utente.
  function formatChannelLabel(channel) {
    const value = String(channel || "").trim().toUpperCase();

    if (value === "EMAIL") return "Email";
    if (value === "IN_APP") return "In-app";

    return value || "In-app";
  }

  // Costruisce il messaggio di successo da mostrare dopo la creazione della comunicazione.
  // Il testo varia in base al canale scelto e allo stato restituito dal backend.
  function buildCreateSuccessMessage(notification) {
    const channel = String(notification?.channel || "").trim().toUpperCase();
    const status = String(notification?.status || "").trim().toUpperCase();

    if (channel === "EMAIL") {
      if (status === "PENDING") return "Email pianificata correttamente.";
      if (status === "FAILED") return "Comunicazione registrata, ma l'email non è stata inviata.";
      return "Email inviata tramite Mailpit.";
    }

    return status === "PENDING"
      ? "Comunicazione pianificata correttamente."
      : "Comunicazione inviata.";
  }

  // Restituisce un badge HTML che rappresenta visivamente uno stato o un canale.
  function pill(label, tone) {
    const cls =
      tone === "emerald"
        ? "bg-emerald-50 text-emerald-700"
        : tone === "blue"
          ? "bg-blue-50 text-blue-700"
          : tone === "amber"
            ? "bg-amber-50 text-amber-800"
            : tone === "red"
              ? "bg-red-50 text-red-700"
              : "bg-slate-100 text-slate-700";

    return `<span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}">${escapeHtml(label)}</span>`;
  }

  // Mostra o nasconde lo stato vuoto della tabella notifiche.
  function emptyState(show) {
    const box = $("emptyState");
    if (box) box.classList.toggle("hidden", !show);
  }

  // Verifica se una stringa ha forma compatibile con un GUID/UUID.
  // Serve a validare l’identificativo del destinatario in fase di creazione.
  function isGuid(value) {
    const s = String(value || "").trim();
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return re.test(s);
  }

  // Wrapper centralizzato per richieste JSON autenticate con gestione coerente degli errori.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    if (!res.ok) {
      // Se la sessione è scaduta, svuota l’autenticazione locale
      // e reindirizza alla pagina dedicata.
      if (res.status === 401) {
        try { APL.session.clearAuth(); } catch (_) { }
        if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
        throw new Error("Sessione scaduta.");
      }

      // Se l’utente non ha il privilegio necessario, reindirizza alla pagina forbidden.
      if (res.status === 403) {
        if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
        throw new Error("Accesso non autorizzato.");
      }

      // Negli altri casi prova a ricostruire un messaggio applicativo leggibile.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Attende che il sistema modale condiviso sia pronto prima di usarlo.
  async function ensureModalReady(timeoutMs = 9000) {
    const start = Date.now();

    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }

    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Normalizza una notifica proveniente dal backend in una struttura uniforme lato client.
  // Questo evita di propagare differenze di naming tra payload diversi nel resto della UI.
  function normalizeNotification(x) {
    return {
      id: x?.id || x?.Id || "",
      recipientUserId: x?.recipientUserId || x?.RecipientUserId || "",
      channel: x?.channel || x?.Channel || "",
      subject: x?.subject || x?.Subject || "",
      body: x?.body || x?.Body || "",
      status: x?.status || x?.Status || "",
      scheduledAtUtc: x?.scheduledAtUtc || x?.ScheduledAtUtc || "",
      sentAtUtc: x?.sentAtUtc || x?.SentAtUtc || "",
      createdAtUtc: x?.createdAtUtc || x?.CreatedAtUtc || "",
    };
  }

  // Interpreta i campi data presenti nella UI e restituisce un intervallo in millisecondi.
  // L’intervallo viene usato solo lato client per filtrare la lista già caricata.
  function parseDateInputRange() {
    const from = String($("fromDate")?.value || "").trim();
    const to = String($("toDate")?.value || "").trim();
    const range = from && to && to >= from ? APL.utils.romeDateRangeToUtc(from, to) : null;

    return {
      fromMs: range?.fromUtc ? APL.utils.parseApiDate(range.fromUtc)?.getTime() ?? null : null,
      toMs: range?.toUtc ? APL.utils.parseApiDate(range.toUtc)?.getTime() ?? null : null,
    };
  }

  // Applica i filtri client-side alla lista completa delle notifiche già caricata.
  function applyClientFilters(items) {
    const term = String($("searchInput")?.value || "").trim().toLowerCase();
    const sort = String($("sortSelect")?.value || "NEWEST").toUpperCase();
    const onlyUnread = !!$("onlyUnread")?.checked;
    const recipientTerm = String($("recipientInput")?.value || "").trim().toLowerCase();
    const { fromMs, toMs } = parseDateInputRange();

    let list = Array.isArray(items) ? items.slice() : [];

    // Filtro dedicato alle sole comunicazioni non lette dal destinatario.
    if (onlyUnread) list = list.filter((n) => !isReadStatus(n.status));

    // Filtro per destinatario basato sull’identificativo utente.
    if (recipientTerm) {
      list = list.filter((n) =>
        String(n.recipientUserId || "").toLowerCase().includes(recipientTerm)
      );
    }

    // Ricerca libera su oggetto, corpo, canale e stato della notifica.
    if (term) {
      list = list.filter((n) => {
        const hay = `${n.subject || ""} ${n.body || ""} ${n.channel || ""} ${n.status || ""}`.toLowerCase();
        return hay.includes(term);
      });
    }

    // Filtro per intervallo temporale calcolato sulla data pianificata,
    // o in alternativa sulla data di creazione.
    if (fromMs != null || toMs != null) {
      list = list.filter((n) => {
        const t = new Date(n.scheduledAtUtc || n.createdAtUtc || 0).getTime();
        if (!Number.isFinite(t)) return false;
        if (fromMs != null && t < fromMs) return false;
        if (toMs != null && t > toMs) return false;
        return true;
      });
    }

    // Ordinamento cronologico crescente o decrescente a seconda del selettore UI.
    list.sort((a, b) => {
      const ta = new Date(a.scheduledAtUtc || a.createdAtUtc || 0).getTime();
      const tb = new Date(b.scheduledAtUtc || b.createdAtUtc || 0).getTime();
      return sort === "OLDEST" ? ta - tb : tb - ta;
    });

    return list;
  }

  // Aggiorna le statistiche sintetiche mostrate nella parte superiore della pagina.
  function setStats(all) {
    const total = Array.isArray(all) ? all.length : 0;
    const unread = (Array.isArray(all) ? all : []).filter((n) => !isReadStatus(n.status)).length;

    let latest = "—";

    // Individua la comunicazione più recente ordinando per data pianificata/creazione.
    const byDate = (Array.isArray(all) ? all : [])
      .slice()
      .sort((a, b) => new Date(b.scheduledAtUtc || b.createdAtUtc || 0) - new Date(a.scheduledAtUtc || a.createdAtUtc || 0));

    if (byDate.length) latest = fmtDate(byDate[0].scheduledAtUtc || byDate[0].createdAtUtc);

    if ($("statTotal")) $("statTotal").textContent = String(total);
    if ($("statUnread")) $("statUnread").textContent = String(unread);
    if ($("statLatest")) $("statLatest").textContent = String(latest);
  }

  // Renderizza la tabella delle notifiche e aggiorna stato vuoto e statistiche.
  function renderTable(all, shown) {
    const tbody = $("tbody");
    if (!tbody) return;

    // Le statistiche vengono calcolate sull’intera lista caricata, non solo su quella filtrata.
    setStats(all);

    // In assenza di risultati visibili, attiva lo stato vuoto e mostra una riga placeholder.
    if (!shown.length) {
      emptyState(true);
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    emptyState(false);

    // Classe riutilizzata dai pulsanti azione presenti in ogni riga.
    const btnCls =
      "h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";

    const rows = shown.map((n) => {
      const when = fmtDateTime(n.scheduledAtUtc || n.createdAtUtc);
      const recipient = n.recipientUserId || "—";
      const subject = n.subject || "Comunicazione";

      // Lo stato mostrato in tabella è ricondotto a una lettura semplice:
      // letta o non letta.
      const unread = !isReadStatus(n.status);
      const stPill = unread ? pill("Non letta", "blue") : pill("Letta", "emerald");
      const chPill = pill(formatChannelLabel(n.channel), "slate");

      return `
        <tr>
          <td class="py-4 pr-4 text-slate-800">${escapeHtml(when)}</td>
          <td class="py-4 pr-4 text-slate-700 truncate max-w-[260px]" title="${escapeHtml(recipient)}">${escapeHtml(recipient)}</td>
          <td class="py-4 pr-4 text-slate-700 truncate max-w-[360px]" title="${escapeHtml(subject)}">${escapeHtml(subject)}</td>
          <td class="py-4 pr-4">${stPill}</td>
          <td class="py-4 pr-4">${chPill}</td>
          <td class="py-4 text-right">
            <div class="inline-flex items-center gap-2 justify-end">
              <button type="button" class="${btnCls}" data-action="open" data-id="${escapeHtml(String(n.id))}">
                Apri
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows.join("");
  }

  // Apre una modale con il dettaglio completo della comunicazione selezionata.
  async function openNotificationModal(n) {
    const ok = await ensureModalReady();
    if (!ok) return;

    const when = fmtDateTime(n.scheduledAtUtc || n.createdAtUtc);
    const unread = !isReadStatus(n.status);

    const body = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="text-xs font-medium text-slate-500">Data</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(when)}</div>
          <div class="mt-2 text-xs text-slate-600">Stato destinatario: ${escapeHtml(unread ? "Non letta" : "Letta")}</div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Destinatario</div>
          <div class="mt-1 text-sm font-semibold text-slate-900 break-words">${escapeHtml(n.recipientUserId || "—")}</div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Canale</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(formatChannelLabel(n.channel))}</div>
        </div>

        <div class="rounded-2xl border bg-white p-4">
          <div class="text-xs font-medium text-slate-500">Oggetto</div>
          <div class="mt-1 text-sm font-semibold text-slate-900">${escapeHtml(n.subject || "Comunicazione")}</div>
        </div>

        <div>
          <div class="text-xs font-medium text-slate-500">Messaggio</div>
          <pre class="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800 leading-relaxed rounded-2xl border bg-white p-4 max-h-[52vh] overflow-auto">${escapeHtml(n.body || "")}</pre>
        </div>
      </div>
    `;

    APL.ui.modal.open({
      title: "Dettaglio comunicazione",
      bodyHtml: body,
      actions: [{ label: "Chiudi", kind: "primary", closeOnClick: true }],
    });
  }

  // Apre la modale per la composizione di una nuova comunicazione.
  async function openCreateModal() {
    const ok = await ensureModalReady();
    if (!ok) return;

    const body = `
      <div class="space-y-4">
        <div class="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
          Compili i campi e invii la comunicazione. È possibile pianificare l’invio. Le e-mail vengono recapitate tramite Mailpit nell’ambiente locale di sviluppo.
        </div>

        <div class="grid gap-3 sm:grid-cols-12">
          <div class="sm:col-span-12">
            <label class="text-sm font-medium text-slate-700" for="createRecipientUserId">Destinatario (ID)</label>
            <input id="createRecipientUserId" type="text" placeholder="Esempio: 00000000-0000-0000-0000-000000000000"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100" />
            <div class="mt-2 text-xs text-slate-600">Inserire l’identificativo del destinatario.</div>
          </div>

          <div class="sm:col-span-12">
            <label class="text-sm font-medium text-slate-700" for="createSubject">Oggetto</label>
            <input id="createSubject" type="text" placeholder="Oggetto della comunicazione"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100" />
          </div>

          <div class="sm:col-span-12">
            <label class="text-sm font-medium text-slate-700" for="createBody">Messaggio</label>
            <textarea id="createBody" rows="6" placeholder="Inserire il testo…"
              class="mt-2 w-full rounded-2xl border px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100"></textarea>
          </div>

          <div class="sm:col-span-6">
            <label class="text-sm font-medium text-slate-700" for="createChannel">Canale</label>
            <select id="createChannel"
              class="mt-2 h-11 w-full rounded-xl border bg-white px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100">
              <option value="IN_APP">In-app</option>
              <option value="EMAIL">Email</option>
            </select>
          </div>

          <div class="sm:col-span-6">
            <label class="text-sm font-medium text-slate-700" for="createSchedule">Pianificazione</label>
            <select id="createSchedule"
              class="mt-2 h-11 w-full rounded-xl border bg-white px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100">
              <option value="NOW">Invio immediato</option>
              <option value="LATER">Pianifica</option>
            </select>
          </div>

          <div class="sm:col-span-12" id="scheduleBox" style="display:none;">
            <label class="text-sm font-medium text-slate-700" for="createWhen">Data e ora</label>
            <input id="createWhen" type="datetime-local"
              class="mt-2 h-11 w-full rounded-xl border px-4 text-sm focus:outline-none focus:ring-4 focus:ring-blue-100" />
            <div class="mt-2 text-xs text-slate-600">L’invio verrà eseguito all’orario selezionato.</div>
          </div>
        </div>
      </div>
    `;

    APL.ui.modal.open({
      title: "Nuova comunicazione",
      bodyHtml: body,
      actions: [
        { label: "Annulla", kind: "secondary", closeOnClick: true },
        {
          label: "Invia",
          kind: "primary",
          closeOnClick: false,
          onClick: async () => {
            const recipientUserId = String(document.getElementById("createRecipientUserId")?.value || "").trim();
            const subject = String(document.getElementById("createSubject")?.value || "").trim();
            const msg = String(document.getElementById("createBody")?.value || "").trim();
            const channel = String(document.getElementById("createChannel")?.value || "IN_APP").trim();
            const schedule = String(document.getElementById("createSchedule")?.value || "NOW");

            // Il destinatario deve essere espresso come GUID valido.
            if (!recipientUserId || !isGuid(recipientUserId)) {
              APL.utils.toast("Inserire un identificativo destinatario valido.", "error");
              return;
            }

            // Oggetto e contenuto del messaggio sono entrambi obbligatori.
            if (!subject || !msg) {
              APL.utils.toast("Compilare oggetto e messaggio.", "error");
              return;
            }

            let scheduledAtUtc = null;

            // In caso di pianificazione, la data/ora locale viene convertita in UTC.
            if (schedule === "LATER") {
              const whenLocal = String(document.getElementById("createWhen")?.value || "").trim();

              if (!whenLocal) {
                APL.utils.toast("Selezionare data e ora per pianificare.", "error");
                return;
              }

              const dt = new Date(whenLocal);
              if (!Number.isFinite(dt.getTime())) {
                APL.utils.toast("Data/ora non valida.", "error");
                return;
              }

              scheduledAtUtc = dt.toISOString();
            }

            try {
              // Invia la richiesta di creazione verso il backend amministrativo.
              const created = await apiJson("POST", API_CREATE, {
                recipientUserId,
                subject,
                body: msg,
                scheduledAtUtc,
                channel,
              });

              const createdNotification = normalizeNotification(created || {});
              APL.utils.toast(buildCreateSuccessMessage(createdNotification), "success");

              // Chiude la modale e ricarica la lista per riflettere il nuovo elemento.
              if (APL.ui?.modal?.close) APL.ui.modal.close();
              await loadNotifications();
            } catch (e) {
              APL.utils.toast(APL.utils.humanizeError(e) || "Operazione non riuscita.", "error");
            }
          },
        },
      ],
    });

    const scheduleSel = document.getElementById("createSchedule");
    const box = document.getElementById("scheduleBox");

    if (scheduleSel && box) {
      // Mostra o nasconde il blocco data/ora in funzione della modalità di invio selezionata.
      scheduleSel.addEventListener("change", () => {
        box.style.display = scheduleSel.value === "LATER" ? "" : "none";
      });
    }
  }

  // Applica una scorciatoia temporale ai campi data della pagina.
  function applyQuickRange(kind) {
    const fromEl = $("fromDate");
    const toEl = $("toDate");
    if (!fromEl || !toEl) return;

    const today = APL.utils.romeTodayDateInputValue();

    if (kind === "last30") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -30);
      toEl.value = today;
    } else if (kind === "last90") {
      fromEl.value = APL.utils.addDaysToDateInput(today, -90);
      toEl.value = today;
    } else if (kind === "all") {
      fromEl.value = "";
      toEl.value = "";
    }
  }

  // Ripristina i filtri della pagina al loro assetto predefinito.
  function resetFilters() {
    $("searchInput").value = "";
    $("sortSelect").value = "NEWEST";
    $("onlyUnread").checked = false;
    $("recipientInput").value = "";
    applyQuickRange("last90");
  }

  // Carica dal backend la lista delle notifiche e aggiorna lo stato locale/UI.
  async function loadNotifications() {
    clearError();
    setLoading(true);

    try {
      const data = await apiJson("GET", API_LIST);
      const list = (Array.isArray(data) ? data : []).map(normalizeNotification);

      // Aggiorna la cache locale e l’indice rapido per id.
      state.all = list;
      state.byId = new Map(list.filter((x) => x.id).map((x) => [String(x.id), x]));

      // Applica subito i filtri correnti alla lista appena caricata.
      state.shown = applyClientFilters(state.all);

      renderTable(state.all, state.shown);
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Impossibile caricare le comunicazioni.");

      const tbody = $("tbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">—</td></tr>`;

      // In caso di errore non si tratta di assenza dati, quindi non si usa lo stato vuoto funzionale.
      emptyState(false);
    } finally {
      setLoading(false);
    }
  }

  // Collega tutti i controlli della pagina ai relativi comportamenti applicativi.
  function wireEvents() {
    const btnOpenCreate = $("btnOpenCreate");
    if (btnOpenCreate) btnOpenCreate.addEventListener("click", openCreateModal);

    const btnLast30 = $("btnLast30");
    if (btnLast30) btnLast30.addEventListener("click", () => {
      applyQuickRange("last30");
      loadNotifications();
    });

    const btnLast90 = $("btnLast90");
    if (btnLast90) btnLast90.addEventListener("click", () => {
      applyQuickRange("last90");
      loadNotifications();
    });

    const btnAll = $("btnAll");
    if (btnAll) btnAll.addEventListener("click", () => {
      applyQuickRange("all");
      loadNotifications();
    });

    const btnReset = $("btnResetFilters");
    if (btnReset) btnReset.addEventListener("click", () => {
      resetFilters();
      loadNotifications();
    });

    const btnEmptyReset = $("btnEmptyReset");
    if (btnEmptyReset) btnEmptyReset.addEventListener("click", () => {
      resetFilters();
      loadNotifications();
    });

    // Il filtro "solo non lette" opera sulla cache locale già caricata.
    const onlyUnread = $("onlyUnread");
    if (onlyUnread) {
      onlyUnread.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderTable(state.all, state.shown);
      });
    }

    const fromDate = $("fromDate");
    const toDate = $("toDate");

    // Le variazioni delle date aggiornano solo il filtro client-side, senza nuovo fetch remoto.
    if (fromDate) {
      fromDate.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderTable(state.all, state.shown);
      });
    }

    if (toDate) {
      toDate.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderTable(state.all, state.shown);
      });
    }

    // Il selettore di ordinamento riorganizza i risultati già presenti in cache locale.
    const sort = $("sortSelect");
    if (sort) {
      sort.addEventListener("change", () => {
        state.shown = applyClientFilters(state.all);
        renderTable(state.all, state.shown);
      });
    }

    // La ricerca testuale si applica in tempo reale sulla cache locale.
    const search = $("searchInput");
    if (search) {
      search.addEventListener("input", () => {
        state.shown = applyClientFilters(state.all);
        renderTable(state.all, state.shown);
      });
    }

    // Anche il filtro per destinatario viene applicato live sulla lista già caricata.
    const recipient = $("recipientInput");
    if (recipient) {
      recipient.addEventListener("input", () => {
        state.shown = applyClientFilters(state.all);
        renderTable(state.all, state.shown);
      });
    }

    // Event delegation sulle azioni della tabella per evitare listener separati su ogni riga.
    const tbody = $("tbody");
    if (tbody) {
      tbody.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-action][data-id]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        if (!id) return;

        const n = state.byId.get(String(id));
        if (!n) return;

        if (action === "open") {
          await openNotificationModal(n);
        }
      });
    }
  }

  // Stato locale della pagina:
  // - all: lista completa delle notifiche caricate dal backend;
  // - shown: lista effettivamente visibile dopo i filtri client-side;
  // - byId: indice rapido per recuperare una notifica dal suo id.
  const state = {
    all: [],
    shown: [],
    byId: new Map(),
  };

  // Inizializza la pagina quando il DOM è pronto.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non dispone del ruolo amministrativo richiesto.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // All’avvio imposta come default una vista sugli ultimi 90 giorni.
    applyQuickRange("last90");

    // Collega gli eventi della pagina.
    wireEvents();

    // Carica i dati iniziali.
    await loadNotifications();
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
