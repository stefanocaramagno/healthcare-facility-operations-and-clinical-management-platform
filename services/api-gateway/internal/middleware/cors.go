/*
 * File: services/api-gateway/internal/middleware/cors.go
 *
 * Scopo
 * -----
 * Applicare le intestazioni CORS alle risposte del gateway e gestire
 * correttamente le richieste preflight OPTIONS provenienti dal browser.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo middleware consente al frontend web di interagire con il gateway
 * in scenari cross-origin, esplicitando i metodi, gli header ammessi
 * e gli header esposti al client.
 *
 * Responsabilità principali
 * -------------------------
 * - Impostare gli header CORS sulle risposte HTTP.
 * - Consentire i metodi HTTP usati dall'applicazione.
 * - Consentire gli header necessari all'autenticazione e al tracciamento.
 * - Gestire in modo immediato le richieste preflight OPTIONS.
 *
 * Interazioni principali
 * ----------------------
 * - Browser e meccanismo CORS lato client.
 * - Header HTTP di richiesta e risposta.
 * - Pipeline Gin del gateway.
 *
 * Note
 * ----
 * La policy definita in questo middleware è volutamente semplice e permissiva,
 * adatta a un contesto locale/dimostrativo. In un ambiente più restrittivo
 * sarebbe opportuno limitare esplicitamente le origini consentite.
 */

package middleware

import "github.com/gin-gonic/gin"

// CORS crea un middleware che aggiunge gli header necessari al supporto
// delle richieste cross-origin e intercetta le richieste preflight OPTIONS.
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Consente richieste da qualunque origine.
		// Questa scelta semplifica l'integrazione del frontend in ambiente locale.
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")

		// Dichiara i metodi HTTP che il gateway accetta nelle richieste cross-origin.
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")

		// Dichiara gli header che il client può inviare,
		// inclusi quelli usati per autenticazione e tracciamento tecnico.
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-ID")

		// Espone al browser l'header tecnico X-Request-ID,
		// così da renderlo accessibile anche lato frontend.
		c.Writer.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")

		// Le richieste preflight OPTIONS non devono proseguire verso gli handler applicativi:
		// il gateway risponde immediatamente con 204 No Content.
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		// Per tutti gli altri metodi, la richiesta prosegue nella pipeline HTTP.
		c.Next()
	}
}
