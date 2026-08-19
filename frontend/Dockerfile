# File: frontend/Dockerfile
#
# Scopo
# -----
# Definire l'immagine container del frontend statico del progetto,
# servito tramite Nginx e configurato per distribuire pagine, asset
# e componenti riutilizzabili dell'interfaccia web.
#
# Ruolo nel sistema
# -----------------
# Questo Dockerfile costruisce il container del livello di presentazione,
# che espone la web application multi-page e inoltra le richieste API
# al gateway tramite la configurazione Nginx dedicata.
#
# Note
# ----
# - Il frontend è composto da risorse statiche organizzate per aree funzionali.
# - Nginx funge sia da web server per i file statici sia da reverse proxy
#   verso il backend tramite il file di configurazione copiato nel container.
# - L'immagine finale è minimale e non richiede fasi di build applicativa.

# Immagine base Nginx leggera, adatta a servire contenuti statici.
FROM nginx:1.27-alpine

# Sovrascrive la configurazione di default di Nginx con quella specifica del progetto,
# che definisce il comportamento del frontend e il proxy verso le API.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia la landing page o entry point principale del frontend.
COPY index.html /usr/share/nginx/html/index.html

# Copia il foglio di stile e le risorse CSS dell'applicazione.
COPY css /usr/share/nginx/html/css

# Copia tutti gli script JavaScript del frontend,
# inclusi file comuni e script specifici per ruolo/pagina.
COPY js /usr/share/nginx/html/js

# Copia gli asset statici condivisi, come immagini, icone o risorse grafiche.
COPY assets /usr/share/nginx/html/assets

# Copia le pagine HTML organizzate per area funzionale e per ruolo utente.
COPY pages /usr/share/nginx/html/pages

# Copia i frammenti/componenti HTML riutilizzabili dal frontend.
COPY components /usr/share/nginx/html/components

# Copia le pagine di errore personalizzate usate dal frontend.
COPY _errors /usr/share/nginx/html/_errors
