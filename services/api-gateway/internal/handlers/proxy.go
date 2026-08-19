/*
 * File: services/api-gateway/internal/handlers/proxy.go
 *
 * Scopo
 * -----
 * Instradare dinamicamente le richieste /api/* ricevute dal gateway
 * verso il servizio backend corretto, distinguendo tra Core Service,
 * AI Assistant ed endpoint locali gestiti direttamente dal gateway.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file realizza la logica centrale di dispatch del gateway.
 * Dopo il passaggio nella pipeline di middleware, le richieste API
 * vengono inoltrate al Core Service oppure al modulo AI in base al path,
 * mentre la health aggregata viene gestita localmente.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare e normalizzare gli URL base dei servizi downstream.
 * - Creare i reverse proxy verso Core Service e AI Assistant.
 * - Normalizzare il path richiesto sotto /api/*.
 * - Gestire localmente l'endpoint /api/health.
 * - Inoltrare /api/ai/* al servizio AI rimuovendo il prefisso /ai.
 * - Inoltrare tutte le altre richieste API al Core Service.
 *
 * Interazioni principali
 * ----------------------
 * - internal/config per la configurazione del gateway.
 * - internal/proxy per la creazione dei reverse proxy.
 * - Handler Health per la health aggregata locale.
 * - Contesto Gin e richiesta HTTP originale.
 *
 * Note
 * ----
 * Questo handler non applica logica di business:
 * si occupa esclusivamente del dispatch infrastrutturale delle richieste.
 */

package handlers

import (
	"net/url"
	"strings"

	"apl/api-gateway/internal/config"
	gatewayproxy "apl/api-gateway/internal/proxy"

	"github.com/gin-gonic/gin"
)

// ProxyRouter costruisce l'handler di dispatch principale del gateway.
// In base al path richiesto decide se:
// - gestire localmente la health aggregata;
// - inoltrare la richiesta all'AI Assistant;
// - inoltrare la richiesta al Core Service.
func ProxyRouter(cfg config.Config, coreBaseURL, aiBaseURL string) gin.HandlerFunc {
	// Valida l'URL base del Core Service.
	// Un URL non valido rappresenta un errore di configurazione fatale del gateway.
	coreURL, err := url.Parse(coreBaseURL)
	if err != nil {
		panic("ProxyRouter: coreBaseURL non valida: " + err.Error())
	}

	// Valida l'URL base del servizio AI.
	// Anche questo è un prerequisito essenziale per il corretto dispatch.
	aiURL, err := url.Parse(aiBaseURL)
	if err != nil {
		panic("ProxyRouter: aiBaseURL non valida: " + err.Error())
	}

	// Costruisce il reverse proxy verso il Core Service,
	// usato per tutte le richieste API non dirette al modulo AI.
	coreProxy, err := gatewayproxy.NewSingleHostReverseProxy(coreBaseURL)
	if err != nil {
		panic("ProxyRouter: impossibile creare il reverse proxy per il core-service: " + err.Error())
	}

	// Costruisce il reverse proxy verso l'AI Assistant,
	// usato per le richieste con prefisso /api/ai/*.
	aiProxy, err := gatewayproxy.NewSingleHostReverseProxy(aiBaseURL)
	if err != nil {
		panic("ProxyRouter: impossibile creare il reverse proxy per l'ai-assistant: " + err.Error())
	}

	// Prepara l'handler locale di health aggregata,
	// così da poter rispondere a /api/health senza inoltrare la richiesta.
	healthHandler := Health(cfg)

	return func(c *gin.Context) {
		// Recupera il path catturato dal catch-all route /api/*path.
		path := c.Param("path")

		// Se il path è vuoto, lo normalizza alla radice.
		if path == "" {
			path = "/"
		}

		// Garantisce che il path inizi sempre con "/",
		// così da mantenere una forma coerente per le verifiche successive.
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}

		// Normalizza il path rimuovendo lo slash finale superfluo,
		// mantenendo però "/" come valore valido della radice.
		normalizedPath := strings.TrimRight(path, "/")
		if normalizedPath == "" {
			normalizedPath = "/"
		}

		// L'endpoint /api/health viene gestito direttamente dal gateway
		// come health aggregata dei servizi downstream.
		if normalizedPath == "/health" {
			healthHandler(c)
			return
		}

		// Tutte le richieste che iniziano con /ai vengono inoltrate
		// al modulo AI Assistant dopo aver rimosso il prefisso /ai.
		// In questo modo il servizio AI riceve il path nel formato che si aspetta.
		if strings.HasPrefix(path, "/ai") {
			trimmed := strings.TrimPrefix(path, "/ai")
			if trimmed == "" {
				trimmed = "/"
			}

			// Aggiorna il path della richiesta prima del forwarding verso l'AI Assistant.
			c.Request.URL.Path = trimmed

			// Imposta l'host coerente con il servizio di destinazione.
			c.Request.Host = aiURL.Host

			// Inoltra la richiesta al reverse proxy AI.
			aiProxy.ServeHTTP(c.Writer, c.Request)
			return
		}

		// Tutte le altre richieste API vengono inoltrate al Core Service
		// mantenendo il path così come ricevuto dal gateway sotto /api/*.
		c.Request.URL.Path = path

		// Imposta l'host coerente con il servizio Core di destinazione.
		c.Request.Host = coreURL.Host

		// Inoltra la richiesta al reverse proxy del Core Service.
		coreProxy.ServeHTTP(c.Writer, c.Request)
	}
}
