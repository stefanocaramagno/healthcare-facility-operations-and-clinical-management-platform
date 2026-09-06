/**
 * File: frontend/js/admin/delegate-detail.js
 *
 * Scopo
 * -----
 * Gestire il caricamento, la visualizzazione e il salvataggio della scheda
 * amministrativa del delegato, includendo sia la consultazione/modifica
 * dell’anagrafica esistente sia la creazione iniziale di un nuovo delegato.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script costituisce la logica client-side della pagina di dettaglio
 * del delegato nell’area Admin. Si integra con i moduli condivisi del front-end
 * per verificare il ruolo dell’utente autenticato, interrogare gli endpoint
 * protetti, popolare i campi anagrafici e gestire le operazioni di creazione,
 * aggiornamento e consultazione delle deleghe collegate.
 *
 * Responsabilità principali
 * -------------------------
 * - determinare se la pagina è in modalità creazione o dettaglio;
 * - recuperare l’identificativo del delegato dalla query string;
 * - caricare profilo anagrafico e deleghe associate;
 * - popolare e aggiornare l’interfaccia della scheda;
 * - validare i dati anagrafici e dell’account in modalità create;
 * - creare un nuovo delegato oppure aggiornare un profilo esistente;
 * - consentire l’aggiornamento di stato e ambito delle deleghe associate;
 * - mostrare stati di caricamento, errori globali e messaggi di conferma.
 *
 * Interazioni principali
 * ----------------------
 * - utilizza `APL.auth.requireAuth` per proteggere la pagina;
 * - utilizza `APL.session.authHeader` per costruire gli header autenticati;
 * - utilizza `APL.utils.readQuery`, `APL.utils.requestJson`,
 *   `APL.utils.parseApiDate`, `APL.utils.parseErrorMessage`,
 *   `APL.utils.humanizeError`, `APL.utils.setLoading` e `APL.utils.toast`;
 * - interagisce con gli endpoint:
 *   `/api/registry/admin/delegates`,
 *   `/api/registry/admin/delegates/{userId}/profile`,
 *   `/api/registry/admin/delegates/{userId}/delegations`,
 *   `/api/registry/admin/delegations/{delegationId}/status`,
 *   `/api/registry/admin/delegations/{delegationId}/permissions`;
 * - aggiorna dinamicamente il DOM della pagina di dettaglio delegato.
 *
 * Note
 * ----
 * Il file è racchiuso in una IIFE per evitare l’inquinamento del global scope.
 * La pagina supporta due modalità operative:
 * - creazione di un nuovo delegato con account iniziale;
 * - visualizzazione/modifica dell’anagrafica di un delegato esistente,
 *   con consultazione e aggiornamento delle deleghe associate.
 */

