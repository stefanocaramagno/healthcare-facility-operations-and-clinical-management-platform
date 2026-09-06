# Healthcare Facility Operations and Clinical Management Platform

## 1. Panoramica del progetto

Questo progetto consiste in una piattaforma web multi-ruolo per la gestione del percorso clinico e amministrativo di una struttura sanitaria privata.

Il sistema è stato progettato per supportare l’intero flusso operativo principale:

* autenticazione e gestione degli account;
* gestione anagrafica di pazienti, delegati e clinici;
* pubblicazione delle disponibilità e prenotazione degli appuntamenti;
* pre-triage;
* presa in carico clinica e compilazione dell’encounter;
* refertazione;
* pagamenti;
* notifiche e audit;
* supporto consultivo tramite assistente AI per il clinico.

L’architettura è containerizzata e orchestrata tramite **Docker Compose**, con una separazione chiara tra frontend, API Gateway, core applicativo, microservizio AI, database e servizi di supporto.

---

## 2. Architettura logica del sistema

L’applicazione è organizzata nei seguenti blocchi principali:

* **Frontend**: applicazione multi-page statica servita da Nginx, realizzata con HTML, CSS, Tailwind CSS e JavaScript;
* **API Gateway**: servizio in Go con Gin che funge da entry point unico per le API, applicando routing, verifica JWT, CORS, rate limiting, request ID e logging;
* **Core Service**: backend principale in ASP.NET Core 8 che implementa la logica di dominio;
* **AI Assistant**: microservizio Django + Django REST Framework per il supporto consultivo al clinico;
* **MySQL**: istanza unica con organizzazione **schema-per-domain**;
* **Mailpit**: SMTP sink locale per la simulazione e l’ispezione delle email generate dal sistema.

Per una visione architetturale completa è disponibile il diagramma in:

```text
docs/architectural_diagram.png
```

---

## 3. Stack tecnologico

### Frontend

* HTML5
* CSS3
* Tailwind CSS
* JavaScript
* Nginx

### Backend e servizi

* Go 1.22 + Gin
* ASP.NET Core 8
* Python 3.12
* Django
* Django REST Framework
* Gunicorn

### Persistenza e infrastruttura

* MySQL 8.0
* Docker
* Docker Compose
* Mailpit

### AI locale

* PyTorch
* Hugging Face Transformers
* cache locale montata in `hf_cache`

---

## 4. Struttura della repository

Struttura logica della root del progetto:

```text
.
├── .env
├── .gitignore
├── docker-compose.yml
├── db/
│   └── init/
│       └── create_schemas.sql
├── docs/
│   ├── architectural_diagram.png
│   └── written_report.pdf
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── index.html
│   ├── assets/
│   ├── components/
│   ├── css/
│   ├── js/
│   ├── pages/
│   └── _errors/
├── hf_cache/
└── services/
    ├── api-gateway/
    │   ├── Dockerfile
    │   ├── cmd/
    │   └── internal/
    ├── ai-assistant/
    │   ├── Dockerfile
    │   ├── requirements.txt
    │   ├── ai_assistant/
    │   └── assistant/
    └── core-service/
        ├── Dockerfile
        ├── CoreService.sln
        └── src/
            ├── CoreService.Api/
            ├── CoreService.Application/
            ├── CoreService.Domain/
            └── CoreService.Infrastructure/
```

---

## 5. Prerequisiti

Per eseguire il progetto in ambiente locale sono necessari:

* **Docker** installato e funzionante;
* **Docker Compose** integrato nel comando `docker compose`;
* una macchina con risorse sufficienti a eseguire più container contemporaneamente;
* connettività Internet in fase di build delle immagini, salvo disponibilità completa delle immagini e dei package già in cache locale.

### Requisiti consigliati

* CPU multi-core;
* almeno **8 GB di RAM**;
* spazio disco sufficiente per immagini Docker, volumi MySQL e dipendenze Python/.NET/Go.

