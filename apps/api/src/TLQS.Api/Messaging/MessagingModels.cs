using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using Azure.Core;
using Azure.Identity;

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
    public int PollSeconds { get; set; } = 10;
}

public sealed record OutboundRecipient(string Type, string EmailAddress, string? DisplayName);
public sealed record OutboundEmail(string Subject, string PlainTextBody, string? HtmlBody, IReadOnlyList<OutboundRecipient> Recipients);
public sealed record EmailDeliveryResult(string? ProviderResponseId);

public interface IEmailProvider
{
    Task<EmailDeliveryResult> SendAsync(OutboundEmail email, CancellationToken cancellationToken);
}

public sealed class MicrosoftGraphEmailProvider(
    HttpClient httpClient,
    Microsoft.Extensions.Options.IOptions<MessagingOptions> configuredOptions) : IEmailProvider
{
    private readonly MessagingOptions _options = configuredOptions.Value;

    public async Task<EmailDeliveryResult> SendAsync(OutboundEmail email, CancellationToken cancellationToken)
    {
        if (!_options.Enabled) throw new InvalidOperationException("Production message delivery is disabled.");
        if (string.IsNullOrWhiteSpace(_options.TenantId) || string.IsNullOrWhiteSpace(_options.ClientId)
            || string.IsNullOrWhiteSpace(_options.ClientSecret) || string.IsNullOrWhiteSpace(_options.SenderAddress))
            throw new InvalidOperationException("Microsoft Graph messaging credentials and sender address are not configured.");

        var credential = new ClientSecretCredential(_options.TenantId, _options.ClientId, _options.ClientSecret);
        AccessToken token = await credential.GetTokenAsync(
            new TokenRequestContext(["https://graph.microsoft.com/.default"]), cancellationToken);
        var recipients = email.Recipients;
        if (_options.TestMode)
        {
            if (string.IsNullOrWhiteSpace(_options.TestRecipient))
                throw new InvalidOperationException("Messaging test mode requires Messaging:TestRecipient.");
            recipients = [new OutboundRecipient("to", _options.TestRecipient, "Test recipient")];
        }

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
                replyTo = string.IsNullOrWhiteSpace(_options.ReplyToAddress)
                    ? Array.Empty<object>()
                    : [new { emailAddress = new { address = _options.ReplyToAddress } }]
            },
            saveToSentItems = true
        };
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(_options.SenderAddress)}/sendMail");
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
