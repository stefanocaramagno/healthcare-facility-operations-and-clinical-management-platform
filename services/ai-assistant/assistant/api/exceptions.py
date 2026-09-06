"""
File: services/ai-assistant/assistant/api/exceptions.py

Scopo
------
Definire l'handler centralizzato delle eccezioni API del servizio "ai-assistant"
e le funzioni di supporto necessarie a normalizzare il formato delle risposte di errore.

Ruolo nel sistema
-----------------
Questo file appartiene al layer API del servizio "ai-assistant"
e fornisce il punto centrale di trasformazione delle eccezioni sollevate
da Django REST Framework in payload JSON uniformi e coerenti
con il contratto esposto dal servizio verso i client.

Responsabilità principali
-------------------------
- Estrarre un messaggio di validazione significativo da strutture di errore annidate.
- Intercettare le principali eccezioni di Django REST Framework.
- Normalizzare code e message delle risposte di errore.
- Garantire un formato JSON coerente per autenticazione, autorizzazione, parsing e validazione.
- Delegare al gestore standard DRF la costruzione iniziale della response.

Interazioni principali
----------------------
- status di Django REST Framework
- AuthenticationFailed
- NotAuthenticated
- ParseError
- PermissionDenied
- ValidationError
- exception_handler di Django REST Framework

Note
-----
Il file non contiene logica di business:
si occupa esclusivamente della trasformazione delle eccezioni applicative
in risposte HTTP/JSON coerenti e leggibili dai client del servizio.
"""

from typing import Any

from rest_framework import status
from rest_framework.exceptions import (
    AuthenticationFailed,
    NotAuthenticated,
    ParseError,
    PermissionDenied,
    ValidationError,
)
from rest_framework.views import exception_handler


def _first_validation_message(detail: Any) -> str:
    """
    Estrarre il primo messaggio di validazione significativo
    da una struttura di errore potenzialmente annidata.
    """

    # Se il dettaglio è una lista, analizza ricorsivamente gli elementi
    # e restituisce il primo messaggio utile trovato.
    if isinstance(detail, list):
        for item in detail:
            message = _first_validation_message(item)
            if message:
                return message
        return "Richiesta non valida."

    # Se il dettaglio è un dizionario, analizza ricorsivamente i valori
    # e restituisce il primo messaggio utile trovato.
    if isinstance(detail, dict):
        for value in detail.values():
            message = _first_validation_message(value)
            if message:
                return message
        return "Richiesta non valida."

    # Per valori atomici, converte direttamente il contenuto in stringa.
    # In assenza di valore, usa un messaggio generico di fallback.
    return str(detail) if detail is not None else "Richiesta non valida."


def api_exception_handler(exc, context):
    """
    Gestire centralmente le eccezioni API convertendole
    in risposte JSON uniformi e coerenti per i client del servizio.
    """

    # Delega inizialmente al gestore standard DRF la costruzione della response.
    response = exception_handler(exc, context)
    if response is None:
        return None

    # Normalizza gli errori di autenticazione assente o non valida
    # in un payload JSON con codice coerente.
    if isinstance(exc, (NotAuthenticated, AuthenticationFailed)):
        response.data = {
            "code": "unauthorized",
            "message": str(response.data.get("detail") or "Autenticazione non valida o assente."),
        }
        return response

    # Normalizza gli errori di autorizzazione insufficiente
    # in un payload JSON con codice coerente.
    if isinstance(exc, PermissionDenied):
        response.data = {
            "code": "forbidden",
            "message": str(response.data.get("detail") or "Accesso non autorizzato."),
        }
        return response

    # Normalizza gli errori di parsing del body
    # in un messaggio esplicito riferito a JSON non valido.
    if isinstance(exc, ParseError):
        response.data = {
            "code": "invalid_request",
            "message": "Il corpo della richiesta deve essere un JSON valido.",
        }
        return response

    # Normalizza gli errori di validazione impostando esplicitamente
    # lo status 400 e includendo sia il messaggio principale sia il dettaglio completo.
    if isinstance(exc, ValidationError):
        response.status_code = status.HTTP_400_BAD_REQUEST
        response.data = {
            "code": "invalid_request",
            "message": _first_validation_message(response.data),
            "errors": response.data,
        }
        return response

    # Per tutte le altre eccezioni già gestite da DRF,
    # costruisce un payload di fallback uniforme.
    detail = response.data.get("detail") if isinstance(response.data, dict) else None
    response.data = {
        "code": "error",
        "message": str(detail or "Operazione non riuscita."),
    }
    return response