(function () {
  "use strict";

  // Ruolo richiesto per poter accedere correttamente alla pagina.
  const EXPECTED_ROLE = "Admin";

  // Endpoint base per la creazione di un nuovo delegato.
  const API_CREATE_DELEGATE = "/api/registry/admin/delegates";

  // Endpoint del profilo anagrafico del delegato.
  const API_DELEGATE_PROFILE = (userId) => `/api/registry/admin/delegates/${userId}/profile`;

  // Endpoint che restituisce l’elenco delle deleghe associate al delegato.
  const API_DELEGATE_DELEGATIONS = (userId) => `/api/registry/admin/delegates/${userId}/delegations`;

  // Endpoint per l’aggiornamento dello stato di una delega.
  const API_UPDATE_DELEGATION_STATUS = (delegationId) => `/api/registry/admin/delegations/${delegationId}/status`;

  // Endpoint per l’aggiornamento dell’ambito/permessi di una delega.
  const API_UPDATE_DELEGATION_PERMISSIONS = (delegationId) => `/api/registry/admin/delegations/${delegationId}/permissions`;

  // Stato locale principale della pagina.
  let _userId = "";
  let _profile = null;
  let _delegations = [];
  let _requestSeq = 0;
  let _isCreateMode = false;

  // Restituisce un elemento DOM tramite il suo id.
  function $(id) {
    return document.getElementById(id);
  }

  // Mostra un messaggio di errore nel contenitore globale della pagina.
  function showError(message) {
    const box = $("pageError");
    if (!box) return;

    // Imposta il testo dell’errore e rende visibile il relativo contenitore.
    box.textContent = message || "Si è verificato un errore imprevisto.";
    box.classList.remove("hidden");
  }

  // Ripulisce e nasconde il contenitore globale degli errori.
  function clearError() {
    const box = $("pageError");
    if (!box) return;

    // Ripristina il contenuto e lo stato iniziale del box errori.
    box.textContent = "";
    box.classList.add("hidden");
  }

  // Aggiorna gli indicatori di caricamento e abilita/disabilita i controlli della pagina.
  function setLoading(loading) {
    const badge = $("loadingBadge");
    if (badge) badge.classList.toggle("hidden", !loading);

    // Blocca il pulsante principale durante operazioni asincrone.
    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) btnSaveProfile.disabled = !!loading;

    // Disabilita i campi del form per evitare modifiche concorrenti durante il salvataggio/caricamento.
    const fieldIds = [
      "firstName",
      "lastName",
      "phone",
      "address",
      "email",
      "password",
    ];

    for (const id of fieldIds) {
      const el = $(id);
      if (el) el.disabled = !!loading;
    }
  }

  // Abilita o disabilita visivamente e funzionalmente una sezione della pagina.
  function setSectionEnabled(sectionId, enabled) {
    const sec = $(sectionId);
    if (!sec) return;

    // Applica uno stato attenuato e blocca le interazioni quando la sezione è disabilitata.
    sec.classList.toggle("opacity-60", !enabled);
    sec.classList.toggle("pointer-events-none", !enabled);
  }

  // Normalizza una stringa che potrebbe rappresentare un GUID.
  function normalizeGuidCandidate(value) {
    let v = String(value || "").trim();
    if (!v) return "";

    // Supporta anche GUID racchiusi tra parentesi graffe.
    if (v.startsWith("{") && v.endsWith("}")) v = v.slice(1, -1).trim();
    return v;
  }

  // Verifica se il valore passato ha un formato GUID valido.
  function isGuid(value) {
    const v = normalizeGuidCandidate(value);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  }

  // Legge dalla query string l’identificativo del delegato usando più possibili alias.
  function readUserIdFromUrl() {
    const qs = APL.utils.readQuery();
    const keys = ["userId", "userid", "id", "delegateUserId", "delegateId"];

    // Scorre i nomi parametro supportati e restituisce il primo GUID valido trovato.
    for (const k of keys) {
      const raw = qs.get(k);
      const v = normalizeGuidCandidate(raw);
      if (isGuid(v)) return v;
    }
    return "";
  }

  // Determina se la pagina è stata aperta in modalità di creazione.
  function readCreateModeFromUrl() {
    const qs = APL.utils.readQuery();
    const mode = String(qs.get("mode") || "").trim().toLowerCase();
    const action = String(qs.get("action") || "").trim().toLowerCase();
    return mode === "create" || action === "create";
  }

  // Verifica la presenza del flag `created` nella query string.
  function hasCreatedFlag() {
    const qs = APL.utils.readQuery();
    const raw = String(qs.get("created") || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  }

  // Rimuove dalla URL il flag `created` dopo che è stato consumato.
  function consumeCreatedFlag() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("created")) return;

    url.searchParams.delete("created");
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  // Esegue l’escape HTML di una stringa per un inserimento sicuro nel markup.
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Converte una data ISO UTC in una stringa data leggibile.
  function fmtDate(isoUtc) {
    if (!isoUtc) return "—";

    const d = APL.utils.parseApiDate(isoUtc);
    if (!d) return "—";

    return d.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  // Converte una data ISO UTC in una stringa data/ora leggibile.
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

  // Esegue una richiesta JSON autenticata e gestisce i principali casi applicativi di errore.
  async function apiJson(method, url, json) {
    const res = await APL.utils.requestJson(url, {
      method,
      headers: { Accept: "application/json", ...APL.session.authHeader() },
      json,
    });

    // Se la risposta non è positiva, gestisce sessione scaduta, accesso negato e altri errori.
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

      // Costruisce un errore arricchito con le informazioni restituite dal back-end.
      const msg = APL.utils.parseErrorMessage(res.data) || "Operazione non riuscita.";
      const err = new Error(msg);
      err.status = res.status;
      err.data = res.data;
      err.requestId = res.requestId;
      throw err;
    }

    return res.data;
  }

  // Imposta il testo di un elemento identificato da id.
  function setText(id, value) {
    const el = $(id);
    if (!el) return;
    el.textContent = value ?? "—";
  }

  // Imposta il valore di un campo input identificato da id.
  function setValue(id, value) {
    const el = $(id);
    if (!el) return;
    el.value = value ?? "";
  }

  // Mostra o nasconde un elemento in base al valore booleano passato.
  function toggleHidden(id, hidden) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("hidden", !!hidden);
  }

  // Normalizza il payload del profilo delegato proveniente dall’API.
  function normalizeProfile(x) {
    return {
      id: x?.id ?? x?.Id ?? "",
      userId: x?.userId ?? x?.UserId ?? "",
      firstName: x?.firstName ?? x?.FirstName ?? "",
      lastName: x?.lastName ?? x?.LastName ?? "",
      phone: x?.phone ?? x?.Phone ?? "",
      address: x?.address ?? x?.Address ?? "",
    };
  }

  // Normalizza il payload di una delega proveniente dall’API.
  function normalizeDelegation(x) {
    return {
      id: x?.id ?? x?.Id ?? "",
      patientUserId: x?.patientUserId ?? x?.PatientUserId ?? "",
      delegateUserId: x?.delegateUserId ?? x?.DelegateUserId ?? "",
      scope: x?.scope ?? x?.Scope ?? "",
      status: x?.status ?? x?.Status ?? "",
      startsAtUtc: x?.startsAtUtc ?? x?.StartsAtUtc ?? "",
      endsAtUtc: x?.endsAtUtc ?? x?.EndsAtUtc ?? "",
      createdAtUtc: x?.createdAtUtc ?? x?.CreatedAtUtc ?? "",
    };
  }

  // Costruisce il nome visualizzato del delegato a partire dal profilo.
  function delegateDisplayName(profile) {
    const firstName = String(profile?.firstName || "").trim();
    const lastName = String(profile?.lastName || "").trim();
    const full = `${firstName} ${lastName}`.trim();
    return full || "Dettaglio delegato";
  }

  // Traduce il valore tecnico dello scope in una descrizione leggibile.
  function scopeLabel(scope) {
    const s = String(scope || "");
    if (/^ManageAppointments$/i.test(s)) return "Gestione appuntamenti";
    if (/^ManagePayments$/i.test(s)) return "Gestione pagamenti";
    if (/^ReadOnly$/i.test(s)) return "Solo lettura";
    return "—";
  }

  // Traduce lo stato tecnico della delega in etichetta e categoria grafica.
  function statusLabel(status) {
    const s = String(status || "");
    if (/^Active$/i.test(s)) return { label: "Attiva", kind: "success" };
    if (/^Pending$/i.test(s)) return { label: "In attesa", kind: "info" };
    if (/^Revoked$/i.test(s)) return { label: "Revocata", kind: "muted" };
    if (/^Expired$/i.test(s)) return { label: "Scaduta", kind: "muted" };
    return { label: "—", kind: "muted" };
  }

  // Costruisce il badge HTML che rappresenta lo stato della delega.
  function statusPill(status) {
    const { label, kind } = statusLabel(status);

    if (kind === "success") {
      return `<span class="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"><span class="h-2 w-2 rounded-full bg-emerald-600"></span>${escapeHtml(label)}</span>`;
    }

    if (kind === "info") {
      return `<span class="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"><span class="h-2 w-2 rounded-full bg-blue-600"></span>${escapeHtml(label)}</span>`;
    }

    return `<span class="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"><span class="h-2 w-2 rounded-full bg-slate-500"></span>${escapeHtml(label)}</span>`;
  }

  // Applica alla UI la modalità corrente della pagina: creazione o dettaglio esistente.
  function applyModeUi() {
    const subtitle = _isCreateMode
      ? "Inserimento di un nuovo delegato con creazione contestuale di account e anagrafica."
      : "Visualizzazione e gestione delle informazioni principali e delle deleghe associate.";

    // Aggiorna testi, identificativi e messaggi contestuali della testata.
    setText("delegateSubtitle", subtitle);
    setText("delegateTitleName", _isCreateMode ? "Nuovo delegato" : delegateDisplayName(_profile));
    setText("delegateUserId", _isCreateMode ? "Disponibile dopo la creazione" : (_userId || "—"));
    setText("delegateProfileId", _isCreateMode ? "Disponibile dopo la creazione" : (_profile?.id ? String(_profile.id) : "—"));

    const hint = $("profileHint");
    if (hint) {
      hint.textContent = _isCreateMode
        ? "Compili i dati di accesso e l’anagrafica per registrare il nuovo delegato."
        : "Le informazioni anagrafiche non risultano ancora complete. È possibile inserirle e salvare la scheda.";
      hint.classList.toggle("hidden", !_isCreateMode && !!_profile);
    }

    // Aggiorna il testo del pulsante principale di salvataggio.
    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) btnSaveProfile.textContent = _isCreateMode ? "Crea delegato" : "Salva profilo";

    // Aggiorna la nota informativa sulla modalità corrente.
    const notesBox = $("saveInfoText");
    if (notesBox) {
      notesBox.textContent = _isCreateMode
        ? "La registrazione crea il nuovo account delegato e l’anagrafica in un’unica operazione."
        : "Le modifiche vengono applicate solo dopo il salvataggio.";
    }

    // Mostra o nasconde le sezioni pertinenti alla modalità operativa corrente.
    toggleHidden("accountSection", !_isCreateMode);
    toggleHidden("createModeNotice", !_isCreateMode);
    toggleHidden("sectionDelegations", _isCreateMode);
  }

  // Aggiorna intestazione e identificativi usando i dati del profilo corrente.
  function setHeaderFromProfile() {
    if (_isCreateMode) {
      applyModeUi();
      return;
    }

    setText("delegateUserId", _userId || "—");
    setText("delegateProfileId", _profile?.id ? String(_profile.id) : "—");
    setText("delegateTitleName", delegateDisplayName(_profile));

    // Mostra il suggerimento di completamento profilo solo quando il profilo non è disponibile.
    const hint = $("profileHint");
    if (hint) {
      hint.textContent = "Le informazioni anagrafiche non risultano ancora complete. È possibile inserirle e salvare la scheda.";
      hint.classList.toggle("hidden", !!_profile);
    }
  }

  // Compila i campi del form anagrafico con i dati del profilo corrente.
  function fillProfileForm() {
    setValue("firstName", _profile?.firstName ? String(_profile.firstName) : "");
    setValue("lastName", _profile?.lastName ? String(_profile.lastName) : "");
    setValue("phone", _profile?.phone ? String(_profile.phone) : "");
    setValue("address", _profile?.address ? String(_profile.address) : "");

    // In modalità creazione i dati di accesso partono sempre vuoti.
    if (_isCreateMode) {
      setValue("email", "");
      setValue("password", "");
    }
  }

  // Renderizza l’elenco delle deleghe associate al delegato corrente.
  function renderDelegations() {
    const tbody = $("delegationsTbody");
    const empty = $("delegationsEmpty");
    if (!tbody) return;

    const rows = Array.isArray(_delegations) ? _delegations : [];
    if (empty) empty.classList.toggle("hidden", rows.length > 0);

    // Se non esistono deleghe, mostra un placeholder testuale nella tabella.
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-600">Nessun elemento da mostrare.</td></tr>`;
      return;
    }

    const html = rows
      .slice()
      .sort((a, b) => (APL.utils.parseApiDate(b?.createdAtUtc)?.getTime() || 0) - (APL.utils.parseApiDate(a?.createdAtUtc)?.getTime() || 0))
      .map((d) => {
        const id = String(d?.id || "");
        const patientId = String(d?.patientUserId || "");
        const scope = scopeLabel(d?.scope);
        const status = String(d?.status || "");
        const startsAt = fmtDate(d?.startsAtUtc);
        const endsAt = fmtDate(d?.endsAtUtc);
        const created = fmtDateTime(d?.createdAtUtc);

        // Costruisce l’URL della scheda del paziente assistito.
        const patientUrl = new URL("./patient-detail.html", window.location.href);
        if (patientId) patientUrl.searchParams.set("userId", patientId);

        return `
          <tr>
            <td class="py-4 pr-4">
              <div class="font-medium text-slate-900 break-all">${escapeHtml(patientId || "—")}</div>
              <div class="mt-1 text-xs text-slate-500">Utente assistito</div>
            </td>

            <td class="py-4 pr-4 text-slate-700">${escapeHtml(scope)}</td>

            <td class="py-4 pr-4 text-slate-700">
              <div>Dal <span class="font-medium">${escapeHtml(startsAt)}</span></div>
              <div class="mt-1">Al <span class="font-medium">${escapeHtml(endsAt)}</span></div>
            </td>

            <td class="py-4 pr-4">${statusPill(status)}</td>
            <td class="py-4 pr-4 text-slate-700">${escapeHtml(created)}</td>

            <td class="py-4 text-right">
              <div class="flex flex-wrap items-center gap-2 justify-end">
                <a href="${escapeHtml(patientUrl.toString())}"
                  class="h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  Apri assistito
                </a>

                <select data-delegation-scope="${escapeHtml(id)}"
                  class="h-9 rounded-xl border bg-white px-3 text-xs text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  <option value="ReadOnly" ${/^ReadOnly$/i.test(String(d?.scope || "")) ? "selected" : ""}>Solo lettura</option>
                  <option value="ManageAppointments" ${/^ManageAppointments$/i.test(String(d?.scope || "")) ? "selected" : ""}>Gestione appuntamenti</option>
                  <option value="ManagePayments" ${/^ManagePayments$/i.test(String(d?.scope || "")) ? "selected" : ""}>Gestione pagamenti</option>
                </select>

                <select data-delegation-select="${escapeHtml(id)}"
                  class="h-9 rounded-xl border bg-white px-3 text-xs text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  <option value="Pending" ${/^Pending$/i.test(status) ? "selected" : ""}>In attesa</option>
                  <option value="Active" ${/^Active$/i.test(status) ? "selected" : ""}>Attiva</option>
                  <option value="Revoked" ${/^Revoked$/i.test(status) ? "selected" : ""}>Revocata</option>
                  <option value="Expired" ${/^Expired$/i.test(status) ? "selected" : ""}>Scaduta</option>
                </select>

                <button type="button" data-action="save-delegation" data-delegation-id="${escapeHtml(id)}"
                  class="h-9 inline-flex items-center rounded-xl border bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100">
                  Aggiorna
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    tbody.innerHTML = html;
  }

  // Legge e valida i campi del profilo anagrafico del delegato.
  function readProfileForm() {
    const firstName = String($("firstName")?.value || "").trim();
    const lastName = String($("lastName")?.value || "").trim();
    const phone = String($("phone")?.value || "").trim();
    const address = String($("address")?.value || "").trim();

    // Verifica la presenza dei campi anagrafici obbligatori.
    if (!firstName) return { ok: false, message: "Il nome è obbligatorio." };
    if (!lastName) return { ok: false, message: "Il cognome è obbligatorio." };

    return {
      ok: true,
      payload: {
        firstName,
        lastName,
        phone: phone || null,
        address: address || null,
      },
    };
  }

  // Verifica la validità sintattica minima di un indirizzo e-mail.
  function isValidEmail(value) {
    const email = String(value || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // Legge e valida i dati di accesso usati nella modalità di creazione del delegato.
  function readAccountForm() {
    const email = String($("email")?.value || "").trim();
    const password = String($("password")?.value || "").trim();

    // Verifica presenza e validità minima dei dati di accesso.
    if (!email) return { ok: false, message: "L’e-mail è obbligatoria." };
    if (!isValidEmail(email)) return { ok: false, message: "L’e-mail inserita non è valida." };
    if (!password) return { ok: false, message: "La password è obbligatoria." };
    if (password.length < 8) return { ok: false, message: "La password deve contenere almeno 8 caratteri." };

    return { ok: true, payload: { email, password } };
  }

  // Salva il profilo del delegato oppure crea un nuovo delegato in modalità create.
  async function saveProfile() {
    clearError();

    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) APL.utils.setLoading(btnSaveProfile, true, _isCreateMode ? "Creazione…" : "Salvataggio…");

    try {
      const profileRead = readProfileForm();
      if (!profileRead.ok) {
        APL.utils.toast(profileRead.message || "Verifichi i dati del profilo.", "error");
        return;
      }

      if (_isCreateMode) {
        const accountRead = readAccountForm();
        if (!accountRead.ok) {
          APL.utils.toast(accountRead.message || "Verifichi i dati di accesso.", "error");
          return;
        }

        // Combina dati di accesso e anagrafica per la creazione del nuovo delegato.
        const payload = {
          ...accountRead.payload,
          ...profileRead.payload,
        };

        const created = await apiJson("POST", API_CREATE_DELEGATE, payload);
        const newUserId = normalizeGuidCandidate(created?.userId ?? created?.UserId);

        if (!isGuid(newUserId)) {
          throw new Error("Creazione completata ma identificativo delegato non disponibile.");
        }

        // Reindirizza alla stessa pagina in modalità dettaglio, segnalando l’avvenuta creazione.
        const next = new URL(window.location.href);
        next.searchParams.delete("mode");
        next.searchParams.delete("action");
        next.searchParams.set("userId", newUserId);
        next.searchParams.set("created", "1");
        window.location.href = next.toString();
        return;
      }

      // In modalità dettaglio aggiorna il profilo esistente.
      const saved = await apiJson("PUT", API_DELEGATE_PROFILE(_userId), profileRead.payload);
      _profile = saved ? normalizeProfile(saved) : _profile;
      setHeaderFromProfile();
      fillProfileForm();

      APL.utils.toast("Profilo aggiornato correttamente.", "success");
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      if (btnSaveProfile) APL.utils.setLoading(btnSaveProfile, false);
    }
  }

  // Restituisce la delega locale associata all’identificativo specificato.
  function getDelegationById(delegationId) {
    const id = String(delegationId || "").trim();
    return (_delegations || []).find((x) => String(x?.id || "") === id) || null;
  }

  // Aggiorna nello stato locale una delega con la versione restituita dal back-end.
  function mergeDelegation(delegationId, updated) {
    const id = String(delegationId || "").trim();
    const idx = (_delegations || []).findIndex((x) => String(x?.id || "") === id);
    if (idx >= 0 && updated) _delegations[idx] = normalizeDelegation(updated);
  }

  // Salva le modifiche di stato e/o ambito per una delega associata al delegato.
  async function saveDelegationStatus(delegationId) {
    const id = String(delegationId || "").trim();
    if (!isGuid(id)) {
      APL.utils.toast("Elemento non disponibile.", "error");
      return;
    }

    const current = getDelegationById(id);
    if (!current) {
      APL.utils.toast("Elemento non disponibile.", "error");
      return;
    }

    // Recupera i controlli di selezione associati alla delega corrente.
    const statusSelect = document.querySelector(`select[data-delegation-select="${CSS.escape(id)}"]`);
    const scopeSelect = document.querySelector(`select[data-delegation-scope="${CSS.escape(id)}"]`);

    const newStatus = String(statusSelect?.value || "").trim();
    const newScope = String(scopeSelect?.value || "").trim();

    const currentStatus = String(current?.status || "").trim();
    const currentScope = String(current?.scope || "").trim();

    const statusChanged = !!newStatus && newStatus !== currentStatus;
    const scopeChanged = !!newScope && newScope !== currentScope;

    // Se non esistono variazioni da applicare, evita richieste inutili.
    if (!statusChanged && !scopeChanged) {
      APL.utils.toast("Nessuna modifica da applicare.", "info");
      return;
    }

    const btn = document.querySelector(`button[data-action="save-delegation"][data-delegation-id="${CSS.escape(id)}"]`);
    if (btn) APL.utils.setLoading(btn, true, "Aggiornamento…");

    try {
      let latest = current;

      // Applica prima l’eventuale variazione di scope.
      if (scopeChanged) {
        latest = await apiJson("PATCH", API_UPDATE_DELEGATION_PERMISSIONS(id), { scope: newScope });
        mergeDelegation(id, latest);
      }

      // Applica poi l’eventuale variazione di stato.
      if (statusChanged) {
        latest = await apiJson("PATCH", API_UPDATE_DELEGATION_STATUS(id), { status: newStatus });
        mergeDelegation(id, latest);
      }

      // Riesegue il rendering per mostrare i dati aggiornati.
      renderDelegations();

      if (scopeChanged && statusChanged) {
        APL.utils.toast("Permessi e stato aggiornati correttamente.", "success");
      } else if (scopeChanged) {
        APL.utils.toast("Permessi aggiornati correttamente.", "success");
      } else {
        APL.utils.toast("Stato aggiornato correttamente.", "success");
      }
    } catch (err) {
      showError(APL.utils.humanizeError(err) || "Operazione non riuscita.");
    } finally {
      if (btn) APL.utils.setLoading(btn, false);
    }
  }

  // Carica profilo e deleghe associate del delegato corrente.
  async function loadAll() {
    const requestId = ++_requestSeq;
    clearError();
    setLoading(true);

    try {
      const [profileRaw, delegationsRaw] = await Promise.all([
        apiJson("GET", API_DELEGATE_PROFILE(_userId)),
        apiJson("GET", API_DELEGATE_DELEGATIONS(_userId)),
      ]);

      // Se nel frattempo è partita un’altra richiesta, non aggiorna la UI.
      if (requestId !== _requestSeq) return;

      _profile = profileRaw ? normalizeProfile(profileRaw) : null;
      _delegations = (Array.isArray(delegationsRaw) ? delegationsRaw : []).map(normalizeDelegation);

      // Aggiorna testata, form e tabella deleghe.
      applyModeUi();
      setHeaderFromProfile();
      fillProfileForm();
      renderDelegations();

      setSectionEnabled("sectionProfile", true);
      setSectionEnabled("sectionDelegations", true);
    } catch (err) {
      if (requestId !== _requestSeq) return;
      showError(APL.utils.humanizeError(err) || "Impossibile caricare la scheda del delegato.");
      setSectionEnabled("sectionProfile", false);
      setSectionEnabled("sectionDelegations", false);
    } finally {
      if (requestId === _requestSeq) {
        setLoading(false);
      }
    }
  }

  // Collega gli handler degli eventi principali della pagina.
  function wireHandlers() {
    const btnSaveProfile = $("btnSaveProfile");
    if (btnSaveProfile) btnSaveProfile.addEventListener("click", () => saveProfile());

    const tbody = $("delegationsTbody");
    if (tbody) {
      tbody.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        const btn = t.closest("button[data-action]");
        if (!btn) return;

        const action = btn.getAttribute("data-action") || "";
        const id = btn.getAttribute("data-delegation-id") || "";

        if (action === "save-delegation") saveDelegationStatus(id);
      });
    }
  }

  // Mostra lo stato “scheda non disponibile” e nasconde il contenuto principale.
  function showMissingState() {
    const missing = $("missingState");
    const main = $("mainContent");
    if (missing) missing.classList.remove("hidden");
    if (main) main.classList.add("hidden");

    setSectionEnabled("sectionProfile", false);
    setSectionEnabled("sectionDelegations", false);
  }

  // Inizializza la pagina verificando ruolo, modalità operativa e dati da caricare.
  async function init() {
    if (!window.APL || !APL.session || !APL.utils || !APL.auth) return;

    const auth = APL.auth.requireAuth(EXPECTED_ROLE);
    if (!auth) return;

    // Determina modalità create/detail e identificativo delegato dalla URL.
    _isCreateMode = readCreateModeFromUrl();
    _userId = readUserIdFromUrl();

    wireHandlers();

    if (_isCreateMode) {
      // In modalità creazione prepara la UI senza effettuare caricamenti remoti del dettaglio.
      applyModeUi();
      fillProfileForm();
      setSectionEnabled("sectionProfile", true);
      if (hasCreatedFlag()) consumeCreatedFlag();
      return;
    }

    // Se non esiste uno userId valido in modalità dettaglio, mostra lo stato di errore contestuale.
    if (!_userId) {
      showMissingState();
      return;
    }

    // Se la pagina è stata raggiunta subito dopo una creazione, mostra il toast di conferma.
    if (hasCreatedFlag()) {
      consumeCreatedFlag();
      APL.utils.toast("Delegato registrato correttamente.", "success");
    }

    applyModeUi();
    await loadAll();
  }

  // Avvia l’inizializzazione della pagina quando il DOM è completamente pronto.
  document.addEventListener("DOMContentLoaded", init);
})();
