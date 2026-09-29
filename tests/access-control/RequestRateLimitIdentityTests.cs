using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using TLQS.Api.Security;
using Xunit;

namespace TLQS.AccessControl.Tests;

public class RequestRateLimitIdentityTests
{
    private static DefaultHttpContext Context(string? subject = null, string? tenant = "college", string? authentication = "Bearer")
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.10");
        if (subject is not null) context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("oid", subject), new Claim("tid", tenant!)], authentication));
        return context;
    }

    [Fact]
    public void ColleaguesBehindOneCollegeAddressHaveSeparateBudgets() =>
        Assert.NotEqual(RequestRateLimitIdentity.PartitionKey(Context("one")), RequestRateLimitIdentity.PartitionKey(Context("two")));

    [Fact]
    public void SameIdentityKeepsBudgetAfterAddressChange()
    {
        var first = Context("one"); var second = Context("one");
        second.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.20");
        Assert.Equal(RequestRateLimitIdentity.PartitionKey(first), RequestRateLimitIdentity.PartitionKey(second));
    }

    [Fact]
    public void AnonymousClaimsCannotChooseBudget() =>
        Assert.Equal(RequestRateLimitIdentity.PartitionKey(Context()), RequestRateLimitIdentity.PartitionKey(Context("untrusted", authentication: null)));

    [Fact]
    public void TenantIsPartOfValidatedEntraIdentity() =>
        Assert.NotEqual(RequestRateLimitIdentity.PartitionKey(Context("one", "a")), RequestRateLimitIdentity.PartitionKey(Context("one", "b")));

    [Fact]
    public void LocalTestAccountsUseTheirAuthenticatedSubject()
    {
        var first = Context(); var second = Context();
        first.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "local:a")], "Local"));
        second.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "local:b")], "Local"));
        Assert.NotEqual(RequestRateLimitIdentity.PartitionKey(first), RequestRateLimitIdentity.PartitionKey(second));
    }
}
