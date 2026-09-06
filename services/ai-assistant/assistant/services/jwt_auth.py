"""
File: services/ai-assistant/assistant/services/jwt_auth.py
Scopo
------
Definire le utilità di validazione e decodifica dei JWT
utilizzati dal servizio "ai-assistant",
includendo sia la verifica crittografica locale del token
sia il controllo remoto del suo stato di revoca presso il Core Service.

Ruolo nel sistema
-----------------
Questo file appartiene al layer services del servizio "ai-assistant"
e fornisce le primitive applicative necessarie a:
- estrarre il bearer token dall'header Authorization;
- validare firma, issuer e claim obbligatori del JWT;
- verificare che il token non sia stato revocato;
- restituire al layer chiamante le claims decodificate del token.

Responsabilità principali
-------------------------
- Caricare e mantenere le costanti di configurazione JWT e introspection.
- Definire l'eccezione applicativa di validazione JWT.
- Estrarre il token bearer dall'header Authorization.
- Interrogare il Core Service per verificare che il token sia ancora attivo.
- Validare e decodificare il token JWT tramite chiave condivisa e issuer atteso.

Interazioni principali
----------------------
- Modulo jwt / funzione jwt.decode
- Eccezione InvalidTokenError
- Libreria requests
- Endpoint di token introspection del Core Service
- Variabili ambiente JWT_SECRET, JWT_ISSUER, CORE_BASE_URL, INTERNAL_SERVICE_SECRET

Note
-----
Il file non gestisce direttamente autenticazione HTTP o permessi API:
fornisce un servizio riutilizzabile dal layer API per la verifica dei token.
La validazione è composta da due fasi:
1. verifica locale del JWT;
2. verifica remota dello stato di revoca tramite Core Service.
"""

import os
from typing import Any, Dict

import jwt
import requests
from jwt import InvalidTokenError


# Algoritmo JWT atteso per la verifica della firma.
JWT_ALGORITHM = "HS256"

# Nome dell'header interno usato per autorizzare il servizio AI
# verso l'endpoint di introspection del Core Service.
INTERNAL_SERVICE_SECRET_HEADER = "X-Internal-Service-Secret"

# Issuer atteso dei JWT, letto dall'ambiente.
JWT_ISSUER = os.getenv("JWT_ISSUER", "")

# Segreto condiviso usato per validare i JWT, letto dall'ambiente.
JWT_SECRET = os.getenv("JWT_SECRET", "")

# Base URL del Core Service usato per la token introspection.
CORE_BASE_URL = os.getenv("CORE_BASE_URL", "http://core-service:8080")

# Segreto interno usato per autenticare il servizio AI
# verso il Core Service durante la token introspection.
INTERNAL_SERVICE_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")


class JWTValidationError(Exception):
    """
    Rappresentare un errore applicativo di validazione JWT.

    Questa eccezione viene sollevata quando il token risulta assente,
    malformato, non valido, scaduto, revocato
    oppure quando la configurazione necessaria alla validazione è incompleta.
    """

    pass


def _extract_bearer_token(authorization_header: str) -> str:
    """
    Estrarre il token JWT puro a partire dal valore dell'header Authorization.

    Il formato atteso è: "Bearer <token>".
    """

    # Rifiuta immediatamente il caso in cui l'header sia assente o vuoto.
    if not authorization_header:
        raise JWTValidationError("Header Authorization mancante.")

    # Suddivide l'header nelle sue componenti logiche.
    parts = authorization_header.split()

    # Verifica che il formato sia esattamente "Bearer <token>".
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise JWTValidationError("Header Authorization non valido. Atteso 'Bearer <token>'.")

    return parts[1]


def _ensure_token_not_revoked(authorization_header: str) -> None:
    """
    Verificare presso il Core Service che il token non sia stato revocato
    e che risulti ancora attivo.
    """

    # Verifica la presenza del segreto interno necessario
    # per autorizzare la chiamata di introspection.
    if not INTERNAL_SERVICE_SECRET:
        raise JWTValidationError(
            "Configurazione interna mancante. Assicurarsi di aver impostato INTERNAL_SERVICE_SECRET."
        )

    # Costruisce l'endpoint di introspection del Core Service
    # evitando doppi slash finali nella base URL.
    introspection_url = f"{CORE_BASE_URL.rstrip('/')}/auth/token/introspect"

    try:
        # Invia una richiesta POST al Core Service includendo:
        # - l'Authorization originale del chiamante;
        # - il segreto interno del servizio AI;
        # - l'accept header JSON atteso.
        response = requests.post(
            introspection_url,
            headers={
                "Authorization": authorization_header,
                INTERNAL_SERVICE_SECRET_HEADER: INTERNAL_SERVICE_SECRET,
                "Accept": "application/json",
            },
            json={},
            timeout=3,
        )
    except requests.RequestException as exc:
        # Converte gli errori di trasporto/rete in errore applicativo di validazione JWT.
        raise JWTValidationError(
            "Impossibile verificare lo stato di revoca del token presso il Core Service."
        ) from exc

    # 401 indica token non valido, scaduto o revocato.
    if response.status_code == 401:
        raise JWTValidationError("Token revocato, non valido o scaduto.")

    # 403 indica che il servizio AI non è autorizzato
    # a usare l'endpoint di introspection.
    if response.status_code == 403:
        raise JWTValidationError(
            "Il servizio AI non è autorizzato a interrogare il Core Service per la token introspection."
        )

    # Qualsiasi altro status diverso da 200 viene trattato
    # come errore applicativo del flusso di introspection.
    if response.status_code != 200:
        raise JWTValidationError(
            f"Errore durante la token introspection: HTTP {response.status_code}."
        )

    # Analizza il payload JSON restituito dal Core Service
    # e verifica che il token risulti attivo e non revocato.
    payload = response.json()
    if not payload.get("active", False) or payload.get("revoked", False):
        raise JWTValidationError("Token revocato o non più attivo.")


def validate_and_decode(authorization_header: str) -> Dict[str, Any]:
    """
    Validare l'header Authorization, decodificare il JWT
    e verificare che il token non sia stato revocato.

    In caso di successo, restituisce il dizionario delle claims decodificate.
    """

    # Verifica che la configurazione minima necessaria alla validazione JWT
    # sia presente nell'ambiente di esecuzione.
    if not JWT_SECRET or not JWT_ISSUER:
        raise JWTValidationError(
            "Configurazione JWT mancante. Assicurarsi di aver impostato JWT_SECRET e JWT_ISSUER."
        )

    # Estrae il token puro dal valore completo dell'header Authorization.
    token = _extract_bearer_token(authorization_header)

    try:
        # Esegue la validazione locale del JWT verificando:
        # - firma;
        # - algoritmo atteso;
        # - issuer;
        # - presenza dei claim obbligatori.
        decoded = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            options={
                "require": ["exp", "nbf", "iss"],
                "verify_aud": False,
            },
        )
    except InvalidTokenError as exc:
        # Converte ogni errore della libreria JWT
        # in un errore applicativo coerente per i layer superiori.
        raise JWTValidationError(f"Token non valido: {exc}") from exc

    # Dopo la validazione locale, verifica remotamente
    # che il token non sia stato revocato o disattivato.
    _ensure_token_not_revoked(authorization_header)

    return decoded
