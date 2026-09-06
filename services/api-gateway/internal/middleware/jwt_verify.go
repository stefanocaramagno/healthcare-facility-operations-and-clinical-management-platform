/*
 * File: services/api-gateway/internal/middleware/jwt_verify.go
 *
 * Scopo
 * -----
 * Verificare i token JWT delle richieste dirette al gateway, distinguendo
 * gli endpoint pubblici da quelli protetti e integrando un controllo
 * aggiuntivo di introspection verso il Core Service per verificare
 * l'eventuale revoca del token.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo middleware rappresenta il principale presidio di autenticazione
 * del gateway per le richieste API protette. Il gateway valida localmente
 * firma e issuer del JWT e poi delega al Core Service la verifica dello
 * stato attivo/revocato del token.
 *
 * Responsabilità principali
 * -------------------------
 * - Saltare il controllo per endpoint pubblici e richieste OPTIONS.
 * - Estrarre e validare l'header Authorization.
 * - Verificare firma, algoritmo e issuer del JWT.
 * - Interrogare il Core Service per controllare revoca e stato attivo.
 * - Bloccare le richieste con token assente, invalido, scaduto o revocato.
 * - Rendere disponibile il token validato nel contesto Gin.
 *
 * Interazioni principali
 * ----------------------
 * - Header Authorization della richiesta.
 * - Configurazione JWT del gateway.
 * - Endpoint di token introspection esposto dal Core Service.
 * - Contesto Gin, usato per salvare il token validato.
 *
 * Note
 * ----
 * Il gateway non decide la semantica di business del token:
 * applica una verifica tecnica locale e una verifica remota di stato.
 * Questo consente di coniugare efficienza locale e controllo centralizzato
 * delle revoche da parte del Core Service.
 */

package middleware

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	jwt "github.com/golang-jwt/jwt/v5"
)

// Header interno usato per autenticare le chiamate service-to-service
// del gateway verso l'endpoint di introspection del Core Service.
const internalServiceSecretHeader = "X-Internal-Service-Secret"

// Struttura attesa come risposta dall'endpoint di introspection del Core Service.
// Il gateway usa questi due flag per determinare se il token può ancora essere usato.
type tokenIntrospectionResponse struct {
	Active  bool `json:"active"`
	Revoked bool `json:"revoked"`
}

// RequireJWTVerify crea il middleware che protegge le rotte API del gateway.
// Il controllo segue questa sequenza:
// 1. eventuale bypass globale via AUTH_ENABLED=false;
// 2. esclusione degli endpoint pubblici;
// 3. validazione tecnica locale del JWT;
// 4. introspection remota verso il Core Service per verificare la revoca.
func RequireJWTVerify(secret, issuer, coreBaseURL, internalServiceSecret string, publicPaths []string) gin.HandlerFunc {
	// Consente di disabilitare completamente l'autenticazione in ambienti
	// di sviluppo o test specifici. In tal caso la richiesta prosegue senza verifiche.
	if strings.EqualFold(os.Getenv("AUTH_ENABLED"), "false") {
		return func(c *gin.Context) {
			c.Next()
		}
	}

	// Chiave simmetrica usata per la verifica locale della firma JWT.
	signingKey := []byte(secret)

	// Endpoint del Core Service usato per controllare se il token è attivo o revocato.
	introspectionURL := strings.TrimRight(coreBaseURL, "/") + "/auth/token/introspect"

	// Costruisce una mappa per lookup O(1) dei path pubblici,
	// così da distinguere rapidamente le rotte che non richiedono autenticazione.
	public := make(map[string]struct{}, len(publicPaths))
	for _, p := range publicPaths {
		if p == "" {
			continue
		}
		public[p] = struct{}{}
	}

	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// Le richieste preflight CORS OPTIONS non devono essere sottoposte
		// a verifica JWT, altrimenti il browser non riuscirebbe a completare
		// correttamente la negoziazione cross-origin.
		if c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}

		// Gli endpoint pubblici vengono esclusi dal controllo di autenticazione,
		// ad esempio login, registrazione, attivazione account e webhook tecnici.
		if _, ok := public[path]; ok {
			c.Next()
			return
		}

		// Per tutte le altre rotte è richiesto l'header Authorization.
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "missing_token",
				"message": "Token JWT mancante. Effettuare l'autenticazione.",
			})
			return
		}

		// Verifica che l'header Authorization rispetti il formato atteso:
		// "Bearer <token>".
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "invalid_authorization_header",
				"message": "Header Authorization non valido. Atteso formato 'Bearer <token>'.",
			})
			return
		}

		// Estrae il token grezzo eliminando eventuali spazi superflui.
		rawToken := strings.TrimSpace(parts[1])
		if rawToken == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "empty_token",
				"message": "Token JWT mancante.",
			})
			return
		}

		// Esegue la validazione locale del JWT:
		// - verifica che l'algoritmo di firma sia HMAC;
		// - verifica la firma con la chiave simmetrica configurata;
		// - verifica l'issuer atteso.
		token, err := jwt.Parse(rawToken, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Method.Alg())
			}
			return signingKey, nil
		}, jwt.WithIssuer(issuer))

		// Se la validazione locale fallisce oppure il token non risulta valido,
		// la richiesta viene respinta come non autenticata.
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "invalid_token",
				"message": "Token JWT non valido o scaduto.",
			})
			return
		}

		// Anche un token formalmente valido può essere stato revocato lato Core Service.
		// Per questo il gateway effettua una introspection remota prima di consentire l'accesso.
		active, revoked, introspectionErr := introspectToken(introspectionURL, internalServiceSecret, authHeader)
		if introspectionErr != nil {
			c.AbortWithStatusJSON(http.StatusBadGateway, gin.H{
				"code":    "token_introspection_unavailable",
				"message": "Impossibile verificare lo stato di revoca del token.",
				"details": introspectionErr.Error(),
			})
			return
		}

		// Se il token non è attivo oppure risulta revocato, il client deve autenticarsi di nuovo.
		if !active || revoked {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "revoked_token",
				"message": "Il token JWT è stato revocato. Effettuare nuovamente il login.",
			})
			return
		}

		// Salva il token validato nel contesto, così che handler o middleware successivi
		// possano eventualmente riutilizzarlo senza ripetere il parsing.
		c.Set("jwt", token)

		// Solo a questo punto la richiesta viene considerata autenticata
		// e può proseguire nella pipeline del gateway.
		c.Next()
	}
}

