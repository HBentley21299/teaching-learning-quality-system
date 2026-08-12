using TLQS.Api.Data;

namespace TLQS.Api.Messaging;

public sealed class MessageOutboxWorker(
    SqlFoundationDataStore store,
    IEmailProvider provider,
    MessagingConfigurationStore configurationStore,
    ILogger<MessageOutboxWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var settings = await configurationStore.GetEffectiveAsync(stoppingToken);
                if (!settings.Enabled)
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Max(10, settings.PollSeconds)), stoppingToken);
                    continue;
                }

                var dispatchedEvents = await store.DispatchDomainEventBatchAsync(20, ToOptions(settings), stoppingToken);
                var ids = await store.ClaimMessageBatchAsync(10, stoppingToken);
                foreach (var id in ids)
                {
                    await DeliverAsync(id, settings.Provider, stoppingToken);
                }

                if (ids.Count == 0 && dispatchedEvents == 0)
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(settings.PollSeconds, 2, 300)), stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "The message outbox worker failed. Delivery will be retried after the polling interval.");
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
        }
    }

    private async Task DeliverAsync(Guid id, string providerName, CancellationToken cancellationToken)
    {
        var item = await store.GetMessageWorkItemAsync(id, cancellationToken);
        if (item is null) return;
        var startedAt = DateTimeOffset.UtcNow;
        try
        {
            if (item.Email.Recipients.Count == 0) throw new InvalidOperationException("The message has no authorised recipients.");
            var result = await provider.SendAsync(item.Email, cancellationToken);
            await store.CompleteMessageDeliveryAsync(
                item, startedAt, providerName, result.ProviderResponseId, cancellationToken);
            logger.LogInformation("Message {MessageId} delivered on attempt {AttemptNumber}.", item.Id, item.AttemptCount + 1);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            await store.FailMessageDeliveryAsync(
                item, startedAt, providerName, SafeError(exception), cancellationToken);
            logger.LogWarning("Message {MessageId} failed on attempt {AttemptNumber}.", item.Id, item.AttemptCount + 1);
        }
    }

    private static string SafeError(Exception exception)
    {
        var value = exception.Message.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return value[..Math.Min(value.Length, 1800)];
    }

    private static MessagingOptions ToOptions(MessagingRuntimeConfiguration settings) => new()
    {
        Enabled = settings.Enabled,
        TestMode = settings.TestMode,
        Provider = settings.Provider,
        TenantId = settings.TenantId,
        ClientId = settings.ClientId,
        ClientSecret = settings.ClientSecret,
        SenderAddress = settings.SenderAddress,
        SenderDisplayName = settings.SenderDisplayName,
        ReplyToAddress = settings.ReplyToAddress,
        TestRecipient = settings.TestRecipient,
        ApplicationUrl = settings.ApplicationUrl,
        PollSeconds = settings.PollSeconds,
        SmtpHost = settings.SmtpHost,
        SmtpPort = settings.SmtpPort,
        SmtpSecurity = settings.SmtpSecurity,
        SmtpAuthentication = settings.SmtpAuthentication,
        SmtpUsername = settings.SmtpUsername,
        SmtpPassword = settings.SmtpPassword
    };
}
