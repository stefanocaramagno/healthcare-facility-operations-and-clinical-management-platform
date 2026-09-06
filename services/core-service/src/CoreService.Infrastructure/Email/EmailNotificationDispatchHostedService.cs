/*
 * File: services/core-service/src/CoreService.Infrastructure/Email/EmailNotificationDispatchHostedService.cs
 *
 * Scopo
 * -----
 * Implementare un hosted service infrastrutturale responsabile
 * del recapito periodico delle notifiche e-mail pianificate.
 *
 * Ruolo nel sistema
 * -----------------
 * Questa classe appartiene al layer Infrastructure e opera come processo background
 * dedicato al polling delle notifiche e-mail pendenti.
 * Il suo compito è:
 * - recuperare a intervalli regolari le notifiche e-mail dovute;
 * - risolvere il destinatario applicativo associato alla notifica;
 * - inviare il messaggio tramite il sender e-mail configurato;
 * - aggiornare lo stato della notifica in base all'esito del recapito.
 *
 * Responsabilità principali
 * -------------------------
 * - Eseguire ciclicamente il polling delle notifiche e-mail pending.
 * - Processare le notifiche in batch.
 * - Gestire il recapito e-mail con aggiornamento dello stato finale.
 * - Gestire errori di invio e condizioni di destinatario non valido.
 * - Limitare e normalizzare i messaggi di errore persistiti.
 *
 * Interazioni principali
 * ----------------------
 * - IServiceScopeFactory
 * - INotificationsRepository
 * - IUserRepository
 * - INotificationEmailSender
 * - ILogger<EmailNotificationDispatchHostedService>
 *
 * Note
 * ----
 * Il servizio crea uno scope DI separato per ogni ciclo di polling,
 * così da utilizzare correttamente dipendenze scoped durante l'elaborazione.
 * Il loop viene interrotto in modo cooperativo tramite CancellationToken.
 */

using System;
using System.Threading;
using System.Threading.Tasks;
using CoreService.Application.Events.Repositories;
using CoreService.Application.Events.Abstractions;
using CoreService.Application.Registry.Repositories;
using CoreService.Domain.Events;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace CoreService.Infrastructure.Email;

public sealed class EmailNotificationDispatchHostedService : BackgroundService
{
    // Intervallo di polling tra un ciclo e il successivo.
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(15);

    // Numero massimo di notifiche processate per ciclo.
    private const int BatchSize = 25;

    // Factory usata per creare scope DI separati durante i cicli di elaborazione.
    private readonly IServiceScopeFactory _serviceScopeFactory;

    // Logger applicativo usato per tracciare errori e anomalie durante il recapito.
    private readonly ILogger<EmailNotificationDispatchHostedService> _logger;

    /*
     * Inizializza il servizio background con le dipendenze necessarie
     * alla creazione degli scope e al logging operativo.
     */
    public EmailNotificationDispatchHostedService(
        IServiceScopeFactory serviceScopeFactory,
        ILogger<EmailNotificationDispatchHostedService> logger)
    {
        _serviceScopeFactory = serviceScopeFactory
            ?? throw new ArgumentNullException(nameof(serviceScopeFactory));
        _logger = logger
            ?? throw new ArgumentNullException(nameof(logger));
    }

