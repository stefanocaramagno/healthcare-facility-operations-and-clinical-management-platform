/*
 * File: services/api-gateway/internal/middleware/logging.go
 *
 * Scopo
 * -----
 * Registrare nei log le informazioni essenziali di ogni richiesta HTTP
 * transitata dal gateway, includendo esito, metodo, percorso, latenza
 * e identificativo tecnico della richiesta.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo middleware contribuisce all'osservabilità del gateway,
 * permettendo di tracciare il comportamento delle richieste in ingresso
 * e di correlare i log con il request ID assegnato nella pipeline.
 *
 * Responsabilità principali
 * -------------------------
 * - Misurare la durata complessiva della richiesta.
 * - Acquisire metodo e path richiesti.
 * - Recuperare lo status HTTP finale restituito al client.
 * - Includere nei log il request ID già presente nel contesto.
 * - Produrre una traccia sintetica utile a debugging e monitoraggio.
 *
 * Interazioni principali
 * ----------------------
 * - Contesto Gin della richiesta.
 * - Middleware RequestID, da cui recupera l'identificativo tecnico.
 * - Logger standard della libreria Go.
 *
 * Note
 * ----
 * Il middleware registra i dati al termine della richiesta,
 * così da poter loggare sia lo status finale sia la latenza effettiva.
 */

package middleware

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// Logging crea un middleware che registra una riga di log sintetica
// per ogni richiesta gestita dal gateway.
func Logging() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Memorizza l'istante iniziale per misurare la latenza complessiva della richiesta.
		start := time.Now()

		// Acquisisce subito metodo HTTP e path richiesto,
		// così da conservarne il valore originario per il log finale.
		path := c.Request.URL.Path
		method := c.Request.Method

		// Esegue il resto della pipeline HTTP:
		// middleware successivi, handler locali o proxy verso i servizi downstream.
		c.Next()

		// Recupera lo status HTTP finale scritto nella risposta.
		status := c.Writer.Status()

		// Calcola il tempo totale impiegato per servire la richiesta.
		latency := time.Since(start)

		// Recupera il request ID, se presente nel contesto,
		// per facilitare la correlazione dei log tra componenti distribuiti.
		rid, _ := c.Get(RequestIDContextKey)

		// Scrive una riga di log strutturata in formato chiave=valore,
		// utile per analisi manuale o raccolta centralizzata dei log.
		log.Printf(
			"status=%d method=%s path=%s latency=%s request_id=%v\n",
			status,
			method,
			path,
			latency,
			rid,
		)
	}
}
