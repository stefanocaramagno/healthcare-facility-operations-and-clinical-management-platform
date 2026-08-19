"""
File: services/ai-assistant/assistant/api/views.py

Scopo
------
Definire le view API del servizio "ai-assistant",
includendo sia l'endpoint di health check
sia l'endpoint consultivo di question answering riservato ai clinici.

Ruolo nel sistema
-----------------
Questo file appartiene al layer API del servizio "ai-assistant"
e rappresenta il punto di ingresso HTTP delle principali funzionalità esposte.
Il suo compito è:
- esporre un endpoint di health check per verifiche operative;
- validare, autorizzare e processare le richieste consultive dei clinici;
- orchestrare i servizi applicativi necessari alla generazione della risposta AI;
- costruire payload di risposta coerenti con il contratto API.

Responsabilità principali
-------------------------
- Esporre l'endpoint di health del servizio.
- Validare il payload delle richieste consultive.
- Applicare i controlli di autenticazione e autorizzazione.
- Estrarre testo dagli allegati eventualmente ricevuti.
- Eseguire controlli di safety sui dati inviati al modello.
- Invocare il client AI per generare la risposta.
- Restituire risposte JSON coerenti in caso di successo o errore.

Interazioni principali
----------------------
- APIView di Django REST Framework
- Funzione health
- IsClinician
- ClinicianQARequestSerializer
- ClinicianQAResponseSerializer
- get_default_client
- extract_text_from_attachments
- detect_pii

Note
-----
Il file non contiene la logica interna del modello AI né la logica di parsing
dei documenti allegati: tali responsabilità sono delegate ai servizi applicativi dedicati.
Questa componente si occupa principalmente di orchestrazione HTTP/API,
validazione dei dati e composizione delle risposte.
"""

import logging
from http import HTTPStatus
from typing import Any, Dict, List

from django.utils import timezone
from rest_framework import parsers, permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from assistant.api.permissions import IsClinician
from assistant.api.serializers import (
    ClinicianQARequestSerializer,
    ClinicianQAResponseSerializer,
)
from assistant.services.ai_client import get_default_client
from assistant.services.file_text_extractor import (
    AttachmentTooLargeError,
    UnsupportedAttachmentError,
    extract_text_from_attachments,
)
from assistant.services.patient_data_sanitizer import detect_pii

# Logger di modulo usato per tracciare errori e anomalie operative
# durante la gestione delle richieste API.
logger = logging.getLogger(__name__)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([])
def health(request: Request) -> Response:
    """
    Restituire lo stato operativo essenziale del servizio "ai-assistant".

    L'endpoint è pubblico e non richiede autenticazione,
    così da poter essere usato per health check e monitoring.
    """

    # Costruisce un payload minimale con stato del servizio,
    # nome logico del componente e timestamp corrente.
    payload: Dict[str, Any] = {
        "status": "ok",
        "service": "ai-assistant",
        "timestamp": timezone.now().isoformat(),
    }

    return Response(payload, status=HTTPStatus.OK)


