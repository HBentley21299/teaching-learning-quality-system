using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using Azure.Core;
using Azure.Identity;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using TLQS.Api.Data;

namespace TLQS.Api.Messaging;

public sealed class MessagingOptions
{
    public bool Enabled { get; set; }
    public bool TestMode { get; set; } = true;
    public string Provider { get; set; } = "MicrosoftGraph";
    public string TenantId { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string SenderAddress { get; set; } = "";
    public string SenderDisplayName { get; set; } = "i-Elevate";
    public string ReplyToAddress { get; set; } = "";
    public string TestRecipient { get; set; } = "";
    public string ApplicationUrl { get; set; } = "";
    public int PollSeconds { get; set; } = 10;
    public string SmtpHost { get; set; } = "smtp.office365.com";
    public int SmtpPort { get; set; } = 587;
    public string SmtpSecurity { get; set; } = "StartTls";
    public string SmtpAuthentication { get; set; } = "OAuth2";
    public string SmtpUsername { get; set; } = "";
    public string SmtpPassword { get; set; } = "";
}

public sealed record MessagingRuntimeConfiguration(
    bool Enabled,
    bool TestMode,
    string Provider,
    string TenantId,
    string ClientId,
    string ClientSecret,
    string SenderAddress,
    string SenderDisplayName,
    string ReplyToAddress,
    string TestRecipient,
    string ApplicationUrl,
    int PollSeconds,
    string SmtpHost,
    int SmtpPort,
    string SmtpSecurity,
    string SmtpAuthentication,
    string SmtpUsername,
    string SmtpPassword,
    DateTimeOffset? UpdatedAt = null,
    string? UpdatedBy = null);

public sealed record OutboundRecipient(string Type, string EmailAddress, string? DisplayName);
public sealed record OutboundEmail(string Subject, string PlainTextBody, string? HtmlBody, IReadOnlyList<OutboundRecipient> Recipients);
public sealed record EmailDeliveryResult(string? ProviderResponseId);

public interface IEmailProvider
{
    Task<EmailDeliveryResult> SendAsync(OutboundEmail email, CancellationToken cancellationToken);
}

public sealed class ConfiguredEmailProvider(
    HttpClient httpClient,
    MessagingConfigurationStore configurationStore) : IEmailProvider
{
    public async Task<EmailDeliveryResult> SendAsync(OutboundEmail email, CancellationToken cancellationToken)
    {
        var settings = await configurationStore.GetEffectiveAsync(cancellationToken);
        if (!settings.Enabled) throw new InvalidOperationException("Production message delivery is disabled.");
        var recipients = ResolveRecipients(email.Recipients, settings);
        return settings.Provider == "Smtp"
            ? await SendSmtpAsync(email, recipients, settings, cancellationToken)
            : await SendGraphAsync(email, recipients, settings, cancellationToken);
    }

    private async Task<EmailDeliveryResult> SendGraphAsync(
        OutboundEmail email,
        IReadOnlyList<OutboundRecipient> recipients,
        MessagingRuntimeConfiguration settings,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(settings.TenantId) || string.IsNullOrWhiteSpace(settings.ClientId)
            || string.IsNullOrWhiteSpace(settings.ClientSecret) || string.IsNullOrWhiteSpace(settings.SenderAddress))
            throw new InvalidOperationException("Microsoft Graph messaging credentials and sender address are not configured.");

        var credential = new ClientSecretCredential(settings.TenantId, settings.ClientId, settings.ClientSecret);
        AccessToken token = await credential.GetTokenAsync(
            new TokenRequestContext(["https://graph.microsoft.com/.default"]), cancellationToken);

        static object Recipient(OutboundRecipient item) => new { emailAddress = new { address = item.EmailAddress, name = item.DisplayName } };
        var contentType = string.IsNullOrWhiteSpace(email.HtmlBody) ? "Text" : "HTML";
        var body = string.IsNullOrWhiteSpace(email.HtmlBody) ? email.PlainTextBody : email.HtmlBody;
        var payload = new
        {
            message = new
            {
                subject = email.Subject,
                body = new { contentType, content = body },
                toRecipients = recipients.Where(item => item.Type == "to").Select(Recipient),
                ccRecipients = recipients.Where(item => item.Type == "cc").Select(Recipient),
                bccRecipients = recipients.Where(item => item.Type == "bcc").Select(Recipient),
                replyTo = string.IsNullOrWhiteSpace(settings.ReplyToAddress)
                    ? Array.Empty<object>()
                    : [new { emailAddress = new { address = settings.ReplyToAddress } }]
            },
            saveToSentItems = true
        };
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(settings.SenderAddress)}/sendMail");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
        request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        using var response = await httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException($"Microsoft Graph rejected the message ({(int)response.StatusCode}): {Truncate(responseBody, 800)}");
        }
        return new EmailDeliveryResult(response.Headers.TryGetValues("request-id", out var values) ? values.FirstOrDefault() : null);
    }

    private static async Task<EmailDeliveryResult> SendSmtpAsync(
        OutboundEmail email,
        IReadOnlyList<OutboundRecipient> recipients,
        MessagingRuntimeConfiguration settings,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(settings.SmtpHost) || string.IsNullOrWhiteSpace(settings.SenderAddress))
            throw new InvalidOperationException("SMTP server and sender address are not configured.");

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(settings.SenderDisplayName, settings.SenderAddress));
        foreach (var recipient in recipients)
        {
            var mailbox = new MailboxAddress(recipient.DisplayName ?? "", recipient.EmailAddress);
            if (recipient.Type == "cc") message.Cc.Add(mailbox);
            else if (recipient.Type == "bcc") message.Bcc.Add(mailbox);
            else message.To.Add(mailbox);
        }
        if (!string.IsNullOrWhiteSpace(settings.ReplyToAddress))
            message.ReplyTo.Add(MailboxAddress.Parse(settings.ReplyToAddress));
        message.Subject = email.Subject;
        var body = new BodyBuilder { TextBody = email.PlainTextBody };
        if (!string.IsNullOrWhiteSpace(email.HtmlBody)) body.HtmlBody = email.HtmlBody;
        message.Body = body.ToMessageBody();

        using var client = new SmtpClient();
        var socketOptions = settings.SmtpSecurity switch
        {
            "SslOnConnect" => SecureSocketOptions.SslOnConnect,
            "None" => SecureSocketOptions.None,
            _ => SecureSocketOptions.StartTls
        };
        await client.ConnectAsync(settings.SmtpHost, settings.SmtpPort, socketOptions, cancellationToken);
        if (settings.SmtpAuthentication == "OAuth2")
        {
            if (string.IsNullOrWhiteSpace(settings.TenantId) || string.IsNullOrWhiteSpace(settings.ClientId)
                || string.IsNullOrWhiteSpace(settings.ClientSecret) || string.IsNullOrWhiteSpace(settings.SmtpUsername))
                throw new InvalidOperationException("SMTP OAuth2 requires tenant, client, secret and mailbox username settings.");
            var credential = new ClientSecretCredential(settings.TenantId, settings.ClientId, settings.ClientSecret);
            var token = await credential.GetTokenAsync(
                new TokenRequestContext(["https://outlook.office365.com/.default"]), cancellationToken);
            await client.AuthenticateAsync(new SaslMechanismOAuth2(settings.SmtpUsername, token.Token), cancellationToken);
        }
        else if (settings.SmtpAuthentication == "UsernamePassword")
        {
            if (string.IsNullOrWhiteSpace(settings.SmtpUsername) || string.IsNullOrWhiteSpace(settings.SmtpPassword))
                throw new InvalidOperationException("SMTP username and password are not configured.");
            await client.AuthenticateAsync(settings.SmtpUsername, settings.SmtpPassword, cancellationToken);
        }
        await client.SendAsync(message, cancellationToken);
        await client.DisconnectAsync(true, cancellationToken);
        return new EmailDeliveryResult(message.MessageId);
    }

    private static IReadOnlyList<OutboundRecipient> ResolveRecipients(
        IReadOnlyList<OutboundRecipient> recipients,
        MessagingRuntimeConfiguration settings)
    {
        if (!settings.TestMode) return recipients;
        if (string.IsNullOrWhiteSpace(settings.TestRecipient))
            throw new InvalidOperationException("Messaging test mode requires a test recipient.");
        return [new OutboundRecipient("to", settings.TestRecipient, "Test recipient")];
    }

    private static string Truncate(string value, int length) => value.Length <= length ? value : value[..length];
}