// introspectToken interroga il Core Service per verificare se il token
// è ancora attivo e se è stato revocato.
// La funzione usa sia l'Authorization originale sia un secret interno
// per autenticare la chiamata tra servizi.
func introspectToken(introspectionURL, internalServiceSecret, authorizationHeader string) (bool, bool, error) {
	// L'URL di introspection è obbligatorio:
	// senza di esso il gateway non può verificare lo stato centralizzato del token.
	if strings.TrimSpace(introspectionURL) == "" {
		return false, false, fmt.Errorf("introspection URL non configurata")
	}

	// Il secret interno è richiesto per proteggere la chiamata service-to-service
	// verso il Core Service.
	if strings.TrimSpace(internalServiceSecret) == "" {
		return false, false, fmt.Errorf("internal service secret non configurato")
	}

	// Costruisce una richiesta POST minimale verso l'endpoint di introspection.
	// Il body è vuoto dal punto di vista semantico, poiché il token viene trasmesso
	// tramite header Authorization.
	req, err := http.NewRequest(http.MethodPost, introspectionURL, bytes.NewBufferString("{}"))
	if err != nil {
		return false, false, err
	}

	// Propaga il token originale e il secret interno richiesto dal Core Service.
	req.Header.Set("Authorization", authorizationHeader)
	req.Header.Set(internalServiceSecretHeader, internalServiceSecret)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	// Usa un client HTTP con timeout breve per evitare che un problema
	// del servizio di introspection blocchi troppo a lungo la richiesta al gateway.
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, false, err
	}
	defer resp.Body.Close()

	// Se il Core Service risponde 401, il gateway interpreta il token
	// come non attivo/non accettato dall'introspection.
	if resp.StatusCode == http.StatusUnauthorized {
		return false, false, nil
	}

	// Qualunque altro status diverso da 200 viene considerato anomalo
	// e trattato come errore infrastrutturale di introspection.
	if resp.StatusCode != http.StatusOK {
		return false, false, fmt.Errorf("status introspection inatteso: %d", resp.StatusCode)
	}

	// Decodifica il payload JSON restituito dal Core Service.
	var payload tokenIntrospectionResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false, false, err
	}

	// Restituisce le informazioni di stato del token così come dichiarate
	// dalla fonte autorevole, cioè il Core Service.
	return payload.Active, payload.Revoked, nil
}
