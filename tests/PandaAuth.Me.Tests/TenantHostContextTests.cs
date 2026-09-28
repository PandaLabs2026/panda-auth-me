using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using PandaAuth.Me;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Me.Tests;

public class TenantHostContextTests
{
    [Fact]
    public void TenantHost_WithMatchingClaims_IsAccepted()
    {
        var context = Request("t0042.auth.pandalabs.cn");
        var principal = Principal("t0042", "t0042.auth.pandalabs.cn");

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Null(reason);
    }

    [Fact]
    public void TenantHost_WithDifferentHost_IsRejected()
    {
        var context = Request("t0042.auth.pandalabs.cn");
        var principal = Principal("t0042", "t0042.auth.pandalabs.cn");
        context.Request.Host = new HostString("t0043.auth.pandalabs.cn");

        Assert.False(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Equal(TenantContextErrors.ContextMismatch, reason);
    }

    [Fact]
    public void PlatformHost_DoesNotRequireTenantClaims()
    {
        var context = Request("auth.pandalabs.cn");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason));
        Assert.Null(reason);
    }

    private static DefaultHttpContext Request(string host)
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString(host);
        return context;
    }

    private static ClaimsPrincipal Principal(string tenantId, string host) =>
        new(new ClaimsIdentity([
            new Claim(PandaAuthClaims.TenantId, tenantId),
            new Claim(PandaAuthClaims.TenantHost, host),
        ], "oidc"));
}