    /*
     * Esegue il loop principale del servizio background,
     * processando periodicamente le notifiche e-mail pianificate.
     */
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Continua a eseguire il polling finché il servizio non viene arrestato.
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Processa il batch corrente di notifiche e-mail pendenti.
                await ProcessPendingEmailsAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // Interrompe il loop in modo pulito quando la cancellazione
                // è stata richiesta dal ciclo di vita dell'host.
                break;
            }
            catch (Exception ex)
            {
                // Registra eventuali errori imprevisti senza terminare il servizio,
                // così da consentire nuovi tentativi nei cicli successivi.
                _logger.LogError(ex, "Errore durante il recapito delle notifiche e-mail pianificate.");
            }

            try
            {
                // Attende l'intervallo configurato prima di avviare il ciclo successivo.
                await Task.Delay(PollInterval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // Interrompe il loop in modo pulito se la cancellazione avviene durante l'attesa.
                break;
            }
        }
    }

    /*
     * Elabora il batch corrente delle notifiche e-mail pending già dovute.
     */
    private async Task ProcessPendingEmailsAsync(CancellationToken cancellationToken)
    {
        // Crea uno scope dedicato per risolvere correttamente
        // le dipendenze scoped utilizzate durante il ciclo corrente.
        using var scope = _serviceScopeFactory.CreateScope();

        // Recupera i servizi necessari al processamento del batch:
        // repository notifiche, repository utenti e sender e-mail.
        var notificationsRepository = scope.ServiceProvider.GetRequiredService<INotificationsRepository>();
        var userRepository = scope.ServiceProvider.GetRequiredService<IUserRepository>();
        var emailSender = scope.ServiceProvider.GetRequiredService<INotificationEmailSender>();

        // Acquisisce il timestamp corrente UTC per determinare
        // quali notifiche risultano già dovute al momento del polling.
        var nowUtc = DateTime.UtcNow;

        // Recupera il batch di notifiche e-mail pending già schedulate
        // e quindi pronte per il recapito.
        var dueNotifications = await notificationsRepository
            .GetDuePendingEmailNotificationsAsync(nowUtc, BatchSize, cancellationToken)
            .ConfigureAwait(false);

        foreach (var notification in dueNotifications)
        {
            // Verifica la cancellazione cooperativa prima di iniziare
            // l'elaborazione della singola notifica.
            cancellationToken.ThrowIfCancellationRequested();

            try
            {
                // Recupera l'utente destinatario associato alla notifica.
                var recipientUser = await userRepository
                    .GetByIdAsync(notification.RecipientUserId, cancellationToken)
                    .ConfigureAwait(false);

                // Se il destinatario non esiste, marca la notifica come fallita.
                if (recipientUser is null)
                {
                    notification.Status = NotificationStatus.Failed;
                    notification.SentAtUtc = null;
                    notification.Error = TruncateError("Utente destinatario non trovato.");
                }
                // Se il destinatario esiste ma non ha un indirizzo e-mail valido,
                // marca la notifica come fallita.
                else if (string.IsNullOrWhiteSpace(recipientUser.Email))
                {
                    notification.Status = NotificationStatus.Failed;
                    notification.SentAtUtc = null;
                    notification.Error = TruncateError("Il destinatario non dispone di un indirizzo e-mail.");
                }
                else
                {
                    // Invia la notifica e-mail al destinatario risolto.
                    await emailSender
                        .SendNotificationEmailAsync(
                            recipientUser.Email.Trim(),
                            notification.Subject,
                            notification.Body,
                            cancellationToken)
                        .ConfigureAwait(false);

                    // Aggiorna lo stato della notifica come inviata con successo.
                    notification.Status = NotificationStatus.Sent;
                    notification.SentAtUtc = DateTime.UtcNow;
                    notification.Error = null;
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // Propaga la cancellazione quando richiesta dal runtime,
                // interrompendo correttamente il processamento.
                throw;
            }
            catch (Exception ex)
            {
                // In caso di errore durante l'invio,
                // marca la notifica come fallita e persiste un messaggio sintetico.
                notification.Status = NotificationStatus.Failed;
                notification.SentAtUtc = null;
                notification.Error = TruncateError(ex.Message);

                // Registra il dettaglio tecnico nel logger per finalità diagnostiche.
                _logger.LogWarning(
                    ex,
                    "Invio e-mail non riuscito per la notifica {NotificationId}.",
                    notification.Id);
            }

            // Persiste sempre lo stato finale della notifica
            // dopo il tentativo di elaborazione della singola entry.
            await notificationsRepository
                .UpdateAsync(notification, cancellationToken)
                .ConfigureAwait(false);
        }
    }

    /*
     * Normalizza e tronca un messaggio di errore
     * per garantirne la persistenza entro la lunghezza massima prevista.
     */
    private static string? TruncateError(string? value)
    {
        // Restituisce null se il valore non contiene un messaggio significativo.
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        // Ripulisce il testo e lo limita a 255 caratteri,
        // coerentemente con il vincolo previsto per il campo di persistenza.
        var normalized = value.Trim();
        return normalized.Length <= 255
            ? normalized
            : normalized[..255];
    }
}
