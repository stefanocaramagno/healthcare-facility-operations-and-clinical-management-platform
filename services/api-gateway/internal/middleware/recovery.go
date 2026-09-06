/*
 * File: services/api-gateway/internal/middleware/recovery.go
 *
 * Scopo
 * -----
 * Intercettare eventuali panic generati durante l'elaborazione di una richiesta
 * nel gateway e trasformarli in una risposta JSON controllata, evitando
 * l'interruzione anomala del processo.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo middleware contribuisce alla robustezza del gateway,
 * garantendo che errori imprevisti nella pipeline HTTP vengano gestiti
 * in modo uniforme, tracciabile e coerente verso il client.
 *
 * Responsabilità principali
 * -------------------------
 * - Recuperare panic generati da middleware o handler successivi.
 * - Registrare nei log l'errore recuperato insieme al request ID.
 * - Restituire una risposta JSON standardizzata di errore interno.
 * - Interrompere correttamente la pipeline HTTP dopo il recovery.
 *
 * Interazioni principali
 * ----------------------
 * - Contesto Gin della richiesta.
 * - Middleware RequestID, da cui recupera l'identificativo tecnico.
 * - Pacchetto response, usato per costruire il payload di errore uniforme.
 * - Logger standard della libreria Go.
 *
 * Note
 * ----
 * Il middleware non tenta di risolvere il problema all'origine:
 * il suo compito è confinare il fallimento, preservare la stabilità del gateway
 * e restituire un errore coerente al chiamante.
 */

package middleware

import (
	"log"
	"net/http"

	"apl/api-gateway/internal/response"

	"github.com/gin-gonic/gin"
)

// RecoveryJSON crea un middleware di recovery personalizzato che converte
// eventuali panic in una risposta JSON standardizzata.
func RecoveryJSON() gin.HandlerFunc {
	return gin.CustomRecovery(func(c *gin.Context, recovered any) {
		// Recupera il request ID dal contesto della richiesta,
		// così da correlare il panic ai log e alla risposta restituita al client.
		rid := c.GetString(RequestIDContextKey)

		// Registra nei log il panic intercettato per finalità di diagnosi tecnica.
		log.Printf("panic recovered request_id=%s recovered=%v\n", rid, recovered)

		// Costruisce un payload di errore uniforme, coerente con il formato
		// delle risposte di errore del gateway.
		payload := response.NewError(
			"INTERNAL_ERROR",
			"Errore interno del gateway.",
			rid,
			nil,
		)

		// Interrompe la pipeline e restituisce una risposta HTTP 500 in formato JSON.
		c.AbortWithStatusJSON(http.StatusInternalServerError, payload)
	})
}
