/**
 * File: frontend/js/clinician/ai-assistant.js
 *
 * Scopo
 * -----
 * Gestire il comportamento client-side della pagina dedicata all’assistente AI
 * consultivo del clinico, comprendendo la composizione della richiesta,
 * la gestione della conversazione, il salvataggio locale del contesto e dello
 * storico messaggi, la selezione degli allegati e l’invio della richiesta
 * all’endpoint applicativo di question answering.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file implementa la logica operativa della vista "Assistente AI"
 * dell’area Clinician. Si integra con i moduli condivisi del front-end per
 * autenticazione, sessione, richieste HTTP, utilità, toast e modali, e dialoga
 * con il backend AI per consentire al professionista sanitario di ottenere
 * risposte consultive su protocolli, procedure e documentazione testuale,
 * mantenendo il controllo locale della conversazione e dei contenuti inviati.
 *
 * Responsabilità principali
 * -------------------------
 * - verificare che l’utente autenticato appartenga al ruolo Clinician;
 * - gestire lo stato locale della conversazione e degli allegati;
 * - salvare e ripristinare la chat e il contesto clinico tramite localStorage;
 * - permettere l’invio di domande corredate da contesto e documenti;
 * - validare preventivamente testo e allegati prima dell’invio;
 * - intercettare pattern che possano suggerire PII diretta;
 * - gestire lo stato di caricamento e l’eventuale interruzione manuale;
 * - mostrare i messaggi utente e assistente nella vista conversazionale;
 * - consentire l’esportazione della conversazione e l’avvio di una nuova chat;
 * - mostrare messaggi di errore globali e feedback contestuali all’utente.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per autenticare la richiesta multipart;
 * - utilizza `APL.session.clearAuth` nei casi di sessione scaduta;
 * - utilizza `APL.utils.setLoading`, `APL.utils.parseApiDate`,
 *   `APL.utils.parseErrorMessage`, `APL.utils.humanizeError` e `APL.utils.toast`;
 * - utilizza `APL.ui.modal` per conferme e avvisi;
 * - interagisce con l’endpoint `/api/ai/clinicians/qa`;
 * - utilizza `localStorage` per persistere conversazione e contesto locale.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La conversazione viene mantenuta localmente nel browser e può essere inclusa,
 * in forma sintetica, nel contesto della richiesta successiva quando il toggle
 * "Includi conversazione" è attivo.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla vista Assistente AI.
  const EXPECTED_ROLE = "Clinician";

  // Chiavi utilizzate per persistere nel browser la chat e il contesto clinico.
  const STORAGE_KEY = "apl.ai.assistant.chat.v1";
  const STORAGE_CTX_KEY = "apl.ai.assistant.context.v1";

  // Endpoint backend che gestisce la richiesta consultiva del clinico.
  const AI_URL = "/api/ai/clinicians/qa";

  // Utility locale per recuperare rapidamente un elemento DOM tramite id.
  function $(id) {
    return document.getElementById(id);
  }

  // Genera un identificativo locale per i messaggi di chat.
  // Se disponibile, utilizza `crypto.randomUUID`; in alternativa usa un fallback.
  function uid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
    } catch (_) { }
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  // Mostra un messaggio di errore globale nel contenitore dedicato della pagina.
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

  // Aggiorna lo stato di caricamento globale della vista.
  // Oltre al badge e ai pulsanti principali, disabilita temporaneamente i controlli
  // che non devono essere modificati durante l’elaborazione della richiesta.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    const btnSend = $("btnSend");
    const btnStop = $("btnStop");

    if (btnSend) APL.utils.setLoading(btnSend, loading, "Invio…");
    if (btnStop) btnStop.disabled = !loading;

    const disableIds = [
      "questionInput",
      "contextInput",
      "btnClearAttachments",
      "btnClearContext",
      "btnNewConversation",
      "btnExport",
      "toggleHistory",
      "fileInput",
    ];

    for (const id of disableIds) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Formattta un timestamp ISO in una forma leggibile per un utente italiano.
  function fmtTime(ts) {
    const d = APL.utils.parseApiDate(ts);
    if (!d) return "—";

    return d.toLocaleString("it-IT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
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

  // Prova a interpretare un testo come JSON.
  // Se il parsing fallisce, restituisce il testo grezzo.
  function parseJsonText(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // Esegue una richiesta multipart verso l’endpoint AI.
  // Restituisce una struttura uniforme contenente esito, status, payload e requestId.
  async function requestMultipart(url, formData, abortSignal) {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...APL.session.authHeader(), Accept: "application/json" },
      body: formData,
      signal: abortSignal,
    });

    const requestId =
      res.headers.get("X-Request-ID") || res.headers.get("x-request-id") || "";

    const text = await res.text();
    const data = parseJsonText(text);

    return { ok: res.ok, status: res.status, data, requestId };
  }

  // Esegue un controllo leggero e conservativo su pattern che potrebbero rappresentare PII diretta.
  // La verifica non è esaustiva, ma aiuta a intercettare i casi più evidenti prima dell’invio.
  function likelyPII(text) {
    const t = String(text || "");
    const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
    const phone = /(\+?\d[\d\s().-]{7,}\d)/;
    const fiscalCode = /\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b/i;
    return email.test(t) || phone.test(t) || fiscalCode.test(t);
  }

  // Limita la lunghezza massima di una stringa per evitare payload troppo grandi.
  function clampText(s, maxChars) {
    const str = String(s || "");
    if (str.length <= maxChars) return str;
    return str.slice(0, maxChars);
  }

  // Costruisce una rappresentazione sintetica della cronologia recente da includere nel contesto.
  // Viene mantenuto solo un numero limitato di caratteri per non gonfiare il payload.
  function safeHistoryForContext(messages, maxChars) {
    const parts = [];
    for (const m of messages) {
      if (!m || !m.role || !m.content) continue;
      const role = m.role === "user" ? "Domanda" : "Risposta";
      parts.push(`${role}: ${String(m.content)}`);
    }
    return clampText(parts.join("\n\n"), maxChars);
  }

  // Ripristina dallo storage locale la conversazione salvata.
  // Vengono mantenuti solo i messaggi coerenti con il formato previsto.
  function loadChat() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return [];

      return data
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          id: String(x.id || uid()),
          role: String(x.role || ""),
          content: String(x.content || ""),
          ts: x.ts || new Date().toISOString(),
          meta: x.meta || null,
        }))
        .filter((x) => x.role === "user" || x.role === "assistant");
    } catch {
      return [];
    }
  }

  // Salva la conversazione nello storage locale.
  function saveChat(messages) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages || []));
    } catch (_) { }
  }

  // Ripristina il contesto clinico dallo storage locale.
  function loadContext() {
    try {
      return String(localStorage.getItem(STORAGE_CTX_KEY) || "");
    } catch {
      return "";
    }
  }

  // Salva il contesto clinico nello storage locale.
  function saveContext(value) {
    try {
      localStorage.setItem(STORAGE_CTX_KEY, String(value || ""));
    } catch (_) { }
  }

  // Aggiorna il sottotitolo della chat con uno stato sintetico della conversazione.
  function setChatSubtitle(messages) {
    const el = $("chatSubtitle");
    if (!el) return;

    if (!messages.length) {
      el.textContent = "Pronta per una nuova richiesta.";
      return;
    }

    const last = messages[messages.length - 1];
    el.textContent = `Ultimo aggiornamento: ${fmtTime(last.ts)}`;
  }

  // Renderizza gli allegati selezionati in forma compatta vicino al compositore.
  // Ogni chip permette anche la rimozione del singolo file.
  function renderAttachmentsInline(files) {
    const host = $("attachmentsInline");
    if (!host) return;

    host.innerHTML = "";

    for (const f of files) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className =
        "inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100";
      chip.title = "Rimuovi allegato";

      const name = document.createElement("span");
      name.className = "max-w-[220px] truncate";
      name.textContent = f.name;

      const x = document.createElement("span");
      x.className = "text-slate-500";
      x.textContent = "×";

      chip.appendChild(name);
      chip.appendChild(x);

      chip.addEventListener("click", () => {
        state.attachments = state.attachments.filter((a) => a !== f);
        refreshAttachmentsUI();
      });

      host.appendChild(chip);
    }
  }

  // Renderizza il pannello laterale completo degli allegati selezionati.
  // Mostra nome, tipo e dimensione, con un badge di attenzione per file grandi.
  function renderAttachmentsPanel(files) {
    const host = $("attachmentsList");
    if (!host) return;

    if (!files.length) {
      host.innerHTML = `
        <div class="rounded-2xl border bg-slate-50 p-4 text-sm text-slate-600">
          Nessun allegato selezionato.
        </div>
      `;
      return;
    }

    const rows = files.map((f) => {
      const sizeKb = Math.round((f.size || 0) / 1024);
      const badge =
        sizeKb > 2048
          ? `<span class="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Verificare dimensione</span>`
          : `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${sizeKb} KB</span>`;

      return `
        <div class="rounded-2xl border bg-slate-50 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-slate-900 truncate" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
              <div class="mt-1 text-xs text-slate-600">${escapeHtml(f.type || "Documento")}</div>
            </div>
            ${badge}
          </div>
        </div>
      `;
    });

    host.innerHTML = rows.join("");
  }

  // Aggiorna entrambe le rappresentazioni degli allegati e il relativo hint del compositore.
  function refreshAttachmentsUI() {
    renderAttachmentsInline(state.attachments);
    renderAttachmentsPanel(state.attachments);

    const hint = $("composerHint");
    if (hint) {
      hint.textContent = state.attachments.length ? `${state.attachments.length} allegato/i selezionato/i` : "—";
    }
  }

  // Renderizza la cronologia della conversazione nell’area chat.
  // Gestisce sia lo stato vuoto iniziale sia la lista dei messaggi utente/assistente.
  function renderChat(messages) {
    const empty = $("chatEmpty");
    const list = $("chatList");
    if (!empty || !list) return;

    if (!messages.length) {
      empty.classList.remove("hidden");
      list.classList.add("hidden");
      list.innerHTML = "";
      setChatSubtitle(messages);
      return;
    }

    empty.classList.add("hidden");
    list.classList.remove("hidden");

    const html = messages
      .map((m) => {
        const isUser = m.role === "user";
        const align = isUser ? "justify-end" : "justify-start";
        const bubble = isUser ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-900";

        const meta = m.meta || null;
        const docInfo =
          meta && meta.attachmentsUsed
            ? `<div class="mt-2 text-[11px] ${isUser ? "text-blue-100" : "text-slate-500"}">
                 Documenti elaborati: ${escapeHtml(String(meta.attachmentsUsed))}
               </div>`
            : "";

        return `
          <div class="flex ${align}">
            <div class="max-w-[92%] sm:max-w-[80%] rounded-2xl px-4 py-3 ${bubble} shadow-sm">
              <div class="text-sm leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(m.content)}</div>
              ${docInfo}
              <div class="mt-2 text-[11px] ${isUser ? "text-blue-100" : "text-slate-500"}">${escapeHtml(fmtTime(m.ts))}</div>
            </div>
          </div>
        `;
      })
      .join("");

    list.innerHTML = html;
    setChatSubtitle(messages);

    const scroll = $("chatScroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  // Attende che il sistema modale condiviso sia pronto prima di usarlo.
  async function ensureModalReady(timeoutMs = 8000) {
    const start = Date.now();
    while (!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function")) {
      await new Promise((r) => setTimeout(r, 50));
      if (Date.now() - start > timeoutMs) break;
    }
    return !!(APL.ui && APL.ui.modal && typeof APL.ui.modal.open === "function");
  }

  // Mostra una richiesta di conferma tramite modale, con fallback a `window.confirm`.
  async function confirmAction(title, message, confirmLabel) {
    const ok = await ensureModalReady();
    if (!ok) return window.confirm(message || "Confermare?");

    return await new Promise((resolve) => {
      APL.ui.modal.open({
        title: title || "Conferma",
        bodyHtml: `<div class="text-sm text-slate-700 leading-relaxed">${escapeHtml(message || "")}</div>`,
        actions: [
          { label: "Annulla", kind: "secondary", closeOnClick: true, onClick: () => resolve(false) },
          { label: confirmLabel || "Conferma", kind: "primary", closeOnClick: true, onClick: () => resolve(true) },
        ],
      });
    });
  }

  // Mostra un avviso tramite modale, con fallback a un toast di errore.
  async function alertAction(title, message) {
    const ok = await ensureModalReady();
    if (!ok) {
      APL.utils.toast(message || "Operazione non riuscita.", "error");
      return;
    }

    return await new Promise((resolve) => {
      APL.ui.modal.open({
        title: title || "Avviso",
        bodyHtml: `<div class="text-sm text-slate-700 leading-relaxed">${escapeHtml(message || "")}</div>`,
        actions: [{ label: "OK", kind: "primary", closeOnClick: true, onClick: () => resolve(true) }],
      });
    });
  }

  // Costruisce il contesto finale da inviare all’assistente.
  // Combina il contesto inserito manualmente con la cronologia recente, se richiesta.
  function buildContextForRequest() {
    const baseContext = String($("contextInput")?.value || "").trim();
    const includeHistory = !!$("toggleHistory")?.checked;

    let ctx = baseContext;

    if (includeHistory && state.chat.length) {
      const hist = safeHistoryForContext(state.chat.slice(-8), 3000);
      if (hist) ctx = ctx ? `${ctx}\n\n---\n\n${hist}` : hist;
    }

    return clampText(ctx, 6000);
  }

  // Esegue i controlli preliminari prima dell’invio:
  // domanda presente, assenza di PII evidente, formato e dimensione allegati.
  function validateBeforeSend(question, contextText) {
    const q = String(question || "").trim();
    const c = String(contextText || "").trim();

    if (!q) {
      APL.utils.toast("Inserire una domanda per procedere.", "error");
      return false;
    }

    if (likelyPII(q) || likelyPII(c)) {
      APL.utils.toast("Rimuovere riferimenti identificativi diretti e riprovare.", "error");
      return false;
    }

    for (const f of state.attachments) {
      const name = String(f.name || "").toLowerCase();
      const okExt = name.endsWith(".pdf") || name.endsWith(".docx") || name.endsWith(".txt") || name.endsWith(".md");
      if (!okExt) {
        APL.utils.toast("Uno o più allegati non sono in un formato supportato.", "error");
        return false;
      }
      if ((f.size || 0) > 2 * 1024 * 1024) {
        APL.utils.toast("Uno o più allegati risultano troppo grandi.", "error");
        return false;
      }
    }

    return true;
  }

  // Aggiunge un messaggio alla conversazione locale, lo persiste e aggiorna la UI.
  function appendMessage(role, content, meta) {
    const msg = {
      id: uid(),
      role,
      content: String(content || ""),
      ts: new Date().toISOString(),
      meta: meta || null,
    };
    state.chat.push(msg);
    saveChat(state.chat);
    renderChat(state.chat);
    return msg;
  }

  // Svuota completamente la conversazione corrente sia in memoria sia nello storage.
  function clearConversation() {
    state.chat = [];
    saveChat(state.chat);
    renderChat(state.chat);
  }

  // Esporta la conversazione corrente in formato testo.
  // Include anche il contesto clinico, se presente.
  function exportConversation() {
    const lines = [];
    lines.push("Healthcare Portal — Assistente AI");
    lines.push(`Esportazione: ${fmtTime(new Date().toISOString())}`);
    lines.push("");

    const ctx = String($("contextInput")?.value || "").trim();
    if (ctx) {
      lines.push("Contesto clinico:");
      lines.push(ctx);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    for (const m of state.chat) {
      const who = m.role === "user" ? "Clinician" : "Assistente";
      lines.push(`[${fmtTime(m.ts)}] ${who}`);
      lines.push(String(m.content || ""));
      lines.push("");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "assistente-ai_conversazione.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // AbortController attualmente attivo, usato per interrompere manualmente la richiesta in corso.
  let activeAbort = null;

  // Costruisce ed esegue l’invio della richiesta all’assistente AI.
  async function sendMessage() {
    clearError();

    const questionEl = $("questionInput");
    const question = String(questionEl?.value || "").trim();
    const contextText = buildContextForRequest();

    if (!validateBeforeSend(question, contextText)) return;

    // Il messaggio utente viene aggiunto subito alla chat locale.
    appendMessage("user", question);

    if (questionEl) questionEl.value = "";

    // La richiesta viene inviata come multipart per supportare eventuali allegati.
    const form = new FormData();
    form.append("question", question);
    if (contextText) form.append("context", contextText);

    const attachmentsCount = state.attachments.length;
    for (const f of state.attachments) {
      form.append("attachments", f, f.name);
    }

    // Dopo aver preparato il payload, gli allegati selezionati vengono rimossi dalla UI corrente.
    state.attachments = [];
    refreshAttachmentsUI();

    setLoading(true);

    activeAbort = new AbortController();
    try {
      const res = await requestMultipart(AI_URL, form, activeAbort.signal);

      if (!res.ok) {
        if (res.status === 401) {
          try { APL.session.clearAuth(); } catch (_) { }
          if (APL.auth?.redirectToSessionExpired) APL.auth.redirectToSessionExpired();
          throw new Error("Sessione scaduta.");
        }

        if (res.status === 403) {
          if (APL.auth?.redirectToForbidden) APL.auth.redirectToForbidden();
          throw new Error("Accesso non autorizzato.");
        }

        const code = String(res.data?.code || "").toLowerCase();
        if (code === "pii_not_allowed") {
          await alertAction(
            "Contenuto non ammesso",
            "Il testo non deve contenere riferimenti identificativi diretti. Rimuova tali dati e riprovi."
          );
          throw new Error("Contenuto non ammesso.");
        }

        const msg = APL.utils.parseErrorMessage(res.data) || "Impossibile completare l’operazione.";
        await alertAction("Operazione non riuscita", msg);
        throw new Error(msg);
      }

      const answer = String(res.data?.answer || "").trim() || "—";
      const used = (res.data?.attachments && typeof res.data.attachments.count === "number")
        ? String(res.data.attachments.count)
        : (attachmentsCount ? String(attachmentsCount) : "");

      appendMessage("assistant", answer, { attachmentsUsed: used || null });

      APL.utils.toast("Risposta ricevuta.", "success");
    } catch (err) {
      if (String(err?.name || "") === "AbortError") {
        APL.utils.toast("Operazione interrotta.", "info");
      } else {
        showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
      }
    } finally {
      activeAbort = null;
      setLoading(false);
    }
  }

  // Collega tutti i controlli della pagina ai relativi comportamenti applicativi.
  function wireEvents() {
    const btnSend = $("btnSend");
    if (btnSend) btnSend.addEventListener("click", sendMessage);

    // Supporta l’invio rapido da tastiera con Ctrl/Cmd + Invio.
    const q = $("questionInput");
    if (q) {
      q.addEventListener("keydown", (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
          ev.preventDefault();
          sendMessage();
        }
      });
    }

    // Permette all’utente di interrompere una richiesta in corso.
    const btnStop = $("btnStop");
    if (btnStop) {
      btnStop.addEventListener("click", () => {
        if (activeAbort) activeAbort.abort();
      });
    }

    // Gestisce la selezione dei file, evitando duplicati e limitando il set finale a 5 allegati.
    const fileInput = $("fileInput");
    if (fileInput) {
      fileInput.addEventListener("change", () => {
        const files = Array.from(fileInput.files || []);
        if (!files.length) return;

        const merged = [...state.attachments, ...files];
        const unique = [];
        const seen = new Set();

        for (const f of merged) {
          const key = `${f.name}-${f.size}-${f.lastModified}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(f);
        }

        state.attachments = unique.slice(0, 5);
        fileInput.value = "";
        refreshAttachmentsUI();
      });
    }

    // Rimuove tutti gli allegati attualmente selezionati.
    const btnClearAttachments = $("btnClearAttachments");
    if (btnClearAttachments) {
      btnClearAttachments.addEventListener("click", () => {
        state.attachments = [];
        refreshAttachmentsUI();
        APL.utils.toast("Allegati rimossi.", "success");
      });
    }

    // Salva in tempo reale il contesto clinico nello storage locale.
    const ctx = $("contextInput");
    if (ctx) {
      ctx.addEventListener("input", () => saveContext(ctx.value || ""));
    }

    // Pulisce completamente il contesto clinico inserito.
    const btnClearContext = $("btnClearContext");
    if (btnClearContext && ctx) {
      btnClearContext.addEventListener("click", () => {
        ctx.value = "";
        saveContext("");
        APL.utils.toast("Contesto rimosso.", "success");
      });
    }

    // Avvia una nuova conversazione previa conferma dell’utente.
    const btnNew = $("btnNewConversation");
    if (btnNew) {
      btnNew.addEventListener("click", async () => {
        const ok = await confirmAction(
          "Nuova conversazione",
          "Vuole avviare una nuova conversazione? La chat corrente verrà rimossa.",
          "Avvia"
        );
        if (!ok) return;
        clearConversation();
        APL.utils.toast("Nuova conversazione pronta.", "success");
      });
    }

    // Esporta la chat corrente in un file di testo.
    const btnExport = $("btnExport");
    if (btnExport) btnExport.addEventListener("click", exportConversation);
  }

  // Stato locale della pagina:
  // - chat: cronologia della conversazione corrente;
  // - attachments: allegati selezionati ma non ancora inviati.
  const state = {
    chat: [],
    attachments: [],
  };

  // Inizializza la pagina Assistente AI al caricamento del DOM.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    // Blocca l’uso della pagina se l’utente non è autenticato
    // o non appartiene al ruolo Clinician.
    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    const ctx = $("contextInput");
    if (ctx) ctx.value = loadContext();

    state.chat = loadChat();
    renderChat(state.chat);

    refreshAttachmentsUI();
    wireEvents();

    // Porta il focus sul compositore per rendere immediato l’avvio della conversazione.
    const q = $("questionInput");
    if (q) q.focus();

    const hint = $("composerHint");
    if (hint) hint.textContent = "—";
  }

  // Avvia l’inizializzazione quando il documento è pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
