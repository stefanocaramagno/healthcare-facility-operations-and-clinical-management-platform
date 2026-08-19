-- File: db/init/create_schemas.sql
--
-- Scopo:
-- Inizializzare gli schemi logici del database MySQL utilizzati dal progetto
-- e predisporre l'utenza applicativa con i relativi privilegi di accesso.
--
-- Ruolo nel sistema:
-- Questo script viene eseguito automaticamente da MySQL al primo avvio
-- del container e prepara il livello dati minimo necessario al corretto
-- funzionamento dei servizi backend.
--
-- Note:
-- - La suddivisione in più database riflette la separazione per domini
--   adottata nell'architettura del Core Service.
-- - L'utente applicativo riceve privilegi sui soli database del progetto.
-- - Lo script è pensato per il bootstrap dell'ambiente locale/containerizzato.

-- Schema dedicato al dominio Registry:
-- contiene identità, ruoli, profili, deleghe, consensi e dati utente correlati.
CREATE DATABASE IF NOT EXISTS healthcare_registry
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Schema dedicato al dominio Scheduling:
-- contiene disponibilità, slot, calendari clinici e appuntamenti.
CREATE DATABASE IF NOT EXISTS healthcare_scheduling
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Schema dedicato al dominio Clinical:
-- contiene catalogo prestazioni, pre-triage, encounter, referti e dati clinici.
CREATE DATABASE IF NOT EXISTS healthcare_clinical
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Schema dedicato al dominio Payments:
-- contiene intenzioni di pagamento, transazioni ed esiti economici.
CREATE DATABASE IF NOT EXISTS healthcare_payments
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Schema dedicato al dominio Events:
-- contiene notifiche, audit log e informazioni sugli eventi applicativi.
CREATE DATABASE IF NOT EXISTS healthcare_events
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- Crea l'utenza applicativa condivisa dai servizi backend, se non già presente.
CREATE USER IF NOT EXISTS 'app_user'@'%' IDENTIFIED BY 'app_password';

-- Concede all'utenza applicativa i privilegi completi sul database Registry.
GRANT ALL PRIVILEGES ON healthcare_registry.*   TO 'app_user'@'%';

-- Concede all'utenza applicativa i privilegi completi sul database Scheduling.
GRANT ALL PRIVILEGES ON healthcare_scheduling.* TO 'app_user'@'%';

-- Concede all'utenza applicativa i privilegi completi sul database Clinical.
GRANT ALL PRIVILEGES ON healthcare_clinical.*   TO 'app_user'@'%';

-- Concede all'utenza applicativa i privilegi completi sul database Payments.
GRANT ALL PRIVILEGES ON healthcare_payments.*   TO 'app_user'@'%';

-- Concede all'utenza applicativa i privilegi completi sul database Events.
GRANT ALL PRIVILEGES ON healthcare_events.*     TO 'app_user'@'%';

-- Applica immediatamente le modifiche ai privilegi.
FLUSH PRIVILEGES;
