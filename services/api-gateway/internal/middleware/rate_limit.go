/*
 * File: services/api-gateway/internal/middleware/rate_limit.go
 *
 * Scopo
 * -----
 * Applicare un rate limiting per client al traffico in ingresso sul gateway,
 * limitando il numero di richieste consentite in un intervallo temporale
 * e restituendo una risposta JSON uniforme in caso di superamento del limite.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo middleware protegge il gateway da uso eccessivo o burst anomali,
 * introducendo un controllo tecnico trasversale basato sull'indirizzo IP
 * del client che origina la richiesta.
 *
 * Responsabilità principali
 * -------------------------
 * - Mantenere un limiter separato per ciascun client identificato tramite IP.
 * - Consentire o rifiutare le richieste in base ai parametri configurati.
 * - Pulire periodicamente i limiter inattivi per evitare crescita indefinita in memoria.
 * - Restituire una risposta JSON coerente quando il limite viene superato.
 *
 * Interazioni principali
 * ----------------------
 * - Contesto Gin della richiesta.
 * - Header/IP risolto da Gin tramite c.ClientIP().
 * - Pacchetto golang.org/x/time/rate per il token bucket.
 * - Pacchetto response per la costruzione uniforme degli errori.
 *
 * Note
 * ----
 * Questa implementazione usa una struttura in-memory locale al processo.
 * È adatta a un singolo gateway in contesto locale/dimostrativo;
 * in uno scenario distribuito servirebbe un meccanismo condiviso.
 */

package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"

	"apl/api-gateway/internal/response"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// clientLimiter associa a un client:
// - il rate limiter token bucket che governa le richieste consentite;
// - l'istante dell'ultima attività, utile per la pulizia periodica.
type clientLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// RateLimit crea un middleware che applica un limite di richieste per client,
// identificato tramite indirizzo IP, usando un algoritmo token bucket.
func RateLimit(rps float64, burst int) gin.HandlerFunc {
	// Mutex usato per proteggere l'accesso concorrente alla mappa dei client,
	// poiché il gateway può gestire più richieste contemporaneamente.
	var mu sync.Mutex

	// Mappa in-memory dei limiter per IP.
	clients := make(map[string]*clientLimiter)

	// Goroutine di manutenzione che rimuove periodicamente i client inattivi,
	// evitando che la mappa cresca indefinitamente nel tempo.
	go func() {
		for {
			time.Sleep(1 * time.Minute)

			mu.Lock()
			for ip, cl := range clients {
				// Elimina i limiter non utilizzati da oltre 5 minuti,
				// liberando memoria per client ormai inattivi.
				if time.Since(cl.lastSeen) > 5*time.Minute {
					delete(clients, ip)
				}
			}
			mu.Unlock()
		}
	}()

	return func(c *gin.Context) {
		// Recupera il request ID per includerlo nell'eventuale risposta di errore,
		// così da mantenere la correlazione tra client e log.
		rid := c.GetString(RequestIDContextKey)

		// Normalizza l'identificativo del client a partire dall'IP risolto da Gin.
		ip := clientIP(c.ClientIP())

		mu.Lock()

		// Recupera il limiter associato al client corrente oppure ne crea uno nuovo
		// se è la prima volta che questo IP effettua richieste al gateway.
		cl, ok := clients[ip]
		if !ok {
			cl = &clientLimiter{
				limiter:  rate.NewLimiter(rate.Limit(rps), burst),
				lastSeen: time.Now(),
			}
			clients[ip] = cl
		}

		// Aggiorna sempre l'istante di ultima attività del client,
		// così da evitare una rimozione prematura durante la pulizia periodica.
		cl.lastSeen = time.Now()

		mu.Unlock()

		// Verifica se il limiter consente la richiesta corrente.
		// In caso negativo, la richiesta viene bloccata immediatamente.
		if !cl.limiter.Allow() {
			err := response.NewError(
				"RATE_LIMIT_EXCEEDED",
				"Rate limit superato.",
				rid,
				map[string]any{"ip": ip},
			)

			c.AbortWithStatusJSON(http.StatusTooManyRequests, err)
			return
		}

		// Se il client rientra nei limiti configurati, la richiesta prosegue.
		c.Next()
	}
}

// clientIP normalizza l'identificativo del client estraendo il solo host
// da una stringa eventualmente nel formato host:port.
func clientIP(ip string) string {
	host, _, err := net.SplitHostPort(ip)
	if err == nil && host != "" {
		return host
	}
	return ip
}
