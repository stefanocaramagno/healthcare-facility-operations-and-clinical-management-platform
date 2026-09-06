"""
File: services/ai-assistant/assistant/services/ai_client.py

Scopo
------
Definire il client applicativo incaricato di caricare, inizializzare
e interrogare il modello linguistico usato dal servizio "ai-assistant"
per generare risposte consultive in ambito clinico.

Ruolo nel sistema
-----------------
Questo file appartiene al layer services del servizio "ai-assistant"
e fornisce:
- una classe client per la gestione del ciclo di vita del modello LLM;
- la logica di risoluzione della sorgente del modello locale o da cache;
- la costruzione dei prompt e degli input tensoriali;
- l'invocazione della generazione testuale;
- un singleton thread-safe del client predefinito del servizio.

Responsabilità principali
-------------------------
- Leggere la configurazione del modello da variabili ambiente.
- Determinare device, dtype e directory di cache da utilizzare.
- Localizzare correttamente il modello su filesystem o tramite model_id.
- Caricare tokenizer e modello una sola volta in modo thread-safe.
- Preparare i messaggi e gli input per la generazione.
- Eseguire la generazione della risposta AI.
- Esporre un'istanza singleton riutilizzabile del client.

Interazioni principali
----------------------
- torch
- AutoTokenizer di transformers
- AutoModelForCausalLM di transformers
- BatchEncoding di transformers
- Variabili ambiente AI_MODEL_ID, AI_MODEL_PATH, AI_MAX_NEW_TOKENS, AI_TEMPERATURE
- Variabili ambiente HUGGINGFACE_HUB_CACHE e TRANSFORMERS_CACHE
- Funzione get_default_client

Note
-----
Il file non espone endpoint HTTP e non implementa la logica di safety:
si occupa esclusivamente del caricamento e utilizzo del modello linguistico.
L'implementazione privilegia l'uso locale del modello e della cache,
evitando dipendenze da download remoti in fase di runtime.
"""

import os
import threading
import time
import logging
from pathlib import Path
from typing import Any, Dict, Optional, List, Tuple

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from transformers.tokenization_utils_base import BatchEncoding

# Logger di modulo usato per tracciare inizializzazione,
# caricamento modello, preparazione input e generazione risposta.
logger = logging.getLogger(__name__)


