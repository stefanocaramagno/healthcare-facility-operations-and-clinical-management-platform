"""
File: services/ai-assistant/assistant/services/file_text_extractor.py

Scopo
------
Definire le utilità di estrazione testuale dagli allegati caricati
verso il servizio "ai-assistant", supportando un insieme controllato
di formati documentali e applicando limiti di sicurezza dimensionali.

Ruolo nel sistema
-----------------
Questo file appartiene al layer services del servizio "ai-assistant"
e fornisce le funzioni necessarie a:
- verificare che gli allegati rispettino i limiti di dimensione ammessi;
- estrarre testo da file testuali, PDF e DOCX;
- aggregare il contenuto di più allegati in un unico blocco testuale;
- produrre metadati utili al layer API per descrivere il processamento svolto.

Responsabilità principali
-------------------------
- Definire le eccezioni applicative relative agli allegati non validi.
- Caricare i limiti configurabili da variabili ambiente.
- Verificare la dimensione massima del singolo allegato.
- Estrarre il testo da un singolo file supportato.
- Estrarre e combinare il testo da una lista di allegati.
- Segnalare l'eventuale troncamento del contenuto aggregato.

Interazioni principali
----------------------
- UploadedFile di Django
- Libreria standard io
- Libreria standard os
- PyPDF2.PdfReader
- docx.Document
- Funzione extract_text_from_attachments

Note
-----
Il file non implementa OCR né parsing avanzato semantico dei documenti:
si limita a un'estrazione testuale essenziale, sufficiente per fornire
al modello AI un contesto documentale di base.
"""

import io
import os
from typing import Dict, List, Tuple

from django.core.files.uploadedfile import UploadedFile


class AttachmentTooLargeError(Exception):
    """
    Rappresentare l'errore sollevato quando un allegato supera
    la dimensione massima consentita dal servizio.
    """

    pass


class UnsupportedAttachmentError(Exception):
    """
    Rappresentare l'errore sollevato quando il formato dell'allegato
    non è supportato oppure manca la libreria necessaria a processarlo.
    """

    pass


# Dimensione massima ammessa per il singolo allegato, configurabile da ambiente.
_MAX_ATTACHMENT_SIZE_BYTES: int = int(
    os.getenv("AI_MAX_ATTACHMENT_SIZE_BYTES", str(2 * 1024 * 1024))
)

# Numero massimo di caratteri complessivi ammessi dopo l'estrazione e l'aggregazione.
_MAX_TOTAL_ATTACHMENT_CHARS: int = int(
    os.getenv("AI_MAX_ATTACHMENT_CHARS", "8000")
)

# Estensioni supportate per i file testuali semplici.
_SUPPORTED_TEXT_EXTENSIONS = {".txt", ".md"}

# Estensioni supportate per i file PDF.
_SUPPORTED_PDF_EXTENSIONS = {".pdf"}

# Estensioni supportate per i file DOCX.
_SUPPORTED_DOCX_EXTENSIONS = {".docx"}


def _ensure_size(upload: UploadedFile) -> None:
    """
    Verificare che il singolo allegato non superi
    la dimensione massima consentita dal servizio.
    """

    # Recupera la dimensione del file, se disponibile, dal metadato UploadedFile.
    size = getattr(upload, "size", None)

    # Blocca l'elaborazione se la dimensione eccede il limite configurato.
    if size is not None and size > _MAX_ATTACHMENT_SIZE_BYTES:
        raise AttachmentTooLargeError(
            f"Il file '{upload.name}' supera la dimensione massima consentita "
            f"({_MAX_ATTACHMENT_SIZE_BYTES} byte)."
        )


def _extract_text_from_single(upload: UploadedFile) -> str:
    """
    Estrarre il contenuto testuale da un singolo allegato supportato,
    applicando prima i controlli di dimensione e poi il parser coerente
    con l'estensione del file.
    """

    # Verifica preliminarmente che il file rispetti il limite dimensionale ammesso.
    _ensure_size(upload)

    # Determina nome file ed estensione normalizzata in minuscolo.
    filename = upload.name or ""
    _, ext = os.path.splitext(filename)
    ext = ext.lower()

    # Riposiziona il puntatore del file all'inizio
    # per garantire una lettura coerente del contenuto.
    upload.seek(0)

    # Gestisce i file testuali semplici decodificando il contenuto come UTF-8.
    if ext in _SUPPORTED_TEXT_EXTENSIONS:
        raw = upload.read()
        try:
            return raw.decode("utf-8", errors="ignore")
        except AttributeError:
            # In alcuni casi il contenuto potrebbe non essere bytes:
            # effettua comunque una conversione stringa difensiva.
            return str(raw)

    # Gestisce i PDF usando PyPDF2, se disponibile nell'ambiente.
    if ext in _SUPPORTED_PDF_EXTENSIONS:
        try:
            from PyPDF2 import PdfReader
        except ImportError as exc:
            raise UnsupportedAttachmentError(
                "Supporto PDF non disponibile: libreria PyPDF2 non installata."
            ) from exc

        # Legge l'intero contenuto del file in memoria
        # e prova a estrarre il testo da ciascuna pagina.
        data = upload.read()
        reader = PdfReader(io.BytesIO(data))
        texts = []
        for page in reader.pages:
            texts.append(page.extract_text() or "")
        return "\n".join(texts)

    # Gestisce i DOCX usando python-docx, se disponibile nell'ambiente.
    if ext in _SUPPORTED_DOCX_EXTENSIONS:
        try:
            from docx import Document
        except ImportError as exc:
            raise UnsupportedAttachmentError(
                "Supporto DOCX non disponibile: libreria python-docx non installata."
            ) from exc

        # Legge il file in memoria ed estrae il testo dai paragrafi del documento.
        data = upload.read()
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs)

    # Rifiuta esplicitamente le estensioni non supportate.
    raise UnsupportedAttachmentError(
        f"Tipo di file non supportato per l'allegato: '{filename}' "
        "(sono ammessi solo .txt, .md, .pdf, .docx)."
    )


def extract_text_from_attachments(
    uploads: List[UploadedFile],
) -> Tuple[str, Dict[str, object]]:
    """
    Estrarre e aggregare il testo da una lista di allegati supportati,
    restituendo sia il contenuto combinato sia i metadati del processamento.
    """

    # Se non sono presenti allegati, restituisce un risultato vuoto
    # con metadati coerenti e nessun troncamento.
    if not uploads:
        return "", {
            "count": 0,
            "total_bytes": 0,
            "truncated": False,
            "supported": True,
        }

    # Inizializza i contatori e il buffer dei contenuti estratti.
    total_bytes = 0
    texts: List[str] = []

    # Processa ogni allegato accumulando dimensione totale
    # e contenuto testuale estratto.
    for upload in uploads:
        size = getattr(upload, "size", None) or 0
        total_bytes += int(size)

        text = _extract_text_from_single(upload)
        if text:
            texts.append(text.strip())

    # Combina i contributi testuali dei singoli allegati
    # separandoli con doppio a-capo.
    combined = "\n\n".join(t for t in texts if t)
    truncated = False

    # Se il contenuto aggregato supera il limite massimo configurato,
    # tronca il testo e segnala l'evento nei metadati.
    if len(combined) > _MAX_TOTAL_ATTACHMENT_CHARS:
        combined = combined[:_MAX_TOTAL_ATTACHMENT_CHARS]
        truncated = True

    # Costruisce i metadati finali da restituire al chiamante.
    meta: Dict[str, object] = {
        "count": len(uploads),
        "total_bytes": total_bytes,
        "truncated": truncated,
        "supported": True,
    }

    return combined, meta
