"""
File: services/ai-assistant/ai_assistant/settings.py

Scopo
-----
Definire la configurazione centrale del progetto Django "ai_assistant",
includendo impostazioni di base del framework, configurazione REST,
logging applicativo e variabili derivate dall'ambiente di esecuzione.

Ruolo nel sistema
-----------------
Questo file appartiene al servizio "ai-assistant" e rappresenta
il punto di configurazione principale dell'applicazione Django.
Il suo compito è:
- inizializzare i parametri fondamentali del progetto;
- configurare i componenti Django e Django REST Framework;
- definire le policy di autenticazione e gestione delle eccezioni;
- impostare il logging del servizio.

Responsabilità principali
-------------------------
- Definire i path base del progetto.
- Caricare le impostazioni principali tramite variabili ambiente.
- Registrare app installate e middleware.
- Configurare Django REST Framework.
- Configurare il logging applicativo.

Interazioni principali
----------------------
- Modulo standard os
- Classe Path di pathlib
- Django settings system
- Django REST Framework
- assistant.api.authentication.CoreJWTAuthentication
- assistant.api.exceptions.api_exception_handler
- Sistema di logging standard di Python

Note
----
Il servizio usa un database "dummy" perché non persiste dati localmente
tramite ORM Django; la logica applicativa si appoggia ad altri componenti
e servizi esterni. Le impostazioni sono pensate per un ambiente containerizzato
o di sviluppo controllato, con forte dipendenza dalle variabili ambiente.
"""

from pathlib import Path
import os

# Directory base del progetto Django, ricavata risalendo di due livelli
# rispetto al file corrente.
BASE_DIR = Path(__file__).resolve().parent.parent

# Chiave segreta Django letta dall'ambiente.
# In assenza di configurazione esplicita viene usato un valore di sviluppo,
# che dovrà essere sostituito in ambienti reali.
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "dev-secret-change-me")

# Flag che abilita o disabilita la modalità debug.
# Il valore viene interpretato come booleano a partire dalla variabile ambiente.
DEBUG = os.getenv("DJANGO_DEBUG", "false").lower() == "true"

# Host consentiti.
# Il valore "*" consente richieste da qualsiasi host ed è tipico
# di ambienti di sviluppo o ambienti interni controllati.
ALLOWED_HOSTS = ["*"]

# Elenco delle applicazioni Django installate nel progetto.
# Include:
# - staticfiles per la gestione degli asset statici;
# - rest_framework per le API REST;
# - assistant come app applicativa principale del servizio.
INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "rest_framework",
    "assistant",
]

# Middleware essenziali abilitati per il progetto.
# La configurazione è volutamente minimale:
# - SecurityMiddleware per aspetti base di sicurezza;
# - CommonMiddleware per funzionalità HTTP comuni.
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

# Modulo che espone il root URL configuration del progetto.
ROOT_URLCONF = "ai_assistant.urls"

# Nessun template engine configurato,
# coerentemente con un servizio orientato principalmente a JSON API.
TEMPLATES = []

# Entry point WSGI del progetto Django.
WSGI_APPLICATION = "ai_assistant.wsgi.application"

# Configurazione del database.
# Viene utilizzato il backend "dummy" perché il servizio non usa
# un database relazionale Django tradizionale per la propria logica operativa.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.dummy",
    }
}

# URL base per gli asset statici eventualmente esposti dal servizio.
STATIC_URL = "static/"

# Tipo predefinito per le primary key generate automaticamente da Django.
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Configurazione di Django REST Framework.
REST_FRAMEWORK = {
    # Forza la sola serializzazione JSON in output,
    # coerentemente con un servizio API-first.
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],

    # Parser accettati in input:
    # - JSON per payload API standard;
    # - Form e MultiPart per eventuali invii strutturati o file upload.
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ],

    # Classe di autenticazione custom basata su JWT,
    # delegata al modulo applicativo assistant.api.authentication.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "assistant.api.authentication.CoreJWTAuthentication",
    ],

    # Exception handler centralizzato custom
    # per uniformare il formato delle risposte di errore API.
    "EXCEPTION_HANDLER": "assistant.api.exceptions.api_exception_handler",

    # Disabilita la creazione automatica dell'utente anonimo Django
    # e del token anonimo, mantenendo il contesto di sicurezza più esplicito.
    "UNAUTHENTICATED_USER": None,
    "UNAUTHENTICATED_TOKEN": None,
}

# Livello di logging globale letto dall'ambiente.
# In assenza di override viene usato INFO.
LOG_LEVEL = os.getenv("DJANGO_LOG_LEVEL", "INFO").upper()

# Configurazione del logging applicativo.
LOGGING = {
    "version": 1,

    # Mantiene attivi gli eventuali logger esistenti del framework e delle librerie.
    "disable_existing_loggers": False,

    # Formatter semplice con timestamp, livello, nome logger e messaggio.
    "formatters": {
        "simple": {
            "format": "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        },
    },

    # Handler console per inviare i log allo standard output,
    # comportamento tipico in ambienti containerizzati.
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "simple",
        },
    },

    # Logger root applicato in modo globale al processo.
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },

    # Logger dedicato al client AI applicativo,
    # con propagazione disabilitata per evitare duplicazioni nel root logger.
    "loggers": {
        "assistant.services.ai_client": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
    },
}
