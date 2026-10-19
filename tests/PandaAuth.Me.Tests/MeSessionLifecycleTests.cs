using System.Security.Claims;
using PandaAuth.Me;
using Xunit;

namespace PandaAuth.Me.Tests;

public class MeSessionLifecycleTests
{
    [Fact]
    public void AbsoluteLifetime_ExpiresAtEightHoursAndRejectsMissingOrMalformedStart()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
        var before = Principal(now.AddHours(-8).AddSeconds(1));
        var expired = Principal(now.AddHours(-8));

        Assert.False(MeSessionLifecycle.IsAbsoluteExpired(before, now));
        Assert.True(MeSessionLifecycle.IsAbsoluteExpired(expired, now));
        Assert.True(MeSessionLifecycle.IsAbsoluteExpired(new ClaimsPrincipal(new ClaimsIdentity()), now));
        Assert.True(MeSessionLifecycle.IsAbsoluteExpired(Principal("not-a-time"), now));
    }

    [Fact]
    public void LegacySessionId_IsStableForSameTicketAndDistinctAcrossLoginTickets()
    {
        var issued = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "me-user")], "test"));
        var properties = new Microsoft.AspNetCore.Authentication.AuthenticationProperties
        {
            IssuedUtc = issued,
            ExpiresUtc = issued.AddHours(8),
        };

        Assert.True(MeSessionLifecycle.TryCreateLegacySessionId(principal, properties, out var first));
        Assert.True(MeSessionLifecycle.TryCreateLegacySessionId(principal, properties, out var replay));
        Assert.Equal(first, replay);

        properties.IssuedUtc = issued.AddSeconds(1);
        Assert.True(MeSessionLifecycle.TryCreateLegacySessionId(principal, properties, out var nextLogin));
        Assert.NotEqual(first, nextLogin);
    }

    [Fact]
    public void LegacySessionStart_UsesOriginalTicketIssueTime()
    {
        var issued = DateTimeOffset.FromUnixTimeSeconds(1_800_000_000);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "me-user")], "test"));
        var properties = new Microsoft.AspNetCore.Authentication.AuthenticationProperties { IssuedUtc = issued };

        Assert.True(MeSessionLifecycle.TryGetSessionStartedAt(principal, properties, out var startedAt));
        Assert.Equal(issued.ToUnixTimeSeconds(), startedAt);
    }

    private static ClaimsPrincipal Principal(DateTimeOffset started) => Principal(started.ToUnixTimeSeconds().ToString());
    private static ClaimsPrincipal Principal(string started) => new(new ClaimsIdentity(
        [new Claim(MeSessionLifecycle.StartedAtClaimType, started)], "test"));
}