---

## 6. Configurazione del progetto

### 6.1 File `.env`

La root della repository contiene già un file `.env` con una configurazione di sviluppo locale.

Le principali variabili configurate riguardano:

* credenziali MySQL;
* nomi dei database di dominio;
* configurazione JWT condivisa tra Core Service, API Gateway e AI Assistant;
* URL interni dei servizi;
* parametri SMTP locali;
* URL pubblici usati nei flussi di attivazione account e reset password.

In uno scenario di sviluppo locale standard non è necessario modificare il file `.env` per il primo avvio.

### 6.2 Cache locale del modello AI

L’assistente AI è stato progettato per lavorare in modalità **offline/local-first**.
Il container `ai-assistant` monta in sola lettura la directory:

```text
./hf_cache
```

all’interno del path:

```text
/root/.cache/huggingface/hub
```

Il servizio utilizza `local_files_only=True`, quindi **non scarica automaticamente** il modello dal web durante l’inferenza.

Di conseguenza:

* se la cache locale contiene già i file del modello compatibile, l’assistente AI può essere utilizzato normalmente;
* se la cache è vuota o incompleta, il container può avviarsi ma le richieste verso l’endpoint AI falliranno in fase di caricamento del modello.

### 6.3 Nota operativa sull’AI Assistant

Per utilizzare correttamente il servizio AI è necessario soddisfare almeno una delle seguenti condizioni:

1. popolare preventivamente la directory `hf_cache` con i file del modello richiesto;
2. adattare la configurazione del servizio AI per puntare a un percorso locale valido del modello;
3. predisporre una cache Hugging Face locale coerente con il modello atteso dal microservizio.

Il progetto è configurato, per default, per lavorare con una pipeline LLM locale orientata a uso offline e non con un servizio cloud esterno.

---

## 7. Build e deploy con Docker Compose

Tutte le istruzioni seguenti devono essere eseguite dalla **root del progetto**, cioè dalla directory che contiene `docker-compose.yml`.

### 7.1 Build e avvio completo dello stack

```bash
docker compose up --build
```

Questo comando:

* builda le immagini locali dei servizi applicativi;
* crea e avvia i container;
* inizializza il database MySQL;
* avvia frontend, gateway, core service, AI assistant e Mailpit.

### 7.2 Avvio in background

```bash
docker compose up --build -d
```

### 7.3 Visualizzazione dei log

Per visualizzare tutti i log:

```bash
docker compose logs -f
```

Per visualizzare i log di servizi specifici:

```bash
docker compose logs -f frontend api-gateway core-service ai-assistant mysql mailpit
```

### 7.4 Arresto dello stack

```bash
docker compose down
```

### 7.5 Arresto con rimozione dei volumi

```bash
docker compose down -v
```

Questo comando elimina anche il volume persistente di MySQL. Al successivo avvio verrà ricreata una base dati pulita e il seed verrà rieseguito.

### 7.6 Rebuild forzato senza usare cache Docker

```bash
docker compose build --no-cache
docker compose up -d
```

### 7.7 Riavvio di un singolo servizio

```bash
docker compose restart api-gateway
```

oppure, ad esempio:

```bash
docker compose restart core-service
```

---

## 8. Servizi esposti e porte

| Servizio     | Descrizione                      | Porta host | Porta container |
| ------------ | -------------------------------- | ---------: | --------------: |
| frontend     | Interfaccia web servita da Nginx |       8080 |              80 |
| api-gateway  | Entry point delle API            |       8000 |            8000 |
| core-service | Backend principale ASP.NET Core  |       5000 |            8080 |
| ai-assistant | Microservizio Django/DRF         |       8001 |            8000 |
| mysql        | Database MySQL                   |       3306 |            3306 |
| mailpit      | Interfaccia web Mailpit          |       8025 |            8025 |

---

