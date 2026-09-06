"""
File: services/ai-assistant/manage.py

Scopo
-----
Fornire il punto di ingresso standard per l'esecuzione dei comandi Django
relativi al servizio AI Assistant.

Ruolo nel sistema
-----------------
Questo file consente di avviare utility di gestione del progetto Django,
come server di sviluppo, comandi amministrativi e operazioni di manutenzione,
utilizzando la configurazione corretta del modulo AI.

Responsabilità principali
-------------------------
- Impostare il modulo di settings Django predefinito.
- Delegare l'esecuzione dei comandi alla CLI di Django.
- Costituire l'entry point standard del progetto lato framework.

Interazioni principali
----------------------
- Modulo di configurazione ai_assistant.settings
- django.core.management.execute_from_command_line
- Argomenti passati da riga di comando

Note
----
Il file non contiene logica applicativa del dominio AI, ma solo il bootstrap
necessario a utilizzare correttamente l'infrastruttura Django.
"""

import os
import sys

def main():
    # Imposta il modulo di configurazione Django predefinito del servizio AI,
    # se non già definito nell'ambiente di esecuzione.
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ai_assistant.settings')

    # Importa il dispatcher standard dei comandi Django.
    from django.core.management import execute_from_command_line

    # Delega a Django l'esecuzione del comando richiesto da CLI.
    execute_from_command_line(sys.argv)

# Esegue il punto di ingresso solo quando il file viene lanciato direttamente.
if __name__ == '__main__':
    main()
