using System.Net;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using PandaAuth.Me;
using Xunit;

namespace PandaAuth.Me.Tests;

public sealed class SessionLifecycleRuntimeTests
{
    [Fact]
    public async Task CookieSession_IsReadableAndRevocationSurvivesRequestScopes()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:ClientSecret", "fixture-secret");
            builder.UseSetting("Auth:SessionState:ClientSecret", "fixture-session-secret");
            builder.ConfigureServices(services => services.AddHttpClient("session-state")
                .ConfigurePrimaryHttpMessageHandler(() => new SessionStateHandler()));
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false, HandleCookies = false,
        });
        var now = DateTimeOffset.UtcNow;
        var principal = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim("sub", "fixture-user"),
            new Claim(MeSessionLifecycle.SessionIdClaimType, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            new Claim(PandaAuth.Shared.PandaAuthClaims.SsoSessionId, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            new Claim(MeSessionLifecycle.StartedAtClaimType, now.ToUnixTimeSeconds().ToString()),
        ], CookieAuthenticationDefaults.AuthenticationScheme));
        var properties = new AuthenticationProperties { IssuedUtc = now, ExpiresUtc = now.AddHours(1) };
        var options = factory.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
            .Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var ticket = options.TicketDataFormat.Protect(new AuthenticationTicket(principal, properties,
            CookieAuthenticationDefaults.AuthenticationScheme));
        client.DefaultRequestHeaders.Add("Cookie", $"{options.Cookie.Name}={ticket}");

        using var authenticated = await client.GetAsync("/me/api/session");
        Assert.Equal(HttpStatusCode.OK, authenticated.StatusCode);
        using (var scope = factory.Services.CreateScope())
            scope.ServiceProvider.GetRequiredService<MeSessionLifecycle>().Revoke(principal, properties);
        using var revoked = await client.GetAsync("/me/api/session");
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
    }

    private sealed class SessionStateHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(request.RequestUri!.AbsolutePath == "/connect/token"
                    ? "{\"access_token\":\"fixture-token\",\"expires_in\":300}"
                    : "{\"revoked\":false}", Encoding.UTF8, "application/json"),
            });
    }
}
