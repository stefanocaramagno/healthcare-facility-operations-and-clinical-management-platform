/*
 * File: services/api-gateway/internal/response/error.go
 *
 * Scopo
 * -----
 * Definire il formato uniforme delle risposte di errore JSON del gateway
 * e fornire utility centralizzate per costruire e scrivere tali risposte
 * verso il client HTTP.
 *
 * Ruolo nel sistema
 * -----------------
 * Questo file standardizza la rappresentazione degli errori tecnici restituiti
 * dal gateway, così da garantire coerenza tra middleware, handler e componenti
 * infrastrutturali come il reverse proxy.
 *
 * Responsabilità principali
 * -------------------------
 * - Definire la struttura JSON delle risposte di errore.
 * - Costruire payload di errore in modo centralizzato.
 * - Scrivere risposte JSON con status HTTP coerente.
 * - Gestire in fallback eventuali errori di serializzazione JSON.
 *
 * Interazioni principali
 * ----------------------
 * - Middleware e handler del gateway che devono restituire errori uniformi.
 * - net/http per la scrittura della risposta.
 * - encoding/json per la serializzazione del payload.
 *
 * Note
 * ----
 * Il request ID è incluso nel payload per facilitare la correlazione
 * tra risposta client e log del gateway.
 */

package response

import (
	"encoding/json"
	"net/http"
	"strings"
)

// ErrorResponse rappresenta il formato standard delle risposte di errore
// restituite dal gateway in formato JSON.
type ErrorResponse struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Details   any    `json:"details,omitempty"`
	RequestID string `json:"requestId"`
}

// NewError costruisce un payload di errore uniforme a partire
// dai dati tecnici e descrittivi forniti dal chiamante.
func NewError(code string, message string, requestID string, details any) ErrorResponse {
	return ErrorResponse{
		Code:      code,
		Message:   message,
		Details:   details,
		RequestID: requestID,
	}
}

// WriteJSONError scrive sul writer HTTP una risposta di errore JSON,
// impostando content type e status code coerenti con il contesto chiamante.
func WriteJSONError(w http.ResponseWriter, status int, err ErrorResponse) {
	// Dichiara esplicitamente che il payload restituito è JSON.
	w.Header().Set("Content-Type", "application/json")

	// Scrive lo status HTTP prima del body.
	w.WriteHeader(status)

	// Tenta di serializzare il payload di errore nel formato JSON standard.
	b, marshalErr := json.Marshal(err)
	if marshalErr != nil {
		// Se anche la serializzazione del payload fallisce,
		// restituisce un fallback JSON minimale ma comunque valido,
		// preservando il request ID in forma sanificata.
		_, _ = w.Write([]byte(`{"code":"INTERNAL_ERROR","message":"Errore interno","requestId":"` + escapeJSON(err.RequestID) + `"}`))
		return
	}

	// Scrive il payload JSON serializzato nella risposta HTTP.
	_, _ = w.Write(b)
}

// escapeJSON applica una sanitizzazione minima a una stringa
// destinata a essere interpolata manualmente in un frammento JSON.
func escapeJSON(s string) string {
	// Escape del backslash per evitare rotture sintattiche nel JSON risultante.
	s = strings.ReplaceAll(s, `\`, `\\`)

	// Escape del doppio apice per preservare la validità della stringa JSON.
	s = strings.ReplaceAll(s, `"`, `\"`)

	// Rimuove eventuali ritorni a capo trasformandoli in spazi,
	// così da mantenere il fallback JSON su una singola linea valida.
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")

	return s
}
