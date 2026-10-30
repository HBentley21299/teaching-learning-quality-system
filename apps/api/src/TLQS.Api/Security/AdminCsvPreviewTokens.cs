using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using TLQS.Api.Data;
using TLQS.Application.Security;
using TLQS.Application.Workflows;

namespace TLQS.Api.Security;

public static class AdminCsvPreviewTokens
{
    public static string Create(IDataProtectionProvider provider, CurrentUser user, string kind, string csv, string fingerprint) =>
        provider.CreateProtector("TLQS.AdminCsvPreview.v1").Protect(JsonSerializer.Serialize(new Payload(
            user.UserAccountId!.Value, kind, AdminCsvReader.Hash(csv), fingerprint, DateTimeOffset.UtcNow.AddMinutes(20))));

    public static string Read(IDataProtectionProvider provider, CurrentUser user, string kind, string csv, string? token)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(token) || token.Length > 8192) throw new CryptographicException();
            var payload = JsonSerializer.Deserialize<Payload>(provider.CreateProtector("TLQS.AdminCsvPreview.v1").Unprotect(token));
            if (payload is null || payload.UserId != user.UserAccountId || payload.Kind != kind || payload.CsvHash != AdminCsvReader.Hash(csv)
                || payload.ExpiresAt <= DateTimeOffset.UtcNow) throw new CryptographicException();
            return payload.Fingerprint;
        }
        catch (Exception exception) when (exception is CryptographicException or JsonException or FormatException)
        { throw new WorkflowValidationException("The import preview has expired or no longer matches this file. Preview it again."); }
    }
    private sealed record Payload(Guid UserId, string Kind, string CsvHash, string Fingerprint, DateTimeOffset ExpiresAt);
}
