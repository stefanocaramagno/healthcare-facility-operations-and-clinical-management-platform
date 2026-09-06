# File: services/core-service/Dockerfile
#
# Scopo
# -----
# Definire la build multi-stage del Core Service sviluppato in ASP.NET Core,
# producendo un'immagine finale dedicata all'esecuzione dell'API applicativa
# con una separazione netta tra fase di compilazione e fase runtime.
#
# Ruolo nel sistema
# -----------------
# Questo Dockerfile costruisce il container del servizio principale del progetto,
# responsabile della business logic, dell'esposizione degli endpoint REST
# e del coordinamento dei domini applicativi centrali del portale sanitario.
#
# Note
# ----
# - La build è separata in due stage per ridurre la dimensione dell'immagine finale.
# - I file `.csproj` e la solution vengono copiati prima del sorgente completo
#   per sfruttare il caching Docker nella fase di restore delle dipendenze.
# - L'immagine finale usa il runtime ASP.NET Core e contiene solo l'output pubblicato.
# - Il servizio viene esposto sulla porta 8080 tramite la variabile `ASPNETCORE_URLS`.

# Stage di build:
# utilizza l'immagine SDK .NET necessaria per restore, compilazione e publish.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

# Imposta la directory di lavoro usata durante la build del progetto .NET.
WORKDIR /src

# Copia la solution principale del Core Service.
COPY CoreService.sln ./

# Copia i file di progetto dei vari layer applicativi prima del sorgente completo,
# così da massimizzare il riuso della cache Docker nella fase di restore.
COPY src/CoreService.Api/CoreService.Api.csproj src/CoreService.Api/
COPY src/CoreService.Application/CoreService.Application.csproj src/CoreService.Application/
COPY src/CoreService.Infrastructure/CoreService.Infrastructure.csproj src/CoreService.Infrastructure/
COPY src/CoreService.Domain/CoreService.Domain.csproj src/CoreService.Domain/

# Ripristina tutte le dipendenze NuGet necessarie alla solution.
RUN dotnet restore CoreService.sln

# Copia l'intero codice sorgente dei progetti del Core Service.
COPY src/ src/

# Pubblica il progetto API in configurazione Release,
# generando l'output pronto per il runtime nello stage finale.
RUN dotnet publish src/CoreService.Api/CoreService.Api.csproj -c Release -o /app/publish

# Stage runtime:
# utilizza l'immagine ASP.NET Core runtime per eseguire il servizio pubblicato.
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime

# Imposta la directory di lavoro del container runtime.
WORKDIR /app

# Configura Kestrel per ascoltare sulla porta 8080 all'interno del container.
ENV ASPNETCORE_URLS=http://+:8080

# Copia nello stage finale il contenuto pubblicato nel precedente stage di build.
COPY --from=build /app/publish .

# Documenta la porta di ascolto del Core Service.
EXPOSE 8080

# Definisce il comando di avvio del container:
# viene eseguita l'assembly principale dell'API ASP.NET Core.
ENTRYPOINT ["dotnet", "CoreService.Api.dll"]
