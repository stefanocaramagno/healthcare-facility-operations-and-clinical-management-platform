"""
File: services/ai-assistant/assistant/api/authentication.py

Scopo
------
Definire il meccanismo di autenticazione custom del servizio "ai-assistant"
basato su token JWT provenienti dal core system, insieme alla rappresentazione
del principal autenticato esposto al resto dell'applicazione Django REST Framework.

Ruolo nel sistema
-----------------
Questo file appartiene al layer API del servizio "ai-assistant" e fornisce:
- una classe principal leggera che rappresenta l'identità autenticata;
- una classe di autenticazione DRF che valida il bearer token ricevuto;
- la trasformazione delle claims JWT in un oggetto applicativo coerente.

Responsabilità principali
-------------------------
- Estrarre l'header Authorization dalla richiesta HTTP.
- Delegare la validazione e decodifica del JWT al servizio dedicato.
- Interrompere il flusso con errore di autenticazione in caso di token non valido.
- Costruire un principal autenticato contenente identità, e-mail, ruolo e claims.
- Restituire a DRF sia il principal sia il payload claims decodificato.

Interazioni principali
----------------------
- BaseAuthentication di Django REST Framework
- AuthenticationFailed di Django REST Framework
- ServicePrincipal
- validate_and_decode
- JWTValidationError

Note
-----
Il file non implementa direttamente la logica crittografica del JWT:
tale responsabilità è delegata al modulo assistant.services.jwt_auth.
Questa componente si occupa esclusivamente del bridge tra HTTP/DRF
e il modello di autenticazione interno del servizio.
"""

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from assistant.services.jwt_auth import JWTValidationError, validate_and_decode


@dataclass(frozen=True)
class ServicePrincipal:
    """
    Rappresentare l'identità autenticata del chiamante all'interno del servizio.

    La classe incapsula le informazioni principali estratte dal JWT validato:
    identificativo utente, e-mail, ruolo applicativo e insieme completo delle claims.
    """

    user_id: str
    email: str
    role: str
    claims: Dict[str, Any]

    @property
    def is_authenticated(self) -> bool:
        """
        Indicare al framework che il principal corrente rappresenta sempre
        un soggetto autenticato.
        """

        return True


class CoreJWTAuthentication(BaseAuthentication):
    """
    Implementare l'autenticazione DRF basata su JWT emessi dal core system.

    La classe estrae l'header Authorization, delega la validazione del token
    al servizio JWT dedicato e costruisce il principal applicativo da restituire
    a Django REST Framework.
    """

    def authenticate(self, request) -> Optional[Tuple[ServicePrincipal, Dict[str, Any]]]:
        """
        Autenticare la richiesta corrente estraendo e validando il JWT
        presente nell'header Authorization e costruendo il principal applicativo.
        """

        # Estrae l'header Authorization dalla richiesta e lo converte in stringa,
        # ignorando eventuali byte non validi.
        raw_authorization = get_authorization_header(request).decode("utf-8", errors="ignore")

        # Se l'header non è presente, il metodo restituisce None e lascia al framework
        # la gestione del caso non autenticato.
        if not raw_authorization:
            return None

        try:
            # Delega la validazione e la decodifica del token al servizio dedicato.
            claims = validate_and_decode(raw_authorization)
        except JWTValidationError as exc:
            # Converte l'errore di validazione JWT in un errore di autenticazione DRF.
            raise AuthenticationFailed(str(exc)) from exc

        # Estrae il ruolo applicativo dalle claims usando la logica centralizzata.
        role = self._extract_role(claims)

        # Costruisce il principal autenticato cercando l'identificativo utente
        # tra più claim alternative, per supportare diversi formati di token.
        principal = ServicePrincipal(
            user_id=str(
                claims.get("sub")
                or claims.get("nameid")
                or claims.get(
                    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"
                )
                or ""
            ),
            email=str(claims.get("email") or ""),
            role=role,
            claims=claims,
        )

        # Restituisce a DRF sia il principal autenticato sia il payload claims.
        return principal, claims

    @staticmethod
    def _extract_role(claims: Dict[str, Any]) -> str:
        """
        Estrarre il ruolo applicativo dalle claims del token,
        supportando sia il nome breve sia il claim URI in stile Microsoft/.NET.
        """

        return str(
            claims.get("role")
            or claims.get("http://schemas.microsoft.com/ws/2008/06/identity/claims/role")
            or ""
        )
