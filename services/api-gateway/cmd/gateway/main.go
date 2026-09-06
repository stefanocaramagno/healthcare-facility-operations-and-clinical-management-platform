/*
 * File: services/api-gateway/cmd/gateway/main.go
 *
 * Scopo
 * -----
 * Avviare il processo principale dell'API Gateway, caricando la configurazione,
 * costruendo il router HTTP e inizializzando il server di ascolto.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file rappresenta l'entry point eseguibile del gateway.
 * Il gateway costituisce il punto di ingresso unico delle richieste API
 * provenienti dal frontend e applica responsabilità trasversali prima
 * dell'inoltro verso i servizi backend competenti.
 *
 * Responsabilità principali
 * -------------------------
 * - Caricare la configurazione runtime del gateway.
 * - Costruire il router HTTP con middleware e instradamento delle richieste.
 * - Inizializzare e avviare il server HTTP.
 * - Gestire il fallimento di avvio in modo esplicito e tracciabile.
 *
 * Interazioni principali
 * ----------------------
 * - internal/config per il caricamento della configurazione.
 * - internal/http per la costruzione del router applicativo.
 * - net/http per il server HTTP standard Go.
 *
 * Note
 * ----
 * Questo file non contiene logica di business: si occupa esclusivamente
 * del bootstrap del processo del gateway.
 */

package main

import (
	"log"
	"net/http"
	"time"

	"apl/api-gateway/internal/config"
	httpserver "apl/api-gateway/internal/http"
)

func main() {
	// Carica la configurazione runtime del gateway, inclusi porta,
	// parametri di sicurezza e informazioni sui servizi downstream.
	cfg := config.Load()

	// Costruisce il server HTTP associando:
	// - l'indirizzo di ascolto ricavato dalla configurazione;
	// - il router applicativo che gestisce middleware e dispatch;
	// - un timeout sui soli header per ridurre il rischio di connessioni lente.
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpserver.NewRouter(cfg),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Registra nei log l'indirizzo effettivo su cui il gateway si mette in ascolto.
	log.Printf("api-gateway listening on %s", srv.Addr)

	// Avvia il server HTTP.
	// Un errore diverso dalla chiusura intenzionale del server viene considerato fatale
	// perché impedisce il corretto funzionamento dell'intero punto di ingresso API.
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("listen: %v", err)
	}
}
