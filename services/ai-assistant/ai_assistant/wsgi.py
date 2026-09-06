"""
File: services/ai-assistant/ai_assistant/wsgi.py

Scopo
-----
Esporre l'application WSGI del progetto Django "ai_assistant",
necessaria per l'esecuzione del servizio tramite server compatibili WSGI.

Ruolo nel sistema
-----------------
Questo file appartiene al servizio "ai-assistant"
e rappresenta il punto di ingresso WSGI del progetto Django.
Il suo compito è:
- impostare il modulo di configurazione Django da utilizzare;
- costruire l'application WSGI esportata dal progetto;
- rendere il servizio integrabile con application server WSGI.

Responsabilità principali
-------------------------
- Definire la variabile ambiente DJANGO_SETTINGS_MODULE se non già presente.
- Inizializzare l'application WSGI del progetto.

Note
----
Questo file non contiene logica di business.
La sua responsabilità è esclusivamente infrastrutturale
e riguarda il bootstrap del runtime Django in modalità WSGI.
"""

import os
from django.core.wsgi import get_wsgi_application

# Imposta il modulo settings di Django come valore di default
# se la variabile ambiente non è già stata definita esternamente.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ai_assistant.settings')

# Costruisce ed espone l'application WSGI del progetto,
# che verrà utilizzata dal web server o application server di deploy.
application = get_wsgi_application()
