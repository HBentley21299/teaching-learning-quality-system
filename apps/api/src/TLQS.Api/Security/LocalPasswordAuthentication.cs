using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;

namespace TLQS.Api.Security;

/// <summary>
/// Username/password sign-in for local test accounts. Passwords are stored
/// as PBKDF2-SHA256 hashes in auth.local_credentials; successful logins are
/// issued a data-protection sealed bearer token. Production Microsoft Entra
/// ID sign-in is unaffected — this scheme only handles "lt_" tokens.
/// </summary>
public static class LocalPasswordHasher
{
    private const int Iterations = 100_000;
    private const int SaltBytes = 16;
    private const int KeyBytes = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var key = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, KeyBytes);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public static bool Verify(string password, string stored)
    {
        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != "pbkdf2-sha256" || !int.TryParse(parts[1], out var iterations))
        {
            return false;
        }

        byte[] salt;
        byte[] expected;
        try
        {
            salt = Convert.FromBase64String(parts[2]);
            expected = Convert.FromBase64String(parts[3]);
        }
        catch (FormatException)
        {
            return false;
        }

        var actual = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}

/// <summary>
/// Deterministic identity values for local test sign-ins, so trusted
/// self-onboarding can record who created an account without Entra claims.
/// </summary>
public static class LocalIdentity
{
    public static readonly Guid TenantId = new("00000000-0000-0000-0000-0000000010ca");

    public static string SubjectIdFor(string email)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(email.Trim().ToLowerInvariant()));
        return new Guid(digest.AsSpan(0, 16)).ToString();
    }

    public static string DisplayNameFor(string email)
    {
        var localPart = email.Split('@')[0];
        var words = localPart.Split(['.', '_', '-'], StringSplitOptions.RemoveEmptyEntries);
        var name = string.Join(' ', words.Select(word =>
            char.ToUpperInvariant(word[0]) + word[1..].ToLowerInvariant()));
        return string.IsNullOrWhiteSpace(name) ? localPart : name;
    }
}

public sealed class LocalTokenService(IDataProtectionProvider dataProtectionProvider)
{
    public const string TokenPrefix = "lt_";
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);
    private readonly IDataProtector _protector =
        dataProtectionProvider.CreateProtector("TLQS.LocalLogin.v1");

    public string CreateToken(string email)
    {
        var expires = DateTimeOffset.UtcNow.Add(Lifetime).UtcTicks;
        return TokenPrefix + _protector.Protect($"{email}|{expires}");
    }

    public string? ValidateToken(string token)
    {
        if (!token.StartsWith(TokenPrefix, StringComparison.Ordinal))
        {
            return null;
        }

        try
        {
            var payload = _protector.Unprotect(token[TokenPrefix.Length..]);
            var separator = payload.LastIndexOf('|');
            if (separator < 1)
            {
                return null;
            }

            var email = payload[..separator];
            if (!long.TryParse(payload[(separator + 1)..], out var expiresTicks)
                || new DateTimeOffset(expiresTicks, TimeSpan.Zero) < DateTimeOffset.UtcNow)
            {
                return null;
            }

            return email;
        }
        catch (CryptographicException)
        {
            return null;
        }
    }
}

public sealed class LocalTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    LocalTokenService tokenService)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "LocalToken";

    public static bool RequestCarriesLocalToken(HttpContext context) =>
        context.Request.Headers.Authorization.ToString()
            .StartsWith($"Bearer {LocalTokenService.TokenPrefix}", StringComparison.Ordinal);

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var email = tokenService.ValidateToken(header["Bearer ".Length..]);
        if (email is null)
        {
            return Task.FromResult(AuthenticateResult.Fail("The local sign-in token is invalid or has expired."));
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, $"local:{email}"),
            new Claim(ClaimTypes.Email, email),
            new Claim("preferred_username", email)
        };
        var identity = new ClaimsIdentity(claims, SchemeName);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
