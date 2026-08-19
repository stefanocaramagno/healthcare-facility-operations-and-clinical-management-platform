/*
 * File: services/api-gateway/internal/http/router.go
 *
 * Scopo
 * -----
 * Costruire e configurare il router HTTP principale dell'API Gateway,
 * registrando middleware globali, endpoint locali, policy di sicurezza
 * e instradamento delle richieste verso i servizi downstream.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file definisce il punto centrale di composizione della pipeline HTTP
 * del gateway. Qui vengono collegati i middleware trasversali, la health locale,
 * la protezione JWT delle API e il dispatch verso Core Service e AI Assistant.
 *
 * Responsabilità principali
 * -------------------------
 * - Inizializzare il motore Gin del gateway.
 * - Applicare middleware globali e opzionali.
 * - Esporre endpoint locali del gateway.
 * - Proteggere le rotte API tramite verifica JWT.
 * - Instradare le richieste /api/* verso il backend corretto.
 * - Restituire una risposta JSON coerente per le rotte non trovate.
 *
 * Interazioni principali
 * ----------------------
 * - internal/config per i parametri runtime del gateway.
 * - internal/middleware per sicurezza e cross-cutting concerns.
 * - internal/handlers per il proxy routing verso i servizi downstream.
 * - Gin per la costruzione della pipeline HTTP.
 *
 * Note
 * ----
 * Il gateway non contiene logica di business di dominio.
 * Si limita a verificare il contesto della richiesta, applicare responsabilità
 * trasversali e inoltrare il traffico al servizio competente.
 */

package http

import (
	"net/http"

	"apl/api-gateway/internal/config"
	"apl/api-gateway/internal/handlers"
	"apl/api-gateway/internal/middleware"

	"github.com/gin-gonic/gin"
)

// NewRouter costruisce il router principale del gateway applicando
// middleware, endpoint locali e regole di dispatch verso i servizi backend.
func NewRouter(cfg config.Config) *gin.Engine {
	// Crea un'istanza Gin minimale, senza middleware di default,
	// così da poter controllare esplicitamente tutta la pipeline HTTP.
	router := gin.New()

	// Disabilita l'uso di trusted proxies espliciti.
	// In questo modo il gateway evita di fidarsi implicitamente di proxy esterni
	// per la risoluzione dell'indirizzo client.
	router.SetTrustedProxies(nil)

	// Middleware globali sempre attivi:
	// - Request ID per il tracciamento delle richieste;
	// - logging strutturato;
	// - recovery JSON per evitare crash del processo in caso di panic.
	router.Use(
		middleware.RequestID(),
		middleware.Logging(),
		middleware.RecoveryJSON(),
	)

	// Abilita il middleware CORS solo se richiesto dalla configurazione runtime.
	if cfg.EnableCors {
		router.Use(middleware.CORS())
	}

	// Applica il rate limiting solo se la configurazione prevede
	// un limite di richieste al secondo maggiore di zero.
	if cfg.RateLimitRPS > 0 {
		router.Use(middleware.RateLimit(cfg.RateLimitRPS, cfg.RateLimitBurst))
	}

	// Endpoint di health locale del gateway.
	// Questo endpoint non dipende dai servizi downstream e serve a verificare
	// che il processo del gateway sia attivo e raggiungibile.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "api-gateway",
		})
	})

	// Raggruppa tutte le API applicative sotto il prefisso /api.
	api := router.Group("/api")

	// Applica la verifica JWT a tutte le rotte API, ad eccezione di un insieme
	// esplicito di endpoint pubblici o tecnici che devono restare accessibili
	// senza autenticazione preventiva.
	api.Use(middleware.RequireJWTVerify(
		cfg.JwtSecret,
		cfg.JwtIssuer,
		cfg.CoreBaseURL,
		cfg.InternalServiceSecret,
		[]string{
			"/api/health",
			"/api/auth/login",
			"/api/auth/register/patient",
			"/api/auth/register/delegate",
			"/api/auth/activate",
			"/api/auth/activate/confirm",
			"/api/auth/activation/resend",
			"/api/auth/password/forgot",
			"/api/auth/password/reset",
			"/api/payments/provider/webhooks/simulated",
		},
	))

	// Determina l'URL base del servizio AI.
	// Se non valorizzato in configurazione, usa il valore di fallback coerente
	// con il networking interno definito nell'ambiente Docker Compose.
	aiBase := cfg.AiBaseURL
	if aiBase == "" {
		aiBase = "http://ai-assistant:8000"
	}

	// Determina l'URL base del Core Service.
	// Anche qui viene applicato un fallback coerente con l'ambiente containerizzato.
	coreBase := cfg.CoreBaseURL
	if coreBase == "" {
		coreBase = "http://core-service:8080"
	}

	// Inoltra tutte le richieste sotto /api/* a un proxy router centrale.
	// La logica di dispatch distingue tra richieste destinate al modulo AI
	// e richieste dirette al Core Service.
	api.Any("/*path", handlers.ProxyRouter(cfg, coreBase, aiBase))

	// Gestione uniforme delle rotte non riconosciute al di fuori delle API instradate.
	// La risposta viene restituita in formato JSON per coerenza con il gateway.
	router.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{
			"code":    "not_found",
			"message": "Risorsa non trovata.",
		})
	})

	// Restituisce il router completamente configurato.
	return router
}
