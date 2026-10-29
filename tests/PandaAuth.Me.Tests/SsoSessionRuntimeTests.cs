using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using OpenIddict.Abstractions;
using OpenIddict.Client;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Me.Tests;

public sealed class SsoSessionRuntimeTests
{
    [Theory]
    [InlineData("user", true, false, false)]
    [InlineData("user", true, true, false)]
    [InlineData("user", false, false, false)]
    [InlineData("user", false, true, false)]
    [InlineData(null, true, false, false)]
    [InlineData(null, true, true, false)]
    [InlineData(null, false, false, false)]
    [InlineData(null, false, true, false)]
    [InlineData("user", true, true, true)]
    public async Task SharedLogout_RevokesLinkedSession_ButPreservesAnotherDevice(string? role, bool sharedLogoutEnabled, bool native, bool handoffFailure)
    {
        var state = new CentralState();
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:SessionState:SharedLogoutEnabled", sharedLogoutEnabled.ToString());
            builder.UseSetting("Auth:ClientSecret", "fixture-client-secret");
            builder.UseSetting("Auth:SessionState:ClientSecret", "fixture-session-secret");
            builder.UseSetting("Auth:Issuer", "https://idp.example.invalid/");
            builder.ConfigureServices(services =>
            {
                services.AddOpenIddict().AddClient(configuration => configuration.AddEventHandler<OpenIddictClientEvents.ProcessSignOutContext>(descriptor => descriptor.UseInlineHandler(context => {
                    if (handoffFailure) throw new InvalidOperationException("fixture-signout-failure");
                    return default;
                })));
                services.AddHttpClient("session-state").ConfigurePrimaryHttpMessageHandler(() => new CentralHandler(state));
                services.AddHttpClient(MeSessionValidator.ClientName).ConfigurePrimaryHttpMessageHandler(() => new CentralHandler(state));
                services.AddHttpClient<TokenRevocationClient>().ConfigurePrimaryHttpMessageHandler(() => new CentralHandler(state));
                services.PostConfigure<OpenIddictClientOptions>(options =>
                {
                    var configuration = new OpenIddictConfiguration
                    {
                        Issuer = new Uri("https://idp.example.invalid/"),
                        EndSessionEndpoint = new Uri("https://idp.example.invalid/connect/logout"),
                    };
                    var registration = options.Registrations.Single(r => r.ProviderName == "pandaauth");
                    registration.Configuration = configuration;
                    registration.ConfigurationManager = new StaticConfigurationManager<OpenIddictConfiguration>(configuration);
                });
            });
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false, HandleCookies = false });
        Assert.Equal(sharedLogoutEnabled, factory.Services.GetRequiredService<IConfiguration>().GetValue<bool>(PandaAuthSessionApi.SharedLogoutEnabled));
        var options = factory.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get("Cookies");
        string Cookie(string sid, bool linked = true)
        {
            var claims = new List<Claim>
            {
                new("sub", "fixture-user"),
                new(MeSessionLifecycle.SessionIdClaimType, Guid.NewGuid().ToString("N")),
                new(MeSessionLifecycle.StartedAtClaimType, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
            };
            if (role is not null) claims.Add(new Claim("role", role));
            if (linked) claims.Add(new Claim(PandaAuthClaims.SsoSessionId, sid));
            var properties = new AuthenticationProperties { IssuedUtc = DateTimeOffset.UtcNow, ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) };
            properties.StoreTokens([new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = "fixture-access" }]);
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, "Cookies", "name", "role")), properties, "Cookies");
            return options.Cookie.Name + "=" + options.TicketDataFormat.Protect(ticket);
        }
        void UseCookie(string cookie)
        {
            client.DefaultRequestHeaders.Remove("Cookie");
            client.DefaultRequestHeaders.Add("Cookie", cookie);
        }
        const string sidA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sidB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        var cookieA = Cookie(sidA);
        UseCookie(cookieA);
        using var active = await client.GetAsync("/me/api/session");
        Assert.Equal(HttpStatusCode.OK, active.StatusCode);
        using var antiforgery = await client.GetAsync("/me/api/antiforgery");
        var payload = await antiforgery.Content.ReadFromJsonAsync<JsonElement>();
        var csrfCookie = antiforgery.Headers.GetValues("Set-Cookie").Single(c => c.Contains("Antiforgery")).Split(';')[0];
        UseCookie(cookieA + "; " + csrfCookie);
        if (sharedLogoutEnabled)
        {
        state.RevokeUnavailable = true;
        using (var failedRequest = new HttpRequestMessage(HttpMethod.Post, "/me/api/logout"))
        {
            if (native) failedRequest.Content = new FormUrlEncodedContent(new Dictionary<string,string> { ["__RequestVerificationToken"] = payload.GetProperty("token").GetString()! });
            else failedRequest.Headers.Add("X-XSRF-Token", payload.GetProperty("token").GetString());
            using var failed = await client.SendAsync(failedRequest);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, failed.StatusCode);
            if (native) {
                Assert.Equal("text/html", failed.Content.Headers.ContentType?.MediaType);
                Assert.Contains("退出未完成", await failed.Content.ReadAsStringAsync());
                Assert.Null(failed.Headers.Location);
            }
        }
        using (var retryable = await client.GetAsync("/me/api/session"))
            Assert.Equal(HttpStatusCode.OK, retryable.StatusCode);
        Assert.DoesNotContain(sidA, state.Revoked);
        state.RevokeUnavailable = false;
        }
        using var request = new HttpRequestMessage(HttpMethod.Post, "/me/api/logout");
        if (native) request.Content = new FormUrlEncodedContent(new Dictionary<string,string> { ["__RequestVerificationToken"] = payload.GetProperty("token").GetString()! });
        else request.Headers.Add("X-XSRF-Token", payload.GetProperty("token").GetString());
        using var logout = await client.SendAsync(request);
        if (handoffFailure) {
            Assert.Equal(HttpStatusCode.InternalServerError, logout.StatusCode);
            Assert.Equal("text/html", logout.Content.Headers.ContentType?.MediaType);
            var html = await logout.Content.ReadAsStringAsync();
            Assert.Contains("退出未完成", html);
            Assert.DoesNotContain("fixture-signout-failure", html);
            Assert.Null(logout.Headers.Location);
        } else Assert.Equal(HttpStatusCode.Redirect, logout.StatusCode);
        var localProof = logout.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith(MeLogoutProof.CookieName + "=", StringComparison.Ordinal));
        Assert.Contains("secure", localProof, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", localProof, StringComparison.OrdinalIgnoreCase);
        UseCookie(localProof.Split(';')[0]);
        using (var terminal = await client.GetAsync("/me/signed-out")) {
            Assert.Equal(HttpStatusCode.OK, terminal.StatusCode);
            var html = await terminal.Content.ReadAsStringAsync();
            Assert.Contains("本应用的本地会话已清除", html);
            Assert.Contains("身份中心及关联应用的退出结果未确认", html);
            Assert.Null(terminal.Headers.Location);
        }
        Assert.Equal(sharedLogoutEnabled, state.Revoked.Contains(sidA));
        UseCookie(cookieA);
        using var revoked = await client.GetAsync("/me/api/session");
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
        UseCookie(Cookie(sidA));
        using var linked = await client.GetAsync("/me/api/session");
        Assert.Equal(sharedLogoutEnabled ? HttpStatusCode.Unauthorized : HttpStatusCode.OK, linked.StatusCode);
        UseCookie(Cookie(sidB));
        using var otherDevice = await client.GetAsync("/me/api/session");
        Assert.Equal(HttpStatusCode.OK, otherDevice.StatusCode);
        // A revocation performed by a different application must be observed without local lifecycle state.
        const string sidC = "cccccccccccccccccccccccccccccccc";
        state.Revoked.Add(sidC);
        UseCookie(Cookie(sidC));
        using var remoteRevoked = await client.GetAsync("/me/api/session");
        Assert.Equal(HttpStatusCode.Unauthorized, remoteRevoked.StatusCode);
        UseCookie(Cookie(sidB, linked: false));
        using var legacy = await client.GetAsync("/me/api/session");
        Assert.Equal(HttpStatusCode.Unauthorized, legacy.StatusCode);
        UseCookie(Cookie(sidB));
        state.Unavailable = true;
        using var unavailable = await client.GetAsync("/me/api/session");
        Assert.Equal(HttpStatusCode.InternalServerError, unavailable.StatusCode);
    }

    private sealed class CentralState
    {
        public HashSet<string> Revoked { get; } = [];
        public bool Unavailable { get; set; }
        public bool RevokeUnavailable { get; set; }
    }
    private sealed class CentralHandler(CentralState state) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path == PandaAuthEndpoints.Userinfo) return Json("{\"sub\":\"fixture-user\"}");
            if (path == PandaAuthEndpoints.Revocation) return new(HttpStatusCode.NoContent);
            if (path == "/connect/token") return Json("{\"access_token\":\"fixture-token\",\"expires_in\":300}");
            if (state.Unavailable || (state.RevokeUnavailable && path == PandaAuthSessionApi.SsoRevoke)) return new(HttpStatusCode.ServiceUnavailable);
            var body = await request.Content!.ReadFromJsonAsync<JsonElement>(cancellationToken);
            var sid = body.GetProperty("sessionId").GetString()!;
            if (path == PandaAuthSessionApi.SsoRevoke) { state.Revoked.Add(sid); return new(HttpStatusCode.NoContent); }
            return Json(JsonSerializer.Serialize(new { revoked = path == PandaAuthSessionApi.SsoCheck && state.Revoked.Contains(sid) }));
        }
        private static HttpResponseMessage Json(string value) => new(HttpStatusCode.OK)
        { Content = new StringContent(value, Encoding.UTF8, "application/json") };
    }
}
