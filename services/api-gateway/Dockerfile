# File: services/api-gateway/Dockerfile
#
# Scopo
# -----
# Definire la build multi-stage del servizio API Gateway scritto in Go,
# producendo un'immagine finale leggera e adatta all'esecuzione del binario.
#
# Ruolo nel sistema
# -----------------
# Questo Dockerfile costruisce il container del gateway, che rappresenta
# il punto di ingresso unico per le richieste API provenienti dal frontend
# e si occupa di routing e responsabilità trasversali.
#
# Note
# ----
# - La build è separata in due stage per ridurre la dimensione finale dell'immagine.
# - Il binario viene compilato staticamente per l'esecuzione su Linux.
# - L'immagine runtime contiene solo ciò che è necessario all'avvio del gateway.

# Stage di build:
# utilizza l'immagine Go ufficiale per compilare il binario del gateway.
FROM golang:1.22-alpine AS build

# Imposta la directory di lavoro usata durante la build del progetto Go.
WORKDIR /src

# Installa certificati CA e Git:
# - i certificati sono utili durante il download delle dipendenze;
# - Git può essere richiesto da alcuni moduli Go in fase di risoluzione.
RUN apk add --no-cache ca-certificates git

# Copia i file di definizione dei moduli Go per sfruttare il caching Docker
# nella fase di download delle dipendenze.
COPY go.mod go.sum ./

# Scarica tutte le dipendenze dichiarate dal modulo.
RUN go mod download

# Copia il codice sorgente necessario alla compilazione del gateway.
COPY cmd/ cmd/
COPY internal/ internal/

# Compila il binario del gateway per Linux, disabilitando CGO per ottenere
# un eseguibile più semplice da distribuire nel container finale.
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/gateway ./cmd/gateway

# Stage runtime:
# utilizza un'immagine Alpine minimale per eseguire il binario compilato.
FROM alpine:3.20

# Installa i certificati CA necessari per eventuali connessioni HTTPS
# effettuate dal gateway verso servizi o endpoint esterni/interni.
RUN apk add --no-cache ca-certificates

# Imposta la directory di lavoro del container runtime.
WORKDIR /app

# Copia nello stage finale il binario compilato nel precedente stage di build.
COPY --from=build /out/gateway /app/gateway

# Documenta la porta di ascolto del servizio all'interno del container.
EXPOSE 8000

# Definisce il comando di avvio del container:
# viene eseguito direttamente il binario del gateway.
ENTRYPOINT ["/app/gateway"]

