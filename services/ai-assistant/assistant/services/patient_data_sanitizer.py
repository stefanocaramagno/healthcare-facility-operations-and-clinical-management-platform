"""
File: services/ai-assistant/assistant/services/patient_data_sanitizer.py

Scopo
------
Definire utilità semplici e centralizzate per il rilevamento
di dati identificativi diretti del paziente all'interno del testo
inviato all'assistente AI consultivo.

Ruolo nel sistema
-----------------
Questo file appartiene al layer services del servizio "ai-assistant"
e fornisce una funzione di supporto usata per applicare controlli di safety
prima dell'invio dei contenuti al modello AI.
Il suo compito è individuare pattern testuali riconducibili a:
- indirizzi e-mail;
- numeri di telefono;
- codice fiscale italiano.

Responsabilità principali
-------------------------
- Definire le espressioni regolari usate per il rilevamento PII.
- Normalizzare il testo ricevuto in input.
- Rilevare la presenza di categorie PII supportate.
- Restituire un elenco ordinato delle violazioni individuate.

Interazioni principali
----------------------
- Modulo standard re
- Regex EMAIL_REGEX
- Regex PHONE_REGEX
- Regex CODICE_FISCALE_REGEX
- Funzione detect_pii

Note
-----
Il file non implementa anonimizzazione o mascheramento dei dati:
si limita al rilevamento di alcune categorie di PII diretta
tramite pattern regex volutamente semplici e rapidi da eseguire.
"""

import re
from typing import List


# Espressione regolare usata per individuare indirizzi e-mail
# in forma testuale standard.
EMAIL_REGEX = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

# Espressione regolare usata per individuare numeri di telefono
# in formati comuni con eventuale prefisso internazionale e separatori.
PHONE_REGEX = re.compile(r"\b(?:\+?\d{1,3}[\s-]?)?(?:\d[\s-]?){6,}\b")

# Espressione regolare usata per individuare il codice fiscale italiano,
# con matching case-insensitive.
CODICE_FISCALE_REGEX = re.compile(
    r"\b"
    r"[A-Z]{6}"
    r"[0-9]{2}"
    r"[A-EHLMPRST]"
    r"[0-9]{2}"
    r"[A-Z]"
    r"[0-9]{3}"
    r"[A-Z]"
    r"\b",
    re.IGNORECASE,
)


def detect_pii(text: str) -> List[str]:
    """
    Rilevare la presenza di dati identificativi diretti nel testo fornito
    e restituire l'elenco ordinato delle categorie individuate.
    """

    # Usa un set per evitare duplicazioni
    # nel caso in cui la stessa categoria venga rilevata più volte.
    violations = set()

    # Normalizza l'input rimuovendo spazi iniziali e finali.
    normalized = (text or "").strip()

    # Se il testo è assente o vuoto dopo la normalizzazione,
    # non esistono violazioni da segnalare.
    if not normalized:
        return []

    # Rileva la presenza di almeno un indirizzo e-mail.
    if EMAIL_REGEX.search(normalized):
        violations.add("email")

    # Rileva la presenza di almeno un numero di telefono.
    if PHONE_REGEX.search(normalized):
        violations.add("phone")

    # Rileva la presenza di almeno un codice fiscale italiano.
    if CODICE_FISCALE_REGEX.search(normalized):
        violations.add("codice_fiscale")

    # Restituisce le categorie rilevate in ordine stabile.
    return sorted(violations)
