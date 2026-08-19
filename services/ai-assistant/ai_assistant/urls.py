"""
File: services/ai-assistant/ai_assistant/urls.py

Scopo
-----
Definire il routing principale del progetto Django "ai_assistant",
delegando la gestione degli endpoint applicativi
al modulo URL dell'app "assistant".

Ruolo nel sistema
-----------------
Questo file appartiene al servizio "ai-assistant"
e rappresenta il punto di ingresso centrale della configurazione URL del progetto.
Il suo compito è collegare il root path dell'applicazione
alle rotte esposte dal layer API dell'app assistant.

Responsabilità principali
-------------------------
- Esporre l'insieme delle URL root del progetto Django.
- Delegare il routing effettivo all'applicazione assistant.api.

Note
----
La configurazione è volutamente minimale:
tutte le rotte del servizio vengono aggregate
e risolte tramite il modulo "assistant.api.urls".
"""

from django.urls import path, include

# Collezione principale delle route del progetto.
# Tutte le richieste indirizzate alla root del servizio
# vengono delegate al modulo URL dell'app assistant.api.
urlpatterns = [
    path("", include("assistant.api.urls")),
]