public static partial class MessageTemplatePolicy
{
    public static readonly IReadOnlyList<TLQS.Api.V1.MessagingParameterSummary> Parameters =
    [
        new("recipient.firstName", "Recipient first name", "Recipient", "Harry"),
        new("recipient.fullName", "Recipient full name", "Recipient", "Harry Bentley"),
        new("staff.fullName", "Staff member name", "Staff", "Alex Morgan"),
        new("staff.email", "Staff email", "Staff", "alex.morgan@oldham.ac.uk"),
        new("staff.lineManagerName", "Line manager", "Staff", "Taylor Smith"),
        new("organisation.faculty", "Faculty", "Organisation", "Caring Professions"),
        new("organisation.team", "Sub-team", "Organisation", "Health and Social Care"),
        new("action.title", "Assigned action", "Action", "Review assessment feedback"),
        new("action.dueDate", "Action due date", "Action", "30 September 2026"),
        new("action.status", "Action status", "Action", "Open"),
        new("record.type", "Record type", "Record", "Learning Walk"),
        new("record.title", "Record title", "Record", "Learning Walk - Alex Morgan"),
        new("record.status", "Record status", "Record", "Completed"),
        new("record.reportUrl", "Report link", "Record", "https://i-elevate.example/reports/sample"),
        new("cpd.title", "CPD event title", "CPD", "Inclusive assessment"),
        new("cpd.date", "CPD event date", "CPD", "15 October 2026"),
        new("application.url", "Application URL", "System", "https://i-elevate.example")
    ];
    private static readonly HashSet<string> ApprovedKeys = Parameters.Select(item => item.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static void Validate(string subject, string plainText, string? html)
    {
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 500) throw new ArgumentException("Enter a subject of 500 characters or fewer.");
        if (string.IsNullOrWhiteSpace(plainText)) throw new ArgumentException("Enter a plain-text message body.");
        foreach (var value in new[] { subject, plainText, html ?? "" })
        foreach (Match match in PlaceholderPattern().Matches(value))
            if (!ApprovedKeys.Contains(match.Groups[1].Value)) throw new ArgumentException($"Unsupported message parameter: {match.Value}");
        if (new[] { subject, plainText, html ?? "" }.Any(value => value.Contains("{{") && PlaceholderPattern().Replace(value, "").Contains("{{")))
            throw new ArgumentException("One or more message parameters are not valid.");
    }

    public static string Render(string template, IReadOnlyDictionary<string, string> values) =>
        PlaceholderPattern().Replace(template, match => values.GetValueOrDefault(match.Groups[1].Value, ""));

    public static string? SanitizeHtml(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return null;
        var sanitized = ForbiddenBlockPattern().Replace(html, "");
        sanitized = EventAttributePattern().Replace(sanitized, "");
        sanitized = JavascriptUrlPattern().Replace(sanitized, "");
        return sanitized;
    }

    [GeneratedRegex(@"\{\{([a-zA-Z][a-zA-Z0-9.]+)\}\}", RegexOptions.Compiled)] private static partial Regex PlaceholderPattern();
    [GeneratedRegex(@"<(script|style|iframe|object|embed)[^>]*>.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)] private static partial Regex ForbiddenBlockPattern();
    [GeneratedRegex("\\s+on[a-z]+\\s*=\\s*(\\\"[^\\\"]*\\\"|'[^']*')", RegexOptions.IgnoreCase)] private static partial Regex EventAttributePattern();
    [GeneratedRegex("(href|src)\\s*=\\s*(\\\"|')\\s*javascript:[^\\\"']*(\\2)", RegexOptions.IgnoreCase)] private static partial Regex JavascriptUrlPattern();
}