## 9. URL utili dopo l’avvio

### Accesso applicativo

* Frontend: `http://localhost:8080`
* Pagina login: `http://localhost:8080/pages/auth/login.html`

### Health check

* Gateway locale: `http://localhost:8000/health`
* Gateway aggregato: `http://localhost:8000/api/health`
* Core Service: `http://localhost:5000/health`
* AI Assistant: `http://localhost:8001/health`

### Servizi di supporto

* Mailpit UI: `http://localhost:8025`

### Nota sul routing

L’accesso normale dell’utente avviene tramite il **frontend** all’indirizzo `http://localhost:8080`.
Le chiamate API del browser vengono inoltrate da Nginx al gateway tramite il path `/api/*`.

---

## 10. Sequenza di bootstrap applicativo

All’avvio dello stack avvengono i seguenti passaggi principali:

1. **MySQL** avvia l’istanza e crea i database di dominio tramite lo script in `db/init/`;
2. **Core Service** attende la disponibilità di MySQL, crea lo schema applicativo e applica un seed iniziale dei dati demo;
3. **AI Assistant** avvia Django/Gunicorn in modalità stateless;
4. **API Gateway** si avvia come front-door delle API;
5. **Frontend** espone l’applicazione MPA tramite Nginx e inoltra `/api/*` al gateway;
6. **Mailpit** riceve le email simulate generate dai flussi applicativi.

---

## 11. Dataset demo iniziale

Il Core Service esegue automaticamente un seed iniziale quando il sistema risulta vuoto.

Sono previsti account demo già attivi per i ruoli principali:

| Ruolo     | Email                        | Password        |
| --------- | ---------------------------- | --------------- |
| Admin     | `admin@healthcare.local`     | `Admin123!`     |
| Clinician | `clinician@healthcare.local` | `Clinician123!` |
| Patient   | `patient@healthcare.local`   | `Patient123!`   |
| Delegate  | `delegate@healthcare.local`  | `Delegate123!`  |

Il seed inizializza anche, in forma dimostrativa:

* profili anagrafici di base;
* una delega attiva;
* consensi;
* catalogo prestazioni;
* calendario del clinico;
* slot di disponibilità;
* almeno un appuntamento;
* dati clinici iniziali;
* elementi del dominio pagamenti;
* notifiche e audit di esempio.

---

## 12. Verifica rapida post-avvio

Dopo il bootstrap, la verifica minima consigliata è la seguente.

### 12.1 Verifica dei container

```bash
docker compose ps
```

Tutti i servizi principali dovrebbero risultare in stato `running`.

### 12.2 Verifica health del gateway

```bash
curl http://localhost:8000/health
```

### 12.3 Verifica health aggregata

```bash
curl http://localhost:8000/api/health
```

### 12.4 Verifica accesso frontend

Aprire nel browser:

```text
http://localhost:8080
```

### 12.5 Verifica invio email locale

Aprire nel browser:

```text
http://localhost:8025
```

per controllare eventuali email generate da:

* attivazione account;
* reset password;
* notifiche pianificate.

---

## 13. Modalità d’uso consigliata per la demo

Per una dimostrazione funzionale ordinata si suggerisce il seguente percorso:

1. avviare lo stack con Docker Compose;
2. verificare lo stato tramite `docker compose ps` e gli endpoint di health;
3. accedere al frontend da `http://localhost:8080`;
4. effettuare il login con uno degli account demo;
5. mostrare il flusso specifico per ruolo:

   * **Admin**: anagrafiche, booking, check-in, pagamenti, notifiche, audit;
   * **Clinician**: agenda, encounter, referto, AI assistant;
   * **Patient**: servizi, prenotazioni, pagamenti, pre-triage, referti, notifiche;
   * **Delegate**: gestione dell’assistito, prenotazioni, pre-triage, referti, pagamenti.

---

## 14. Modalità di accesso alle API

