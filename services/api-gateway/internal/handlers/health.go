/*
 * File: services/api-gateway/internal/handlers/health.go
 *
 * Scopo
 * -----
 * Esporre un endpoint di health aggregata del gateway, verificando
 * la disponibilità dei principali servizi downstream da cui dipende
 * il corretto funzionamento dell'architettura.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo handler permette al gateway di offrire una vista sintetica
 * dello stato complessivo del sistema dal proprio punto di osservazione,
 * controllando la raggiungibilità di Core Service e AI Assistant.
 *
 * Responsabilità principali
 * - Costruire una risposta di health uniforme del gateway.
 * - Interrogare i servizi downstream critici tramite HTTP.
 * - Misurare la latenza delle verifiche effettuate.
 * - Restituire stato OK solo se tutte le dipendenze risultano disponibili.
 * - Includere metadati tecnici come il request ID.
 *
 * Interazioni principali
 * ----------------------
 * - Configurazione del gateway per recuperare gli URL base dei servizi.
 * - Middleware RequestID per la correlazione della richiesta.
 * - Endpoint /health dei servizi downstream.
 * - Client HTTP standard della libreria Go.
 *
 * Note
 * -----
 * L'endpoint non verifica la correttezza funzionale dei servizi,
 * ma solo la loro raggiungibilità HTTP e la capacità di rispondere
 * con uno status di successo.
 */

package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"apl/api-gateway/internal/config"
	"apl/api-gateway/internal/middleware"
)

// Timeout massimo usato dal client HTTP per le verifiche di health
// verso i servizi downstream.
const httpClientTimeout = 2 * time.Second

// downstreamStatus rappresenta l'esito della verifica di una singola dipendenza
// osservata dal gateway.
type downstreamStatus struct {
	Service   string `json:"service"`
	Ok        bool   `json:"ok"`
	Endpoint  string `json:"endpoint"`
	LatencyMs int64  `json:"latencyMs"`
	Error     string `json:"error,omitempty"`
}

// healthData contiene il contenuto principale della risposta di health,
// incluso lo stato del gateway e quello delle sue dipendenze.
type healthData struct {
	Service      string                      `json:"service"`
	Ok           bool                        `json:"ok"`
	Time         time.Time                   `json:"time"`
	Dependencies map[string]downstreamStatus `json:"dependencies"`
}

// responseMeta raccoglie metadati tecnici utili alla tracciabilità della risposta.
type responseMeta struct {
	Service   string `json:"service"`
	RequestID string `json:"requestId"`
}

// healthResponse rappresenta il payload JSON restituito dall'endpoint di health.
type healthResponse struct {
	Success bool         `json:"success"`
	Data    *healthData  `json:"data,omitempty"`
	Error   string       `json:"error,omitempty"`
	Meta    responseMeta `json:"meta"`
}

// Health costruisce un handler Gin che espone una health aggregata del gateway.
// Il gateway viene considerato "ok" solo se tutte le dipendenze controllate
// rispondono correttamente ai rispettivi endpoint di health.
func Health(cfg config.Config) gin.HandlerFunc {
	// Client HTTP condiviso per le verifiche di health,
	// con timeout breve per evitare blocchi prolungati del gateway.
	client := &http.Client{
		Timeout: httpClientTimeout,
	}

	return func(c *gin.Context) {
		// Recupera il request ID assegnato dal middleware,
		// così da includerlo nella risposta di health per finalità di correlazione.
		requestID := c.GetString(middleware.RequestIDContextKey)

		// Mappa che conterrà l'esito della verifica delle dipendenze principali.
		deps := make(map[string]downstreamStatus)

		// Verifica la disponibilità del Core Service interrogando il suo endpoint /health.
		coreStatus := checkHTTPService(
			c.Request.Context(),
			client,
			"core-service",
			cfg.CoreBaseURL+"/health",
		)
		deps["coreService"] = coreStatus

		// Verifica la disponibilità del modulo AI Assistant interrogando il suo endpoint /health.
		aiStatus := checkHTTPService(
			c.Request.Context(),
			client,
			"ai-assistant",
			cfg.AiBaseURL+"/health",
		)
		deps["aiAssistant"] = aiStatus

		// Il gateway si considera sano solo se entrambe le dipendenze principali
		// risultano disponibili dal punto di vista HTTP.
		ok := coreStatus.Ok && aiStatus.Ok

		// Costruisce la risposta JSON strutturata,
		// includendo stato globale, timestamp UTC e stato delle dipendenze.
		resp := healthResponse{
			Success: ok,
			Data: &healthData{
				Service:      "api-gateway",
				Ok:           ok,
				Time:         time.Now().UTC(),
				Dependencies: deps,
			},
			Meta: responseMeta{
				Service:   "api-gateway",
				RequestID: requestID,
			},
		}

		// Se una o più dipendenze non sono disponibili,
		// il gateway restituisce 503 Service Unavailable con messaggio esplicativo.
		if !ok {
			resp.Error = "Una o più dipendenze non risultano disponibili."
			c.JSON(http.StatusServiceUnavailable, resp)
			return
		}

		// Se tutte le dipendenze controllate risultano sane,
		// il gateway restituisce 200 OK.
		c.JSON(http.StatusOK, resp)
	}
}

// checkHTTPService verifica lo stato HTTP di un singolo servizio downstream,
// misurandone anche la latenza di risposta dal punto di vista del gateway.
func checkHTTPService(ctx context.Context, client *http.Client, serviceName, url string) downstreamStatus {
	// Registra l'istante iniziale per misurare il tempo totale della verifica.
	start := time.Now()

	// Costruisce una richiesta HTTP GET contestualizzata,
	// così da rispettare eventuali annullamenti o timeout del contesto chiamante.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return downstreamStatus{
			Service:   serviceName,
			Ok:        false,
			Endpoint:  url,
			LatencyMs: time.Since(start).Milliseconds(),
			Error:     err.Error(),
		}
	}

	// Esegue la richiesta verso il servizio downstream.
	res, err := client.Do(req)
	if err != nil {
		return downstreamStatus{
			Service:   serviceName,
			Ok:        false,
			Endpoint:  url,
			LatencyMs: time.Since(start).Milliseconds(),
			Error:     err.Error(),
		}
	}
	defer res.Body.Close()

	// Considera "ok" qualsiasi risposta con status code 2xx.
	ok := res.StatusCode >= 200 && res.StatusCode < 300

	// Restituisce l'esito della verifica insieme all'endpoint interrogato
	// e alla latenza osservata dal gateway.
	return downstreamStatus{
		Service:   serviceName,
		Ok:        ok,
		Endpoint:  url,
		LatencyMs: time.Since(start).Milliseconds(),
	}
}
