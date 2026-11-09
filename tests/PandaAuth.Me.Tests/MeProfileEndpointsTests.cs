using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using OpenIddict.Client;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Me.Tests;

public class MeProfileEndpointsTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ProfileScopesAreRequestedOnlyWhenExplicitlyEnabled(bool enabled)
    {
        using var factory = Factory(enabled);
        var registration = factory.Services.GetRequiredService<IOptionsMonitor<OpenIddictClientOptions>>().CurrentValue.Registrations.Single();
        Assert.Equal(enabled, registration.Scopes.Contains(ProfileScopes.Read));
        Assert.Equal(enabled, registration.Scopes.Contains(ProfileScopes.Write));
    }
    private static WebApplicationFactory<Program> Factory(bool enabled) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:ClientSecret", "unit-test-secret");
            builder.UseSetting("Profile:Enabled", enabled.ToString());
        });

    [Fact]
    public async Task DisabledFeatureReturnsPrivate404WithoutOidcRedirect()
    {
        using var factory = Factory(false);
        using var client = factory.CreateClient(new() { AllowAutoRedirect = false });
        var response = await client.GetAsync("/me/api/profile");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Null(response.Headers.Location);
    }

    [Theory]
    [InlineData("GET", "")]
    [InlineData("PATCH", "")]
    [InlineData("PUT", "/avatar")]
    [InlineData("POST", "/contact-email/challenges")]
    public async Task EnabledProfileRequiresCookieBeforeUpstreamOrMutation(string method, string suffix)
    {
        using var factory = Factory(true);
        using var client = factory.CreateClient(new() { AllowAutoRedirect = false });
        using var request = new HttpRequestMessage(new HttpMethod(method), "/me/api/profile" + suffix);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Null(response.Headers.Location);
    }
}