Dal punto di vista architetturale, i servizi sono esposti separatamente anche sull’host locale, ma il percorso corretto per il client web è il seguente:

* browser → `frontend` su `:8080`;
* Nginx → proxy verso `api-gateway`;
* gateway → dispatch verso `core-service` oppure `ai-assistant`.

In altre parole:

* l’utente finale utilizza **normalmente** il frontend;
* il gateway è l’entry point logico delle API;
* il core e l’AI assistant sono servizi applicativi downstream.

---

## 15. Artefatti documentali inclusi

La repository include nella cartella `docs/` i principali artefatti documentali del progetto:

```text
docs/
├── architectural_diagram.png
└── written_report.pdf
```

* `architectural_diagram.png`: diagramma architetturale del sistema;
* `written_report.pdf`: relazione tecnica completa del progetto.

---

## 16. Note sul deploy locale

### 16.1 Persistenza del database

Il database MySQL utilizza un volume Docker nominato:

```text
mysql_data
```

I dati restano persistenti tra riavvii dello stack finché non viene eseguito:

```bash
docker compose down -v
```

### 16.2 Ambiente di sviluppo locale

La configurazione fornita è orientata a un ambiente **locale di sviluppo e dimostrazione**.
Le credenziali presenti nel file `.env` e gli account demo seedati non sono pensati per ambienti di produzione.

### 16.3 AI Assistant e modello locale

Il microservizio AI è avviabile anche senza persistenza locale, ma la funzionalità di inferenza richiede che il modello sia effettivamente disponibile in cache o in un percorso locale valido.

---

## 17. Troubleshooting

### 17.1 Il frontend si apre ma le API non rispondono

Verificare:

```bash
docker compose ps
docker compose logs -f api-gateway core-service
```

Controllare inoltre che le porte `8080`, `8000` e `5000` non siano occupate da altri processi.

### 17.2 Il gateway restituisce errori di health aggregata

Verificare i downstream:

```bash
curl http://localhost:5000/health
curl http://localhost:8001/health
```

### 17.3 Il login non funziona

Verificare:

* che il seed sia stato eseguito correttamente;
* che MySQL sia partito senza errori;
* che non sia stato rimosso il volume con dati attesi;
* che si stiano usando le credenziali demo corrette.

Per approfondire:

```bash
docker compose logs -f mysql core-service
```

### 17.4 Le email non arrivano

Nel progetto di sviluppo locale le email non vengono inviate a provider esterni, ma vengono recapitate in **Mailpit**.
Aprire:

```text
http://localhost:8025
```

### 17.5 L’assistente AI risponde con errore del modello

Questo è il caso tipico in cui:

* la cache `hf_cache` è vuota;
* il modello atteso non è presente localmente;
* la configurazione non punta a un percorso valido del modello.

Controllare i log:

```bash
docker compose logs -f ai-assistant
```

### 17.6 È necessario ripartire da uno stato completamente pulito

Eseguire:

```bash
docker compose down -v
docker compose up --build -d
```

---

## 18. Comandi utili riassuntivi

### Avvio completo

```bash
docker compose up --build -d
```

### Stato dei servizi

```bash
docker compose ps
```

### Log globali

```bash
docker compose logs -f
```

### Arresto

```bash
docker compose down
```

### Reset completo con rimozione dati MySQL

```bash
docker compose down -v
```

---

## 19. Considerazioni finali

Il progetto è stato strutturato per essere eseguibile in modo coerente e riproducibile in ambiente locale tramite container, mantenendo una netta separazione tra interfaccia utente, integrazione, logica applicativa, supporto AI e persistenza.

Il presente `README.md` ha lo scopo di fornire una guida operativa sintetica e rigorosa per:

* configurare l’ambiente;
* eseguire build e avvio dello stack;
* verificare la corretta disponibilità dei servizi;
* orientarsi tra gli artefatti principali della repository.
