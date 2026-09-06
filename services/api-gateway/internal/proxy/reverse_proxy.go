/*
 * File: services/api-gateway/internal/proxy/reverse_proxy.go
 *
 * Scopo
 * -----
 * Creare un reverse proxy HTTP configurato verso un singolo servizio upstream,
 * gestendo sia il forwarding della richiesta sia la conversione uniforme
 * degli errori di proxy in risposte JSON coerenti con il gateway.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file fornisce il costruttore del reverse proxy usato dal gateway
 * per inoltrare le richieste verso Core Service e AI Assistant.
 * In questo modo il gateway centralizza il dispatch senza replicare
 * logica di proxy nei singoli handler.
 *
 * Responsabilità principali
 * -------------------------
 * - Validare e parsare l'URL del servizio di destinazione.
 * - Creare un reverse proxy standard verso l'host target.
 * - Impostare correttamente l'host della richiesta inoltrata.
 * - Gestire eventuali errori di contatto con il servizio upstream.
 * - Restituire al client una risposta JSON uniforme in caso di bad gateway.
 *
 * Interazioni principali
 * ----------------------
 * - net/http/httputil.ReverseProxy per il forwarding HTTP.
 * - middleware.RequestIDHeader per la propagazione del request ID.
 * - response.NewError e response.WriteJSONError per gli errori uniformi.
 *
 * Note
 * ----
 * Questo componente ha natura infrastrutturale:
 * non applica alcuna regola di business e si occupa solo del forwarding tecnico.
 */

package proxy

import (
	"net/http"
	"net/http/httputil"
	"net/url"

	"apl/api-gateway/internal/middleware"
	"apl/api-gateway/internal/response"
)

// NewSingleHostReverseProxy costruisce un reverse proxy configurato
// verso un singolo servizio upstream identificato dal target URL.
func NewSingleHostReverseProxy(target string) (*httputil.ReverseProxy, error) {
	// Valida e converte la stringa target in un URL strutturato.
	// Se il target non è valido, il proxy non può essere creato.
	u, err := url.Parse(target)
	if err != nil {
		return nil, err
	}

	// Crea il reverse proxy standard verso l'host target.
	rp := httputil.NewSingleHostReverseProxy(u)

	// Conserva il director originale generato dalla libreria standard,
	// così da estenderne il comportamento senza perderne la logica di base.
	originalDirector := rp.Director

	rp.Director = func(req *http.Request) {
		// Applica la configurazione standard del reverse proxy
		// per riscrivere scheme, host e path verso il target.
		originalDirector(req)

		// Imposta esplicitamente l'Host della richiesta inoltrata
		// in modo coerente con il servizio upstream di destinazione.
		req.Host = u.Host
	}

	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		// Recupera il request ID dalla richiesta originale,
		// così da mantenerne la tracciabilità anche in caso di errore di proxy.
		rid := r.Header.Get(middleware.RequestIDHeader)

		// Se il request ID è presente, lo propaga anche nella risposta di errore.
		if rid != "" {
			w.Header().Set(middleware.RequestIDHeader, rid)
		}

		// Costruisce un payload di errore uniforme del gateway
		// per segnalare il fallimento nel contatto con il servizio upstream.
		payload := response.NewError(
			"BAD_GATEWAY",
			"Errore nel contattare il servizio upstream.",
			rid,
			map[string]any{"details": e.Error()},
		)

		// Restituisce una risposta HTTP 502 coerente con il formato JSON del gateway.
		response.WriteJSONError(w, http.StatusBadGateway, payload)
	}

	// Restituisce il reverse proxy pronto all'uso.
	return rp, nil
}
