using Microsoft.Extensions.Options;
using TLQS.Api.Data;

namespace TLQS.Api.Messaging;

public sealed class MessageOutboxWorker(
    SqlFoundationDataStore store,
    IEmailProvider provider,
    IOptions<MessagingOptions> configuredOptions,
    ILogger<MessageOutboxWorker> logger) : BackgroundService
{
    private readonly MessagingOptions _options = configuredOptions.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!_options.Enabled)
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Max(10, _options.PollSeconds)), stoppingToken);
                    continue;
                }

                var dispatchedEvents = await store.DispatchDomainEventBatchAsync(20, _options, stoppingToken);
                var ids = await store.ClaimMessageBatchAsync(10, stoppingToken);
                foreach (var id in ids)
                {
                    await DeliverAsync(id, stoppingToken);
                }

                if (ids.Count == 0 && dispatchedEvents == 0)
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(_options.PollSeconds, 2, 300)), stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "The message outbox worker failed. Delivery will be retried after the polling interval.");
                await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(_options.PollSeconds, 5, 300)), stoppingToken);
            }
        }
    }

    private async Task DeliverAsync(Guid id, CancellationToken cancellationToken)
    {
        var item = await store.GetMessageWorkItemAsync(id, cancellationToken);
        if (item is null) return;
        var startedAt = DateTimeOffset.UtcNow;
        try
        {
            if (item.Email.Recipients.Count == 0) throw new InvalidOperationException("The message has no authorised recipients.");
            var result = await provider.SendAsync(item.Email, cancellationToken);
            await store.CompleteMessageDeliveryAsync(
                item, startedAt, _options.Provider, result.ProviderResponseId, cancellationToken);
            logger.LogInformation("Message {MessageId} delivered on attempt {AttemptNumber}.", item.Id, item.AttemptCount + 1);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            await store.FailMessageDeliveryAsync(
                item, startedAt, _options.Provider, SafeError(exception), cancellationToken);
            logger.LogWarning("Message {MessageId} failed on attempt {AttemptNumber}.", item.Id, item.AttemptCount + 1);
        }
    }

    private static string SafeError(Exception exception)
    {
        var value = exception.Message.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return value[..Math.Min(value.Length, 1800)];
    }
}
