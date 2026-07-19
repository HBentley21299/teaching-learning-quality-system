using System.Net.Mail;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using TLQS.Api.Messaging;
using TLQS.Api.V1;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed class MessagingConfigurationStore
{
    private readonly string _connectionString;
    private readonly MessagingOptions _configured;
    private readonly IDataProtector _protector;

    public MessagingConfigurationStore(
        IConfiguration configuration,
        IOptions<MessagingOptions> configuredOptions,
        IDataProtectionProvider dataProtectionProvider)
    {
        _connectionString = configuration.GetConnectionString("TlqsDatabase")
            ?? throw new InvalidOperationException("Connection string 'TlqsDatabase' is not configured.");
        _configured = configuredOptions.Value;
        _protector = dataProtectionProvider.CreateProtector("TLQS.Messaging.Configuration.v1");
    }

    public async Task<MessagingRuntimeConfiguration> GetEffectiveAsync(CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(
            """
            SELECT configuration.enabled, configuration.test_mode, configuration.provider,
                   configuration.tenant_id, configuration.client_id, configuration.client_secret_protected,
                   configuration.sender_address, configuration.sender_display_name, configuration.reply_to_address,
                   configuration.test_recipient, configuration.application_url, configuration.poll_seconds,
                   configuration.smtp_host, configuration.smtp_port, configuration.smtp_security,
                   configuration.smtp_authentication, configuration.smtp_username, configuration.smtp_password_protected,
                   configuration.updated_at, staff.display_name
            FROM ops.messaging_configuration configuration
            LEFT JOIN auth.user_accounts account ON account.id = configuration.updated_by_user_account_id
            LEFT JOIN people.staff staff ON staff.id = account.staff_id
            WHERE configuration.configuration_id = 1;
            """, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return FromOptions(_configured);
        return new MessagingRuntimeConfiguration(
            reader.GetBoolean(0), reader.GetBoolean(1), reader.GetString(2),
            GetString(reader, 3), GetString(reader, 4), Unprotect(GetString(reader, 5)),
            GetString(reader, 6), reader.GetString(7), GetString(reader, 8), GetString(reader, 9),
            GetString(reader, 10), reader.GetInt32(11), reader.GetString(12), reader.GetInt32(13),
            reader.GetString(14), reader.GetString(15), GetString(reader, 16), Unprotect(GetString(reader, 17)),
            reader.GetFieldValue<DateTimeOffset>(18), GetString(reader, 19));
    }

    public async Task<MessagingConfigurationSummary> GetSummaryAsync(CancellationToken cancellationToken) =>
        ToSummary(await GetEffectiveAsync(cancellationToken));

    public async Task<MessagingConfigurationSummary> SaveAsync(
        SaveMessagingConfigurationRequest request,
        CurrentUser currentUser,
        CancellationToken cancellationToken)
    {
        var existing = await GetEffectiveAsync(cancellationToken);
        var next = NormalizeAndValidate(request, existing);
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using (var command = new SqlCommand(
            """
            UPDATE ops.messaging_configuration
            SET enabled = @enabled, test_mode = @testMode, provider = @provider,
                tenant_id = @tenantId, client_id = @clientId, client_secret_protected = @clientSecret,
                sender_address = @senderAddress, sender_display_name = @senderDisplayName,
                reply_to_address = @replyToAddress, test_recipient = @testRecipient,
                application_url = @applicationUrl, poll_seconds = @pollSeconds,
                smtp_host = @smtpHost, smtp_port = @smtpPort, smtp_security = @smtpSecurity,
                smtp_authentication = @smtpAuthentication, smtp_username = @smtpUsername,
                smtp_password_protected = @smtpPassword, updated_by_user_account_id = @userId,
                updated_at = sysutcdatetime()
            WHERE configuration_id = 1;

            IF @@ROWCOUNT = 0
                INSERT INTO ops.messaging_configuration (
                    configuration_id, enabled, test_mode, provider, tenant_id, client_id,
                    client_secret_protected, sender_address, sender_display_name, reply_to_address,
                    test_recipient, application_url, poll_seconds, smtp_host, smtp_port, smtp_security,
                    smtp_authentication, smtp_username, smtp_password_protected, updated_by_user_account_id
                ) VALUES (
                    1, @enabled, @testMode, @provider, @tenantId, @clientId,
                    @clientSecret, @senderAddress, @senderDisplayName, @replyToAddress,
                    @testRecipient, @applicationUrl, @pollSeconds, @smtpHost, @smtpPort, @smtpSecurity,
                    @smtpAuthentication, @smtpUsername, @smtpPassword, @userId
                );
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("@enabled", next.Enabled);
            command.Parameters.AddWithValue("@testMode", next.TestMode);
            command.Parameters.AddWithValue("@provider", next.Provider);
            AddText(command, "@tenantId", next.TenantId, 100);
            AddText(command, "@clientId", next.ClientId, 100);
            AddText(command, "@clientSecret", Protect(next.ClientSecret), -1);
            AddText(command, "@senderAddress", next.SenderAddress, 320);
            command.Parameters.AddWithValue("@senderDisplayName", next.SenderDisplayName);
            AddText(command, "@replyToAddress", next.ReplyToAddress, 320);
            AddText(command, "@testRecipient", next.TestRecipient, 320);
            AddText(command, "@applicationUrl", next.ApplicationUrl, 1000);
            command.Parameters.AddWithValue("@pollSeconds", next.PollSeconds);
            command.Parameters.AddWithValue("@smtpHost", next.SmtpHost);
            command.Parameters.AddWithValue("@smtpPort", next.SmtpPort);
            command.Parameters.AddWithValue("@smtpSecurity", next.SmtpSecurity);
            command.Parameters.AddWithValue("@smtpAuthentication", next.SmtpAuthentication);
            AddText(command, "@smtpUsername", next.SmtpUsername, 320);
            AddText(command, "@smtpPassword", Protect(next.SmtpPassword), -1);
            command.Parameters.AddWithValue("@userId", currentUser.UserAccountId ?? (object)DBNull.Value);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var audit = new SqlCommand(
            """
            INSERT INTO ops.audit_logs (user_account_id, entity_name, entity_id, action, summary, after_json)
            VALUES (@userId, N'messaging_configuration', NULL, N'messaging.configuration_updated',
                    @summary, @details);
            """, connection, transaction))
        {
            audit.Parameters.AddWithValue("@userId", currentUser.UserAccountId ?? (object)DBNull.Value);
            audit.Parameters.AddWithValue("@summary", $"Messaging configuration updated by {currentUser.DisplayName}.");
            audit.Parameters.AddWithValue("@details", System.Text.Json.JsonSerializer.Serialize(new
            {
                next.Enabled,
                next.TestMode,
                next.Provider,
                next.SenderAddress,
                next.ReplyToAddress,
                next.ApplicationUrl,
                next.PollSeconds,
                next.SmtpHost,
                next.SmtpPort,
                next.SmtpSecurity,
                next.SmtpAuthentication,
                ClientSecretConfigured = !string.IsNullOrWhiteSpace(next.ClientSecret),
                SmtpPasswordConfigured = !string.IsNullOrWhiteSpace(next.SmtpPassword)
            }));
            await audit.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return ToSummary(next with { UpdatedAt = DateTimeOffset.UtcNow, UpdatedBy = currentUser.DisplayName });
    }

    private MessagingRuntimeConfiguration NormalizeAndValidate(
        SaveMessagingConfigurationRequest request,
        MessagingRuntimeConfiguration existing)
    {
        var provider = request.Provider.Trim().ToLowerInvariant() switch
        {
            "microsoftgraph" or "microsoft_graph" or "graph" => "MicrosoftGraph",
            "smtp" => "Smtp",
            _ => throw new WorkflowValidationException("Select Microsoft Graph or SMTP as the email provider.")
        };
        var smtpSecurity = request.SmtpSecurity.Trim().ToLowerInvariant() switch
        {
            "starttls" => "StartTls",
            "sslonconnect" or "ssl_tls" => "SslOnConnect",
            "none" => "None",
            _ => throw new WorkflowValidationException("Select STARTTLS, SSL/TLS or None for SMTP security.")
        };
        var smtpAuthentication = request.SmtpAuthentication.Trim().ToLowerInvariant() switch
        {
            "oauth2" => "OAuth2",
            "usernamepassword" or "username_password" => "UsernamePassword",
            "none" => "None",
            _ => throw new WorkflowValidationException("Select OAuth2, username/password or no SMTP authentication.")
        };
        var clientSecret = request.ClearClientSecret
            ? ""
            : string.IsNullOrWhiteSpace(request.ClientSecret) ? existing.ClientSecret : request.ClientSecret.Trim();
        var smtpPassword = request.ClearSmtpPassword
            ? ""
            : string.IsNullOrEmpty(request.SmtpPassword) ? existing.SmtpPassword : request.SmtpPassword;
        var next = new MessagingRuntimeConfiguration(
            request.Enabled, request.TestMode, provider, request.TenantId.Trim(), request.ClientId.Trim(), clientSecret,
            request.SenderAddress.Trim(), request.SenderDisplayName.Trim(), request.ReplyToAddress.Trim(),
            request.TestRecipient.Trim(), request.ApplicationUrl.Trim().TrimEnd('/'), request.PollSeconds,
            request.SmtpHost.Trim(), request.SmtpPort, smtpSecurity, smtpAuthentication,
            request.SmtpUsername.Trim(), smtpPassword);

        if (next.PollSeconds is < 2 or > 300) throw new WorkflowValidationException("Polling interval must be between 2 and 300 seconds.");
        if (next.SmtpPort is < 1 or > 65535) throw new WorkflowValidationException("SMTP port must be between 1 and 65535.");
        ValidateEmail(next.SenderAddress, "sender address", required: next.Enabled);
        ValidateEmail(next.ReplyToAddress, "reply-to address", required: false);
        ValidateEmail(next.TestRecipient, "test recipient", required: next.Enabled && next.TestMode);
        if (!string.IsNullOrWhiteSpace(next.ApplicationUrl)
            && (!Uri.TryCreate(next.ApplicationUrl, UriKind.Absolute, out var applicationUri)
                || applicationUri.Scheme is not ("http" or "https")))
            throw new WorkflowValidationException("Application URL must be an absolute HTTP or HTTPS address.");
        if (!next.Enabled) return next;
        if (string.IsNullOrWhiteSpace(next.SenderDisplayName)) throw new WorkflowValidationException("Enter a sender display name.");
        if (next.Provider == "MicrosoftGraph")
            RequireOAuth(next, "Microsoft Graph");
        else
        {
            if (string.IsNullOrWhiteSpace(next.SmtpHost)) throw new WorkflowValidationException("Enter an SMTP server.");
            if (next.SmtpAuthentication == "OAuth2") RequireOAuth(next, "SMTP OAuth2");
            if (next.SmtpAuthentication != "None") ValidateEmail(next.SmtpUsername, "SMTP username", required: true);
            if (next.SmtpAuthentication == "UsernamePassword" && string.IsNullOrWhiteSpace(next.SmtpPassword))
                throw new WorkflowValidationException("Enter the SMTP password.");
        }
        return next;
    }

    private static void RequireOAuth(MessagingRuntimeConfiguration value, string provider)
    {
        if (string.IsNullOrWhiteSpace(value.TenantId) || string.IsNullOrWhiteSpace(value.ClientId)
            || string.IsNullOrWhiteSpace(value.ClientSecret))
            throw new WorkflowValidationException($"{provider} requires the Microsoft tenant ID, client ID and client secret.");
    }

    private static void ValidateEmail(string value, string label, bool required)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            if (required) throw new WorkflowValidationException($"Enter the {label}.");
            return;
        }
        try
        {
            var address = new MailAddress(value);
            if (!string.Equals(address.Address, value, StringComparison.OrdinalIgnoreCase)) throw new FormatException();
        }
        catch (FormatException)
        {
            throw new WorkflowValidationException($"Enter a valid {label}.");
        }
    }

    private static MessagingRuntimeConfiguration FromOptions(MessagingOptions value) => new(
        value.Enabled, value.TestMode, NormalizeProvider(value.Provider), value.TenantId, value.ClientId,
        value.ClientSecret, value.SenderAddress, value.SenderDisplayName, value.ReplyToAddress,
        value.TestRecipient, value.ApplicationUrl, value.PollSeconds, value.SmtpHost, value.SmtpPort,
        value.SmtpSecurity, value.SmtpAuthentication, value.SmtpUsername, value.SmtpPassword);

    private static string NormalizeProvider(string value) =>
        value.Equals("smtp", StringComparison.OrdinalIgnoreCase) ? "Smtp" : "MicrosoftGraph";

    private static MessagingConfigurationSummary ToSummary(MessagingRuntimeConfiguration value) => new(
        value.Enabled, value.TestMode, value.Provider, value.TenantId, value.ClientId,
        !string.IsNullOrWhiteSpace(value.ClientSecret), value.SenderAddress, value.SenderDisplayName,
        value.ReplyToAddress, value.TestRecipient, value.ApplicationUrl, value.PollSeconds,
        value.SmtpHost, value.SmtpPort, value.SmtpSecurity, value.SmtpAuthentication,
        value.SmtpUsername, !string.IsNullOrWhiteSpace(value.SmtpPassword), value.UpdatedAt, value.UpdatedBy);

    private string Protect(string value) => string.IsNullOrWhiteSpace(value) ? "" : _protector.Protect(value);
    private string Unprotect(string value) => string.IsNullOrWhiteSpace(value) ? "" : _protector.Unprotect(value);
    private static string GetString(SqlDataReader reader, int index) => reader.IsDBNull(index) ? "" : reader.GetString(index);

    private static void AddText(SqlCommand command, string name, string value, int size)
    {
        var parameter = command.Parameters.Add(name, System.Data.SqlDbType.NVarChar, size);
        parameter.Value = string.IsNullOrWhiteSpace(value) ? DBNull.Value : value;
    }
}
