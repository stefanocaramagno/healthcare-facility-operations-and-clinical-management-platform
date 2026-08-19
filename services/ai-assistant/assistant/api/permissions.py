"""
File: services/ai-assistant/assistant/api/permissions.py

Scopo
------
Definire una permission custom di Django REST Framework
che consente l'accesso alle API dell'assistente AI consultivo
esclusivamente agli utenti con ruolo "Clinician".

Ruolo nel sistema
-----------------
Questo file appartiene al layer API del servizio "ai-assistant"
e fornisce una regola di autorizzazione applicativa
da usare sugli endpoint che devono essere accessibili
solo ai professionisti clinici autenticati.

Responsabilità principali
-------------------------
- Verificare che la richiesta provenga da un utente autenticato.
- Verificare che l'utente autenticato abbia ruolo "Clinician".
- Esporre un messaggio di errore coerente in caso di accesso non autorizzato.

Interazioni principali
----------------------
- BasePermission di Django REST Framework
- Oggetto request di Django REST Framework
- Principal autenticato associato a request.user

Note
-----
La permission non esegue autenticazione:
presuppone che request.user sia già stato popolato
dal meccanismo di autenticazione configurato a monte.
"""

from rest_framework.permissions import BasePermission


class IsClinician(BasePermission):
    """
    Consentire l'accesso solo agli utenti autenticati
    che possiedono il ruolo applicativo "Clinician".
    """

    message = "Solo utenti con ruolo 'Clinician' possono utilizzare l'assistente AI consultivo."

    def has_permission(self, request, view) -> bool:
        """
        Verificare se la richiesta corrente può accedere alla risorsa
        in base allo stato di autenticazione e al ruolo dell'utente.
        """

        # Recupera l'utente associato alla richiesta, se presente.
        user = getattr(request, "user", None)

        # Nega l'accesso se non esiste un principal associato
        # oppure se il principal non risulta autenticato.
        if not user or not getattr(user, "is_authenticated", False):
            return False

        # Consente l'accesso solo se il ruolo applicativo è esattamente "Clinician".
        return getattr(user, "role", "") == "Clinician"
