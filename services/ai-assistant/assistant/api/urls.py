"""
File: services/ai-assistant/assistant/api/urls.py

Scopo
------
Definire il routing API dell'applicazione assistant,
esponendo gli endpoint HTTP disponibili del servizio "ai-assistant".

Ruolo nel sistema
-----------------
Questo file appartiene al layer API del servizio "ai-assistant"
e rappresenta il punto di aggregazione delle route pubbliche
esposte dall'app assistant.
Il suo compito è collegare i path HTTP
alle view o funzioni di view che implementano i relativi endpoint.

Responsabilità principali
-------------------------
- Esporre l'endpoint di health check del servizio.
- Esporre l'endpoint consultivo di question answering per i clinici.
- Associare a ciascun path un nome logico di route riutilizzabile nel progetto.

Interazioni principali
----------------------
- path di Django
- Funzione health
- Classe ClinicianQAView

Note
-----
Il file non contiene logica di business:
si occupa esclusivamente della definizione del routing HTTP
dell'app assistant.
"""

from django.urls import path

from .views import ClinicianQAView, health


# Collezione delle URL pubbliche esposte dall'app assistant.
urlpatterns = [
    # Espone l'endpoint di health check del servizio,
    # utile per verifiche operative e controlli di disponibilità.
    path("health", health, name="health"),

    # Espone l'endpoint di question answering riservato al flusso consultivo dei clinici.
    path("clinicians/qa", ClinicianQAView.as_view(), name="clinician_qa"),
]