class ClinicianQAView(APIView):
    """
    Gestire il flusso consultivo di question answering riservato ai clinici.

    La view valida il payload, processa eventuali allegati,
    applica controlli di safety sui contenuti inviati
    e invoca il client AI per generare una risposta strutturata.
    """

    permission_classes = [permissions.IsAuthenticated, IsClinician]
    parser_classes = [
        parsers.JSONParser,
        parsers.FormParser,
        parsers.MultiPartParser,
    ]

    def post(self, request: Request) -> Response:
        """
        Elaborare una richiesta consultiva del clinico,
        generando una risposta AI strutturata e sicura.
        """

        # Valida il payload principale della richiesta
        # usando il serializer dedicato.
        serializer = ClinicianQARequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Estrae i campi validati e gli eventuali allegati caricati.
        question = serializer.validated_data["question"]
        context = serializer.validated_data.get("context", "")
        attachments = list(request.FILES.getlist("attachments"))

        # Inizializza il testo estratto dagli allegati
        # e i metadati associati al processamento documentale.
        attachments_text: str = ""
        attachments_meta: Dict[str, Any] = {
            "count": 0,
            "total_bytes": 0,
            "truncated": False,
            "supported": True,
        }

        # Se sono presenti allegati, tenta di estrarne il contenuto testuale
        # delegando il lavoro al servizio applicativo dedicato.
        if attachments:
            try:
                attachments_text, attachments_meta = extract_text_from_attachments(attachments)
            except AttachmentTooLargeError as exc:
                # Restituisce un errore esplicito se uno o più allegati
                # superano la dimensione massima supportata.
                return Response(
                    {
                        "code": "attachment_too_large",
                        "message": str(exc),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except UnsupportedAttachmentError as exc:
                # Restituisce un errore esplicito se il formato degli allegati
                # non rientra tra quelli supportati dal servizio.
                return Response(
                    {
                        "code": "unsupported_attachment_type",
                        "message": str(exc),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except Exception as exc:
                # Registra l'errore tecnico e restituisce al client
                # un messaggio controllato di fallimento nel processamento allegati.
                logger.exception("Errore durante l'elaborazione degli allegati.")
                return Response(
                    {
                        "code": "attachment_processing_error",
                        "message": (
                            "Si è verificato un errore durante l'elaborazione degli allegati. "
                            "Verificare il formato e riprovare."
                        ),
                        "details": str(exc),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Costruisce progressivamente il contesto completo da inviare al modello,
        # combinando il contesto esplicito della richiesta con l'eventuale testo estratto.
        context_parts: List[str] = []
        if context:
            context_parts.append(context)

        if attachments_text:
            context_parts.append(
                "Estratto testuale (potenzialmente rilevante) dai documenti allegati:\n"
                + attachments_text
            )

        # Unisce le diverse porzioni di contesto con un separatore leggibile,
        # ottenendo il contesto finale da passare al modello.
        full_context = "\n\n---\n\n".join(context_parts).strip()

        # Costruisce il testo complessivo da sottoporre al controllo PII,
        # includendo sia la domanda sia l'eventuale contesto completo.
        text_for_pii_check = "\n\n".join(
            part for part in [question, full_context] if part
        )

        # Esegue il controllo di presenza di dati identificativi diretti del paziente.
        violations = detect_pii(text_for_pii_check)
        if violations:
            # Blocca la richiesta se vengono rilevati riferimenti sensibili
            # incompatibili con le policy del servizio.
            return Response(
                {
                    "code": "pii_not_allowed",
                    "message": (
                        "Il testo inviato all'assistente non deve contenere dati identificativi diretti "
                        "del paziente (es. email, numeri di telefono, codice fiscale). "
                        "Riformulare la domanda e/o il contenuto degli allegati rimuovendo tali riferimenti."
                    ),
                    "violations": violations,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Recupera il client AI predefinito configurato per il servizio.
        client = get_default_client()

        try:
            # Invoca il modello AI passando domanda e contesto eventualmente costruito.
            result = client.generate_answer(
                question=question,
                context=full_context or None,
            )
        except ValueError as exc:
            # Restituisce errore 400 quando il servizio AI segnala input non valido.
            return Response(
                {
                    "code": "invalid_input",
                    "message": str(exc),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:
            # Recupera le claims o il principal della richiesta
            # per arricchire il logging tecnico in caso di errore del modello.
            user_claims = request.auth or {}
            logger.exception(
                "Errore durante la generazione AI per clinician user_id=%s.",
                user_claims.get("sub")
                or user_claims.get("nameid")
                or user_claims.get(
                    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"
                )
                or getattr(request.user, "user_id", "-")
                or "-",
            )

            # Restituisce un errore 503 indicando che il problema
            # è avvenuto nella fase di generazione del modello.
            return Response(
                {
                    "code": "model_error",
                    "message": (
                        "Il modello AI ha restituito un errore durante la fase di generazione. "
                        "Controllare i log del servizio ai-assistant per il dettaglio tecnico."
                    ),
                    "details": str(exc),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # Costruisce il payload di risposta finale
        # includendo risposta, metadati modello, safety, allegati e timestamp.
        response_payload: Dict[str, Any] = {
            "answer": result.get("answer", ""),
            "model": {
                "id": result.get("model_id"),
                "max_new_tokens": result.get("max_new_tokens"),
                "temperature": result.get("temperature"),
            },
            "safety": {
                "pii_checked": True,
                "pii_violations": violations,
                "role": getattr(request.user, "role", ""),
            },
            "attachments": attachments_meta,
            "timestamp": timezone.now(),
        }

        # Valida e serializza il payload di risposta
        # secondo il contratto API esposto dal servizio.
        response_serializer = ClinicianQAResponseSerializer(response_payload)
        return Response(response_serializer.data, status=status.HTTP_200_OK)
