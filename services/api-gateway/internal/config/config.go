/*
 * File: services/api-gateway/internal/config/config.go
 *
 * Scopo
 * -----
 * Centralizzare il caricamento della configurazione runtime dell'API Gateway
 * a partire dalle variabili d'ambiente, applicando valori di default
 * quando una configurazione esplicita non è presente.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file definisce il contratto di configurazione del gateway e il modo
 * in cui il processo recupera i parametri necessari per avvio, routing,
 * sicurezza e controlli trasversali.
 *
 * Responsabilità principali
 * -------------------------
 * - Definire la struttura dei parametri di configurazione del gateway.
 * - Caricare i valori dall'ambiente di esecuzione.
 * - Applicare fallback di default coerenti con l'ambiente locale/containerizzato.
 * - Convertire in modo sicuro valori stringa in tipi numerici.
 *
 * Interazioni principali
 * ----------------------
 * - Variabili d'ambiente Docker / runtime.
 * - Componenti del gateway che dipendono da porta, URL dei servizi,
 *   segreti JWT, CORS e rate limiting.
 *
 * Note
 * ----
 * Questo file non contiene logica di business né logica HTTP.
 * Si occupa esclusivamente della configurazione infrastrutturale del servizio.+
 */

package config

import (
	"os"
	"strconv"
)

// Config raccoglie tutti i parametri runtime necessari al funzionamento
// del gateway, inclusi endpoint downstream, impostazioni JWT
// e controlli trasversali come CORS e rate limiting.
type Config struct {
	Port        string
	CoreBaseURL string
	AiBaseURL   string

	JwtIssuer string
	JwtSecret string

	InternalServiceSecret string

	EnableCors     bool
	RateLimitRPS   float64
	RateLimitBurst int
}

// Load costruisce la configurazione del gateway leggendo le variabili
// d'ambiente e applicando valori di default quando mancanti o non validi.
// In questo modo il gateway può essere eseguito sia in locale sia in Docker
// senza richiedere necessariamente una configurazione completa manuale.
func Load() Config {
	return Config{
		// Porta di ascolto del gateway.
		Port: getenv("GATEWAY_PORT", "8000"),

		// URL base del Core Service verso cui vengono inoltrate
		// tutte le richieste API non dirette al modulo AI.
		CoreBaseURL: getenv("CORE_BASE_URL", "http://core-service:8080"),

		// URL base del servizio AI Assistant, usato dal gateway
		// per il proxy delle rotte /api/ai/*.
		AiBaseURL: getenv("AI_BASE_URL", "http://ai-assistant:8000"),

		// Issuer atteso nei JWT validati dal gateway.
		JwtIssuer: getenv("JWT_ISSUER", "Healthcare.CoreService"),

		// Segreto simmetrico usato per la verifica della firma JWT.
		JwtSecret: getenv("JWT_SECRET", "DEV_HEALTHCARE_SUPER_LONG_SIGNING_KEY_0123456789"),

		// Segreto interno eventualmente usato nelle comunicazioni
		// tra servizi trusted all'interno dell'architettura.
		InternalServiceSecret: getenv("INTERNAL_SERVICE_SECRET", ""),

		// Abilita o disabilita il middleware CORS.
		EnableCors: getenv("CORS_ENABLED", "true") == "true",

		// Parametri del rate limiting applicato dal gateway.
		RateLimitRPS:   getenvFloat("RATE_LIMIT_RPS", 10),
		RateLimitBurst: getenvInt("RATE_LIMIT_BURST", 20),
	}
}

// getenv recupera una variabile d'ambiente come stringa.
// Se la variabile non è valorizzata, restituisce il valore di default fornito.
func getenv(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

// getenvInt recupera una variabile d'ambiente e tenta di convertirla in intero.
// Se la variabile è assente o non convertibile, restituisce il default.
func getenvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// getenvFloat recupera una variabile d'ambiente e tenta di convertirla in float64.
// Se la variabile è assente o non convertibile, restituisce il default.
func getenvFloat(key string, def float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}
