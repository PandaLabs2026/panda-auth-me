using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using PandaAuth.Me;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Me.Tests;

public class TenantHostContextTests
{
    [Fact]
    public void CanonicalTenantHost_WithMatchingClaims_IsAccepted()
    {
        var context = Request("t0042-auth.s001.pandalabs.cn");
        var principal = Principal("t0042", "t0042-auth.s001.pandalabs.cn");

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason, enabled: true));
        Assert.Null(reason);
    }

    [Fact]
    public void CanonicalTenantHost_WithDifferentHost_IsRejected()
    {
        var context = Request("t0042-auth.s001.pandalabs.cn");
        var principal = Principal("t0042", "t0042-auth.s001.pandalabs.cn");
        context.Request.Host = new HostString("t0043-auth.s001.pandalabs.cn");

        Assert.False(TenantHostContext.TryValidate(context, principal, out var reason, enabled: true));
        Assert.Equal(TenantContextErrors.ContextMismatch, reason);
    }

    [Fact]
    public void RetiredOldStyleHost_HasNoTenantSemantics_AndIsPassedThrough()
    {
        // t####.auth.pandalabs.cn 已随 ADR-061 退役（NXDOMAIN）：不再按租户主机推导，
        // 与平台主机一样直接放行（ADR-090 卫生批：删除旧式分支）。
        var context = Request("t0042.auth.pandalabs.cn");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason, enabled: true));
        Assert.Null(reason);
    }

    [Fact]
    public void PlatformHost_DoesNotRequireTenantClaims()
    {
        var context = Request("auth.appliket.com");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason, enabled: true));
        Assert.Null(reason);
    }

    [Fact]
    public void DisabledSwitch_KeepsSingleTenantBehavior()
    {
        var context = Request("t0042-auth.s001.pandalabs.cn");
        var principal = new ClaimsPrincipal(new ClaimsIdentity("cookie"));

        Assert.True(TenantHostContext.TryValidate(context, principal, out var reason, enabled: false));
        Assert.Null(reason);
    }

    [Fact]
    public void CanonicalTenantHost_UsesTheCurrentHostAsOidcIssuer()
    {
        var context = Request("t0042-auth.s001.pandalabs.cn");
        context.Request.Scheme = "https";

        var issuer = TenantOidcRouting.ResolveIssuer(context.Request, new Uri("https://auth.appliket.com/"));

        Assert.Equal("https://t0042-auth.s001.pandalabs.cn/", issuer.ToString());
    }

    [Fact]
    public void RetiredOldStyleHost_ResolvesToPlatformIssuer()
    {
        var context = Request("t0042.auth.pandalabs.cn");
        context.Request.Scheme = "https";

        var issuer = TenantOidcRouting.ResolveIssuer(context.Request, new Uri("https://auth.appliket.com/"));

        Assert.Equal("https://auth.appliket.com/", issuer.ToString());
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
