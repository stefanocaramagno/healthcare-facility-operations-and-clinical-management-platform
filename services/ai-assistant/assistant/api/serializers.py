"""
File: services/ai-assistant/assistant/api/serializers.py

Scopo
------
Definire i serializer Django REST Framework
utilizzati dagli endpoint API dell'assistente AI consultivo,
sia per la validazione delle richieste in ingresso
sia per la strutturazione delle risposte in uscita.

Ruolo nel sistema
-----------------
Questo file appartiene al layer API del servizio "ai-assistant"
e fornisce i contratti di serializzazione e validazione
tra il client HTTP e la logica applicativa del servizio.
I serializer descrivono:
- il payload di richiesta per le domande del clinico;
- i metadati del modello;
- le informazioni di safety;
- i metadati degli allegati;
- il payload completo di risposta dell'assistente.

Responsabilità principali
-------------------------
- Validare i campi della richiesta del clinico.
- Normalizzare i contenuti testuali ricevuti in input.
- Definire la struttura tipizzata dei payload di risposta.
- Vincolare la presenza e il formato dei metadati API.

Interazioni principali
----------------------
- serializers di Django REST Framework
- ClinicianQARequestSerializer
- ModelInfoSerializer
- SafetyInfoSerializer
- AttachmentsMetaSerializer
- ClinicianQAResponseSerializer

Note
-----
Il file non contiene logica di business:
si occupa esclusivamente della validazione e rappresentazione dei dati
scambiati tramite le API del servizio.
"""

from rest_framework import serializers


class ClinicianQARequestSerializer(serializers.Serializer):
    """
    Validare il payload di richiesta inviato dal clinico
    per interrogare l'assistente AI consultivo.
    """

    question = serializers.CharField(
        required=True,
        allow_blank=False,
        trim_whitespace=True,
        max_length=4000,
    )
    context = serializers.CharField(
        required=False,
        allow_blank=True,
        trim_whitespace=True,
        max_length=12000,
    )

    def validate_question(self, value: str) -> str:
        """
        Validare e normalizzare il campo question,
        garantendo che il contenuto finale non sia vuoto.
        """

        # Normalizza il valore rimuovendo spazi iniziali e finali.
        normalized = (value or "").strip()

        # Rifiuta il campo se, dopo la normalizzazione, il contenuto risulta vuoto.
        if not normalized:
            raise serializers.ValidationError(
                "Il campo 'question' è obbligatorio e non può essere vuoto."
            )

        return normalized

    def validate_context(self, value: str) -> str:
        """
        Normalizzare il campo context rimuovendo eventuali spazi superflui.
        """

        # Restituisce sempre una stringa ripulita, anche in caso di valore assente.
        return (value or "").strip()


class ModelInfoSerializer(serializers.Serializer):
    """
    Rappresentare i metadati principali del modello AI
    utilizzato per generare la risposta.
    """

    id = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True
    )
    max_new_tokens = serializers.IntegerField(
        required=False,
        allow_null=True
    )
    temperature = serializers.FloatField(
        required=False,
        allow_null=True
    )


class SafetyInfoSerializer(serializers.Serializer):
    """
    Rappresentare le informazioni di safety associate alla richiesta
    e al processo di generazione della risposta.
    """

    pii_checked = serializers.BooleanField()
    pii_violations = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        allow_empty=True,
    )
    role = serializers.CharField()


class AttachmentsMetaSerializer(serializers.Serializer):
    """
    Rappresentare i metadati relativi agli eventuali allegati
    considerati durante l'elaborazione della richiesta.
    """

    count = serializers.IntegerField(min_value=0)
    total_bytes = serializers.IntegerField(min_value=0)
    truncated = serializers.BooleanField()
    supported = serializers.BooleanField()


class ClinicianQAResponseSerializer(serializers.Serializer):
    """
    Rappresentare il payload completo di risposta restituito
    dall'assistente AI consultivo al client chiamante.
    """

    answer = serializers.CharField(allow_blank=True)
    model = ModelInfoSerializer()
    safety = SafetyInfoSerializer()
    attachments = AttachmentsMetaSerializer()
    timestamp = serializers.DateTimeField()
