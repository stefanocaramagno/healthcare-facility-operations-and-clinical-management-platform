/*
 * File: services/api-gateway/internal/middleware/request_id.go
 *
 * Scopo
 * -----
 * Generare o propagare un identificativo univoco di richiesta per ogni chiamata
 * gestita dal gateway, rendendolo disponibile sia nel contesto applicativo
 * sia negli header HTTP di richiesta e risposta.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo middleware supporta la tracciabilità end-to-end delle richieste,
 * facilitando logging, debugging e correlazione tra frontend, gateway
 * e servizi downstream.
 *
 * Responsabilità principali
 * -------------------------
 * - Leggere un eventuale request ID già presente nella richiesta.
 * - Generare un nuovo identificativo se assente.
 * - Salvare il request ID nel contesto Gin.
 * - Propagare il request ID verso i servizi downstream.
 * - Restituire il request ID anche nella risposta al client.
 *
 * Interazioni principali
 * ----------------------
 * - Header HTTP X-Request-ID.
 * - Contesto Gin della richiesta corrente.
 * - Middleware e componenti successivi della pipeline HTTP.
 *
 * Note
 * ----
 * Il request ID non ha significato di business:
 * è un identificativo tecnico utile alla correlazione osservabile delle richieste.
 */

package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Nome dell'header HTTP usato per propagare l'identificativo della richiesta.
const RequestIDHeader = "X-Request-ID"

// Chiave usata per salvare il request ID nel contesto Gin.
const RequestIDContextKey = "request_id"

// RequestID crea un middleware che assicura la presenza di un identificativo
// univoco per ogni richiesta elaborata dal gateway.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Recupera un eventuale request ID già fornito dal chiamante o da un proxy a monte.
		rid := c.GetHeader(RequestIDHeader)

		// Se il chiamante non ha fornito un identificativo, ne genera uno nuovo.
		if rid == "" {
			rid = uuid.NewString()
		}

		// Salva il request ID nel contesto della richiesta,
		// così da renderlo accessibile ai middleware e handler successivi.
		c.Set(RequestIDContextKey, rid)

		// Propaga il request ID anche nell'header della richiesta inoltrata,
		// così da mantenerne la continuità verso i servizi downstream.
		c.Request.Header.Set(RequestIDHeader, rid)

		// Restituisce il request ID anche nella risposta HTTP,
		// così che il client possa usarlo per correlare la chiamata nei log.
		c.Writer.Header().Set(RequestIDHeader, rid)

		// Passa il controllo al resto della pipeline HTTP.
		c.Next()
	}
}
