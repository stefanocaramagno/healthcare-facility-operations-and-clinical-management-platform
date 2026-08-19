/*
 * File: services/core-service/src/CoreService.Domain/Clinical/VitalSignType.cs
 *
 * Scopo
 * -----
 * Definire l'enumerazione di dominio che rappresenta
 * le tipologie di parametri vitali rilevabili nel sistema.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa enum appartiene al layer Domain, nel contesto del bounded context Clinical,
 * e identifica in modo tipizzato le diverse misurazioni cliniche
 * che possono essere registrate durante un encounter.
 *
 * Responsabilità principali
 * -------------------------
 * - Rappresentare in forma tipizzata i parametri vitali supportati dal sistema.
 * - Consentire controlli applicativi coerenti nella registrazione e consultazione delle misurazioni.
 * - Garantire coerenza semantica tra dominio, application layer e API.
 *
 * Note
 * ----
 * I valori numerici espliciti garantiscono stabilità nella serializzazione
 * e nella persistenza del tipo di parametro vitale,
 * evitando dipendenze dall'ordine implicito dei membri dell'enumerazione.
 */

namespace CoreService.Domain.Clinical;

public enum VitalSignType
{
    // Frequenza cardiaca del paziente.
    HeartRate = 0,

    // Temperatura corporea espressa in gradi Celsius.
    TemperatureC = 1,

    // Saturazione di ossigeno del paziente.
    OxygenSaturation = 2,

    // Pressione arteriosa sistolica.
    BloodPressureSystolic = 3,

    // Pressione arteriosa diastolica.
    BloodPressureDiastolic = 4,

    // Peso corporeo espresso in chilogrammi.
    WeightKg = 5,

    // Altezza corporea espressa in centimetri.
    HeightCm = 6
}

