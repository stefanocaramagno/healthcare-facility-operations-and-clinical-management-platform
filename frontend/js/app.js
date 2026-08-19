/**
 * File: frontend/js/app.js
 *
 * Scopo
 * -----
 * Gestire il caricamento dello stato di salute applicativo esposto dall’endpoint
 * `/api/health`, aggiornando l’interfaccia con il payload ricevuto, l’ultimo
 * timestamp di aggiornamento e l’eventuale messaggio di errore.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo script abilita una piccola vista di monitoraggio lato front-end utile
 * a verificare rapidamente la raggiungibilità del gateway / back-end e a mostrare
 * il contenuto restituito dal controllo di health in formato leggibile.
 *
 * Responsabilità principali
 * -------------------------
 * - recuperare i riferimenti agli elementi DOM necessari alla vista;
 * - invocare l’endpoint di health tramite `fetch`;
 * - interpretare la risposta come JSON quando possibile, mantenendo un fallback
 *   testuale in caso di payload non JSON;
 * - aggiornare l’area di output con il contenuto restituito;
 * - mostrare eventuali errori HTTP o di rete in un contenitore dedicato;
 * - registrare l’istante dell’ultimo tentativo di aggiornamento;
 * - collegare il pulsante di refresh al ricaricamento manuale dei dati.
 *
 * Interazioni principali
 * ----------------------
 * - interagisce con il DOM tramite gli elementi `output`, `lastUpdate`,
 *   `errorBox` e `refreshBtn`;
 * - interroga l’endpoint HTTP `/api/health` pubblicato dal sistema;
 * - utilizza `fetch` per la richiesta asincrona e `toLocaleString` per la
 *   formattazione della data/ora secondo il fuso Europe/Rome.
 *
 * Note
 * ----
 * Lo script è racchiuso in una IIFE asincrona per evitare di esporre variabili
 * nel global scope e per consentire il caricamento iniziale dei dati subito
 * dopo l’inizializzazione della pagina.
 */

(async function () {
  // Recupera i principali riferimenti DOM usati per mostrare risultato, errori e timestamp.
  const output = document.getElementById("output");
  const lastUpdate = document.getElementById("lastUpdate");
  const errorBox = document.getElementById("errorBox");
  const refreshBtn = document.getElementById("refreshBtn");

  // Esegue il caricamento dello stato di health del sistema e aggiorna la UI
  // in base all’esito della richiesta.
  async function loadHealth() {
    // Reimposta lo stato visivo iniziale prima di avviare una nuova richiesta.
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
    output.textContent = "Loading...";

    try {
      // Interroga l’endpoint di health richiedendo preferibilmente un payload JSON.
      const res = await fetch("/api/health", { headers: { "Accept": "application/json" } });

      // La risposta viene prima acquisita come testo per poter gestire in modo robusto
      // sia payload JSON sia eventuali risposte non perfettamente serializzate.
      const text = await res.text();

      let json;

      // Prova a interpretare la risposta come JSON; in caso contrario conserva il testo raw.
      try { json = JSON.parse(text); } catch { json = { raw: text }; }

      // In presenza di status HTTP non positivo, solleva un errore esplicativo
      // includendo il contenuto della risposta per facilitare il debug.
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(json, null, 2)}`);
      }

      // Mostra il payload in formato leggibile e aggiorna il timestamp dell’ultimo refresh riuscito.
      output.textContent = JSON.stringify(json, null, 2);
      lastUpdate.textContent = new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" });
    } catch (err) {
      // In caso di errore di rete, parsing o HTTP, svuota l’output principale
      // e rende visibile il contenitore dedicato al messaggio d’errore.
      output.textContent = "";
      errorBox.textContent = String(err);
      errorBox.classList.remove("hidden");

      // Anche in caso di errore viene aggiornato il timestamp dell’ultimo tentativo effettuato.
      lastUpdate.textContent = new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" });
    }
  }

  // Consente all’utente di richiedere manualmente un nuovo controllo di health.
  refreshBtn.addEventListener("click", loadHealth);

  // Esegue un primo caricamento automatico all’apertura della pagina.
  await loadHealth();
})();