class ClinicalLLMClient:
    """
    Gestire il caricamento e l'utilizzo del modello linguistico clinico
    impiegato dal servizio AI assistant.

    La classe incapsula configurazione, tokenizer, modello,
    scelta del device, risoluzione della sorgente del modello
    e generazione delle risposte testuali.
    """

    def __init__(
        self,
        model_id: Optional[str] = None,
        max_new_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> None:
        """
        Inizializzare il client LLM leggendo la configurazione esplicita
        o, in alternativa, i valori provenienti dalle variabili ambiente.
        """

        self._model_id: str = model_id or os.getenv(
            "AI_MODEL_ID",
            "google/gemma-3-1b-it",
        )
        self._model_path: str = (os.getenv("AI_MODEL_PATH", "") or "").strip()

        self._max_new_tokens: int = max_new_tokens or int(
            os.getenv("AI_MAX_NEW_TOKENS", "256")
        )
        self._temperature: float = temperature or float(
            os.getenv("AI_TEMPERATURE", "0.2")
        )

        # Tokenizer e modello vengono caricati lazy,
        # solo al primo utilizzo effettivo del client.
        self._tokenizer: Optional[AutoTokenizer] = None
        self._model: Optional[AutoModelForCausalLM] = None

        # Determina il device di esecuzione preferendo CUDA quando disponibile.
        self._device: str = "cuda" if torch.cuda.is_available() else "cpu"

        # Determina la directory di cache dei modelli Hugging Face, se configurata.
        self._cache_dir: Optional[str] = (
            os.getenv("HUGGINGFACE_HUB_CACHE")
            or os.getenv("TRANSFORMERS_CACHE")
            or None
        )

        # Il servizio lavora in modalità locale-only:
        # non si affida a download runtime da remoto.
        self._local_files_only: bool = True

        # Lock usato per sincronizzare il caricamento lazy del modello
        # in presenza di accessi concorrenti.
        self._lock = threading.Lock()

        # Determina il dtype più opportuno in base al device disponibile.
        if self._device == "cuda":
            if hasattr(torch, "bfloat16"):
                self._torch_dtype = torch.bfloat16
            else:
                self._torch_dtype = torch.float16
        else:
            self._torch_dtype = torch.float32

        logger.info(
            "ClinicalLLMClient inizializzato "
            "(model_id=%s, model_path=%s, max_new_tokens=%d, temperature=%.2f, "
            "device=%s, torch_dtype=%s, cache_dir=%s, local_files_only=%s)",
            self._model_id,
            self._model_path or "-",
            self._max_new_tokens,
            self._temperature,
            self._device,
            str(self._torch_dtype),
            self._cache_dir,
            self._local_files_only,
        )

    @property
    def model_id(self) -> str:
        """
        Restituire l'identificativo logico del modello configurato per il client.
        """

        return self._model_id

    def _candidate_labels(self) -> List[str]:
        """
        Costruire un insieme di etichette candidate utili
        per riconoscere il modello corretto nelle directory locali o in cache.
        """

        # Usa come etichetta principale la parte finale del model_id.
        raw_tail = self._model_id.split("/")[-1].strip().lower()
        labels = [raw_tail]

        # Aggiunge una forma normalizzata del model_id
        # sostituendo lo slash con un separatore filesystem-safe.
        normalized = self._model_id.strip().lower().replace("/", "--")
        if normalized not in labels:
            labels.append(normalized)

        # Aggiunge anche una label più generica basata sulla famiglia del modello.
        family = raw_tail.split("-")[0]
        if family and family not in labels:
            labels.append(family)

        return labels

    def _is_local_model_dir(self, path: Path) -> bool:
        """
        Verificare se una directory contiene gli elementi minimi necessari
        per essere considerata una directory valida di modello locale.
        """

        # La directory deve esistere ed essere realmente una cartella.
        if not path.exists() or not path.is_dir():
            return False

        # Verifica la presenza della configurazione del modello.
        has_config = (path / "config.json").exists()

        # Verifica la presenza di un tokenizer in uno dei formati supportati.
        has_tokenizer = any(
            (path / name).exists()
            for name in (
                "tokenizer.json",
                "tokenizer.model",
                "tokenizer_config.json",
                "sentencepiece.bpe.model",
                "spiece.model",
            )
        )

        # Verifica la presenza dei pesi in formato safetensors o binario PyTorch.
        has_weights = bool(list(path.glob("*.safetensors"))) or bool(
            list(path.glob("pytorch_model*.bin"))
        )

        return has_config and has_tokenizer and has_weights

    def _discover_local_model_dir(self, root: Path) -> Optional[Path]:
        """
        Individuare, a partire da una root, la directory più probabile
        che contenga un modello locale valido.
        """

        # Se la root non esiste, non è possibile scoprire alcun modello.
        if not root.exists():
            return None

        # Se la root stessa è già una directory valida di modello, la restituisce subito.
        if self._is_local_model_dir(root):
            return root

        # Cerca ricorsivamente directory contenenti config.json
        # e poi filtra solo quelle che costituiscono un modello locale valido.
        candidates: List[Path] = []
        for cfg in root.rglob("config.json"):
            parent = cfg.parent
            if self._is_local_model_dir(parent):
                candidates.append(parent)

        if not candidates:
            return None

        labels = self._candidate_labels()

        def score(path: Path) -> Tuple[int, int, int, str]:
            """
            Calcolare uno score ordinabile per selezionare la directory candidata
            più coerente con il model_id configurato.
            """

            text = str(path).lower()
            best = 0

            # Premia le directory il cui nome o path matcha meglio le label candidate.
            for label in labels:
                if path.name.lower() == label:
                    best = max(best, 300)
                elif label in text:
                    best = max(best, 200)

            # Assegna un piccolo bonus ai path che contengono "snapshot",
            # tipici della struttura della cache Hugging Face.
            if "snapshot" in text:
                best += 25

            depth = len(path.parts)
            return (-best, depth, len(text), text)

        # Seleziona la directory con score migliore.
        selected = sorted(candidates, key=score)[0]
        return selected

    def _resolve_model_source(self) -> Tuple[str, str]:
        """
        Determinare la sorgente da cui caricare il modello,
        privilegiando AI_MODEL_PATH, poi la cache locale, infine il model_id.
        """

        # Se è stato configurato un path esplicito del modello,
        # prova a risolvere una directory valida partendo da lì.
        if self._model_path:
            root = Path(self._model_path)
            found = self._discover_local_model_dir(root)
            if found is None:
                raise RuntimeError(
                    "AI_MODEL_PATH è impostata, ma non è stata trovata alcuna "
                    f"directory valida del modello sotto '{root}'."
                )
            return ("path", str(found))

        # Se esiste una cache configurata, prova a localizzare il modello al suo interno.
        if self._cache_dir:
            found = self._discover_local_model_dir(Path(self._cache_dir))
            if found is not None:
                return ("path", str(found))

        # In assenza di una directory locale valida, ricade sul model_id.
        return ("model_id", self._model_id)

    def _ensure_model_loaded(self) -> None:
        """
        Garantire che tokenizer e modello siano caricati in memoria,
        eseguendo il caricamento una sola volta in modo thread-safe.
        """

        # Se modello e tokenizer sono già disponibili,
        # non è necessario eseguire ulteriori operazioni.
        if self._model is not None and self._tokenizer is not None:
            return

        with self._lock:
            # Ricontrolla dopo l'acquisizione del lock
            # per evitare caricamenti duplicati in caso di race condition.
            if self._model is not None and self._tokenizer is not None:
                return

            source_kind, source_value = self._resolve_model_source()

            logger.info(
                "Caricamento modello LLM avviato "
                "(source_kind=%s, source_value=%s, device=%s, torch_dtype=%s, cache_dir=%s)...",
                source_kind,
                source_value,
                self._device,
                str(self._torch_dtype),
                self._cache_dir,
            )
            start_time = time.monotonic()

            try:
                # Se la sorgente è una directory locale,
                # forza sempre il caricamento in local_files_only.
                if source_kind == "path":
                    self._tokenizer = AutoTokenizer.from_pretrained(
                        source_value,
                        local_files_only=True,
                    )
                    self._model = AutoModelForCausalLM.from_pretrained(
                        source_value,
                        local_files_only=True,
                        dtype=self._torch_dtype,
                    )
                else:
                    # In alternativa usa il model_id configurato,
                    # rispettando la cache e la policy local-only.
                    self._tokenizer = AutoTokenizer.from_pretrained(
                        self._model_id,
                        cache_dir=self._cache_dir,
                        local_files_only=self._local_files_only,
                    )
                    self._model = AutoModelForCausalLM.from_pretrained(
                        self._model_id,
                        cache_dir=self._cache_dir,
                        local_files_only=self._local_files_only,
                        dtype=self._torch_dtype,
                    )
            except Exception as exc:
                raise RuntimeError(
                    "Impossibile caricare il modello locale. "
                    f"model_id='{self._model_id}', "
                    f"model_path='{self._model_path or '-'}', "
                    f"cache_dir='{self._cache_dir or '-'}'. "
                    f"Dettaglio originale: {exc}"
                ) from exc

            # Se manca un pad_token ma esiste un eos_token,
            # riusa eos_token anche come pad_token per evitare problemi in generazione.
            if (
                getattr(self._tokenizer, "pad_token", None) is None
                and getattr(self._tokenizer, "eos_token", None) is not None
            ):
                self._tokenizer.pad_token = self._tokenizer.eos_token

            # Sposta il modello sul device scelto,
            # lo porta in eval mode e disabilita i gradienti globalmente.
            self._model.to(self._device)
            self._model.eval()
            torch.set_grad_enabled(False)

            elapsed = time.monotonic() - start_time
            logger.info(
                "Caricamento modello LLM completato in %.2f secondi.",
                elapsed,
            )

    def _build_messages(self, question: str, context: Optional[str]) -> List[Dict[str, str]]:
        """
        Costruire la conversazione strutturata da fornire al modello,
        includendo istruzioni di sistema e richiesta del clinico.
        """

        # Messaggio di sistema che impone i vincoli consultivi e di sicurezza
        # del comportamento del modello.
        system_message = (
            "Sei un assistente virtuale per medici e operatori sanitari. "
            "Fornisci spiegazioni chiare e strutturate basate sulle evidenze disponibili, "
            "citando quando possibile linee guida o buone pratiche, ma non sostituirti mai "
            "al giudizio clinico umano. Non formulare diagnosi definitive, non proporre "
            "terapie personalizzate e invita sempre a verificare le informazioni con le "
            "linee guida aggiornate e con gli specialisti competenti."
        )

        # Se è disponibile contesto aggiuntivo, lo incorpora esplicitamente
        # nel messaggio utente prima della richiesta di risposta.
        if context:
            user_content = (
                f"Domanda clinica:\n{question}\n\n"
                f"Contesto aggiuntivo fornito dal medico:\n{context}\n\n"
                "Rispondi in modo discorsivo, strutturato in paragrafi, e in lingua italiana."
            )
        else:
            user_content = (
                f"Domanda clinica:\n{question}\n\n"
                "Rispondi in modo discorsivo, strutturato in paragrafi, e in lingua italiana."
            )

        return [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_content},
        ]

    def _build_fallback_prompt(self, messages: List[Dict[str, str]]) -> str:
        """
        Costruire un prompt testuale lineare di fallback
        quando non è disponibile o non funziona il chat template del tokenizer.
        """

        parts: List[str] = []

        for message in messages:
            role = (message.get("role") or "user").strip().lower()
            content = (message.get("content") or "").strip()
            if not content:
                continue

            # Traduce i messaggi strutturati in blocchi testuali espliciti
            # adatti a un prompt lineare classico.
            if role == "system":
                parts.append(f"Istruzioni di sistema:\n{content}")
            elif role == "assistant":
                parts.append(f"Assistente:\n{content}")
            else:
                parts.append(f"Utente:\n{content}")

        # Aggiunge l'intestazione finale dell'assistente
        # per guidare il modello verso la continuazione corretta.
        parts.append("Assistente:\n")
        return "\n\n".join(parts)

    def _prepare_inputs(self, messages: List[Dict[str, str]]) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Preparare input_ids e attention_mask da fornire al modello
        a partire dalla lista di messaggi strutturati.
        """

        input_ids = None
        attention_mask = None

        try:
            # Primo tentativo: usa apply_chat_template con ritorno tokenizzato
            # e formato dictionary/tensor.
            rendered = self._tokenizer.apply_chat_template(
                messages,
                add_generation_prompt=True,
                tokenize=True,
                return_tensors="pt",
                return_dict=True,
            )

            if isinstance(rendered, BatchEncoding):
                input_ids = rendered.get("input_ids")
                attention_mask = rendered.get("attention_mask")

            elif isinstance(rendered, dict):
                input_ids = rendered.get("input_ids")
                attention_mask = rendered.get("attention_mask")

            elif torch.is_tensor(rendered):
                input_ids = rendered
                attention_mask = None

            else:
                raise TypeError(
                    f"Tipo restituito da apply_chat_template non supportato: {type(rendered).__name__}"
                )

        except TypeError:
            try:
                # Secondo tentativo: usa apply_chat_template
                # in una modalità più minimale senza return_dict.
                rendered = self._tokenizer.apply_chat_template(
                    messages,
                    add_generation_prompt=True,
                    return_tensors="pt",
                )

                if isinstance(rendered, BatchEncoding):
                    input_ids = rendered.get("input_ids")
                    attention_mask = rendered.get("attention_mask")

                elif isinstance(rendered, dict):
                    input_ids = rendered.get("input_ids")
                    attention_mask = rendered.get("attention_mask")

                elif torch.is_tensor(rendered):
                    input_ids = rendered
                    attention_mask = None

                else:
                    raise TypeError(
                        f"Tipo restituito da apply_chat_template non supportato: {type(rendered).__name__}"
                    )
            except Exception as exc:
                # Se anche il secondo tentativo fallisce,
                # usa un fallback basato su prompt lineare.
                logger.warning(
                    "apply_chat_template non disponibile o fallita. "
                    "Uso fallback prompt-based. Dettaglio: %s",
                    exc,
                )

                prompt = self._build_fallback_prompt(messages)
                encoded = self._tokenizer(prompt, return_tensors="pt")
                input_ids = encoded["input_ids"]
                attention_mask = encoded.get("attention_mask")

        except Exception as exc:
            # Qualsiasi altra eccezione porta al fallback prompt-based.
            logger.warning(
                "apply_chat_template non disponibile o fallita. "
                "Uso fallback prompt-based. Dettaglio: %s",
                exc,
            )

            prompt = self._build_fallback_prompt(messages)
            encoded = self._tokenizer(prompt, return_tensors="pt")
            input_ids = encoded["input_ids"]
            attention_mask = encoded.get("attention_mask")

        # Verifica che input_ids sia stato costruito correttamente.
        if input_ids is None:
            raise RuntimeError("Impossibile costruire input_ids per il modello.")

        # Se l'attention mask non è stata fornita,
        # la costruisce come maschera piena.
        if attention_mask is None:
            attention_mask = torch.ones_like(input_ids)

        # Verifica esplicitamente il tipo dei tensori
        # per intercettare formati non attesi.
        if not torch.is_tensor(input_ids):
            raise RuntimeError(
                f"input_ids non è un Tensor ma {type(input_ids).__name__}."
            )

        if not torch.is_tensor(attention_mask):
            raise RuntimeError(
                f"attention_mask non è un Tensor ma {type(attention_mask).__name__}."
            )

        return input_ids.to(self._device), attention_mask.to(self._device)

    def generate_answer(
        self,
        question: str,
        context: Optional[str] = None,
        max_new_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Generare una risposta testuale del modello
        a partire da una domanda clinica e da un eventuale contesto aggiuntivo.
        """

        # Blocca immediatamente input vuoti o composti solo da spazi.
        if not question or not question.strip():
            raise ValueError("La domanda non può essere vuota.")

        # Garantisce che modello e tokenizer siano caricati prima della generazione.
        self._ensure_model_loaded()

        # Costruisce i messaggi strutturati da fornire al modello.
        messages = self._build_messages(
            question=question.strip(),
            context=(context or "").strip(),
        )

        logger.info(
            "Preparazione input per generazione risposta (model=%s)...",
            self._model_id,
        )
        prep_start = time.monotonic()

        # Converte i messaggi nei tensori necessari alla generazione.
        input_ids, attention_mask = self._prepare_inputs(messages)
        prep_elapsed = time.monotonic() - prep_start
        logger.info("Preparazione input completata in %.2f secondi.", prep_elapsed)

        # Determina i parametri effettivi di generazione,
        # usando quelli espliciti o i default del client.
        effective_max_new_tokens = max_new_tokens or self._max_new_tokens
        effective_temperature = temperature or self._temperature
        do_sample = effective_temperature > 0

        # Determina pad token ed eos token da usare in generazione.
        pad_token_id = (
            getattr(self._tokenizer, "pad_token_id", None)
            or getattr(self._tokenizer, "eos_token_id", None)
        )
        eos_token_id = getattr(self._tokenizer, "eos_token_id", None)

        logger.info(
            "Generazione risposta avviata "
            "(model=%s, max_new_tokens=%d, temperature=%.2f, do_sample=%s, pad_token_id=%s, eos_token_id=%s)...",
            self._model_id,
            effective_max_new_tokens,
            effective_temperature,
            do_sample,
            str(pad_token_id),
            str(eos_token_id),
        )
        gen_start = time.monotonic()

        # Costruisce i kwargs di generazione condivisi.
        generation_kwargs: Dict[str, Any] = {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "max_new_tokens": effective_max_new_tokens,
            "do_sample": do_sample,
            "pad_token_id": pad_token_id,
            "use_cache": True,
        }

        # Se disponibile, passa anche l'eos token id.
        if eos_token_id is not None:
            generation_kwargs["eos_token_id"] = eos_token_id

        # Se la generazione è sampling-based, passa la temperatura effettiva.
        if do_sample:
            generation_kwargs["temperature"] = effective_temperature

        try:
            # Esegue la generazione in inference mode
            # per ridurre overhead e consumo memoria.
            with torch.inference_mode():
                outputs = self._model.generate(**generation_kwargs)
        except Exception as exc:
            raise RuntimeError(
                "Errore durante la generazione del testo da parte del modello. "
                f"device='{self._device}', dtype='{self._torch_dtype}', "
                f"max_new_tokens={effective_max_new_tokens}, "
                f"temperature={effective_temperature}, "
                f"pad_token_id={pad_token_id}, eos_token_id={eos_token_id}. "
                f"Dettaglio originale: {exc}"
            ) from exc

        gen_elapsed = time.monotonic() - gen_start
        logger.info(
            "Generazione risposta completata in %.2f secondi.",
            gen_elapsed,
        )

        # Separa i token generati dai token di prompt iniziali.
        generated_ids = outputs[0][input_ids.shape[-1]:]

        # Decodifica il testo finale rimuovendo i token speciali.
        answer = self._tokenizer.decode(
            generated_ids,
            skip_special_tokens=True,
        ).strip()

        logger.info(
            "Decodifica risposta completata (lunghezza_caratteri=%d).",
            len(answer),
        )

        return {
            "answer": answer,
            "model_id": self._model_id,
            "max_new_tokens": effective_max_new_tokens,
            "temperature": effective_temperature,
        }


# Istanza singleton lazy del client LLM predefinito del servizio.
_default_client: Optional[ClinicalLLMClient] = None

# Lock usato per sincronizzare la creazione del singleton.
_default_lock = threading.Lock()


def get_default_client() -> ClinicalLLMClient:
    """
    Restituire l'istanza singleton del client LLM predefinito,
    creandola una sola volta in modo thread-safe.
    """

    global _default_client

    # Fast path: se il client è già stato creato, lo restituisce subito.
    if _default_client is not None:
        return _default_client

    with _default_lock:
        # Double-check locking per evitare doppie inizializzazioni concorrenti.
        if _default_client is None:
            _default_client = ClinicalLLMClient()

        return _default_client
