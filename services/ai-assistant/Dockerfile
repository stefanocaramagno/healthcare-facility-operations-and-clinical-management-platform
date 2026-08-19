# File: services/ai-assistant/Dockerfile
#
# Scopo
# -----
# Definire l'immagine container del servizio AI Assistant basato su Python,
# Django e Gunicorn, includendo l'installazione condizionale di PyTorch
# in variante CPU oppure GPU.
#
# Ruolo nel sistema
# -----------------
# Questo Dockerfile costruisce il container del modulo AI consultivo,
# separato dal Core Service, destinato all'elaborazione delle richieste
# del personale clinico tramite inferenza locale.
#
# Note
# ----
# - L'immagine è basata su Python slim per contenere il peso complessivo.
# - La variabile USE_GPU consente di scegliere in fase di build
#   tra installazione CPU-only e installazione con supporto CUDA.
# - Il servizio viene eseguito tramite Gunicorn esponendo l'applicazione WSGI Django.

# Immagine base Python minimale usata per costruire ed eseguire il servizio AI.
FROM python:3.12-slim

# Directory di lavoro interna al container.
WORKDIR /app

# Evita la generazione di file .pyc all'interno del container
# e forza l'output Python non bufferizzato, utile per i log in ambiente Docker.
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Argomento di build che permette di selezionare il tipo di installazione PyTorch.
ARG USE_GPU=false

# Rende disponibile anche a runtime il valore scelto in fase di build.
ENV USE_GPU=${USE_GPU}

# Copia il file delle dipendenze Python prima del sorgente completo,
# così da migliorare il caching Docker sulle installazioni.
COPY requirements.txt .

# Installa PyTorch in modo condizionale:
# - variante CUDA se USE_GPU=true;
# - variante CPU-only in tutti gli altri casi.
RUN if [ "$USE_GPU" = "true" ]; then \
  echo "Installing GPU-enabled PyTorch (CUDA)..." && \
  pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cu121 torch==2.5.1; \
  else \
  echo "Installing CPU-only PyTorch..." && \
  pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.5.1; \
  fi

# Installa le restanti dipendenze applicative dichiarate nel progetto.
RUN pip install --no-cache-dir -r requirements.txt

# Copia l'intero contenuto del servizio AI all'interno del container.
COPY . .

# Documenta la porta esposta dal servizio Django/Gunicorn.
EXPOSE 8000

# Avvia il servizio tramite Gunicorn usando l'applicazione WSGI Django.
# La configurazione privilegia semplicità e stabilità in un contesto dimostrativo:
# un solo worker, un solo thread e timeout estesi per richieste potenzialmente lunghe.
CMD ["gunicorn", "ai_assistant.wsgi:application", \
  "--bind", "0.0.0.0:8000", \
  "--workers", "1", \
  "--threads", "1", \
  "--timeout", "0", \
  "--graceful-timeout", "600"]

