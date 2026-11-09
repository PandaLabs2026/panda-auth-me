using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Options;
using PandaAuth.Shared;
using Xunit;

namespace PandaAuth.Me.Tests;

public sealed class SessionStatusValidationTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SessionProjectsExplicitProfileAvailability(bool enabled)
    {
        using var factory = Factory(new State("valid")).WithWebHostBuilder(builder => builder.UseSetting("Profile:Enabled", enabled.ToString()));
        using var client = Client(factory);
        client.DefaultRequestHeaders.Add("Cookie", Cookie(factory, "valid"));
        using var response = await client.GetAsync("/me/api/session");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(enabled, body.GetProperty("profileEditingEnabled").GetBoolean());
    }

    [Theory]
    [InlineData("valid")]
    [InlineData("expired")]
    public async Task ProfileReadUsesValidatedCurrentAccessToken(string mode)
    {
        var state = new State(mode);
        using var factory = Factory(state).WithWebHostBuilder(builder => builder.UseSetting("Profile:Enabled", "true"));
        using var client = Client(factory);
        client.DefaultRequestHeaders.Add("Cookie", Cookie(factory, mode));
        using var response = await client.GetAsync("/me/api/profile");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.Equal("valid-access", state.ProfileToken);
        Assert.Equal("https://idp.example.invalid" + PandaAuthProfileApi.Self, state.ProfileUrl);
        Assert.Equal(mode == "expired" ? 1 : 0, state.RefreshCalls);
        Assert.Contains("fixture-profile", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ProfileWriteWithoutCsrfDoesNotReachProfileServer()
    {
        var state = new State("valid");
        using var factory = Factory(state).WithWebHostBuilder(builder => builder.UseSetting("Profile:Enabled", "true"));
        using var client = Client(factory);
        client.DefaultRequestHeaders.Add("Cookie", Cookie(factory, "valid"));
        using var response = await client.PatchAsync("/me/api/profile", new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.ProfileToken);
    }

    [Fact]
    public async Task ProfilePatchForwardsRevisionWithRealAntiforgeryCookieAndHeader()
    {
        var state = new State("valid");
        using var factory = Factory(state).WithWebHostBuilder(builder => builder.UseSetting("Profile:Enabled", "true"));
        using var client = Client(factory);
        var cookie = Cookie(factory, "valid");
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        using var admission = await client.GetAsync("/me/api/antiforgery");
        var csrf = (await admission.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        var antiCookie = admission.Headers.GetValues("Set-Cookie").Single(value => value.Contains("Antiforgery", StringComparison.Ordinal)).Split(';')[0];
        client.DefaultRequestHeaders.Remove("Cookie");
        client.DefaultRequestHeaders.Add("Cookie", cookie + "; " + antiCookie);
        using var request = new HttpRequestMessage(HttpMethod.Patch, "/me/api/profile")
        { Content = new StringContent("{\"displayName\":\"fixture-profile\"}", Encoding.UTF8, "application/json") };
        request.Headers.Add("X-XSRF-Token", csrf);
        request.Headers.TryAddWithoutValidation("If-Match", "\"0\"");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("\"0\"", state.ProfileRevision);
        Assert.Equal("valid-access", state.ProfileToken);
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task ProfileRejectsCallerSelectedIdentityBeforeAnyUpstreamRequest()
    {
        var state = new State("valid");
        using var factory = Factory(state).WithWebHostBuilder(builder => builder.UseSetting("Profile:Enabled", "true"));
        using var client = Client(factory);
        client.DefaultRequestHeaders.Add("Cookie", Cookie(factory, "valid"));
        using var response = await client.GetAsync("/me/api/profile?subject=another-account");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.ProfileToken);
        Assert.Equal(0, state.UserinfoCalls);
    }

    [Theory]
    [InlineData("valid", HttpStatusCode.OK, 1, 0)]
    [InlineData("expired", HttpStatusCode.OK, 2, 1)]
    [InlineData("legacy", HttpStatusCode.OK, 1, 1)]
    [InlineData("revoked", HttpStatusCode.Unauthorized, 1, 1)]
    [InlineData("unavailable", HttpStatusCode.ServiceUnavailable, 1, 0)]
    [InlineData("subject-mismatch", HttpStatusCode.Unauthorized, 2, 1)]
    public async Task Session_UsesIdpCredentialsAndPreservesRefreshCompatibility(string mode, HttpStatusCode expected, int userinfoCalls, int refreshCalls)
    {
        var state = new State(mode);
        using var factory = Factory(state);
        using var client = Client(factory);
        client.DefaultRequestHeaders.Add("Cookie", Cookie(factory, mode));
        using var response = await client.GetAsync("/me/api/session");
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal(userinfoCalls, state.UserinfoCalls);
        Assert.Equal(refreshCalls, state.RefreshCalls);
        Assert.Null(response.Headers.Location);
        if (expected == HttpStatusCode.OK)
            Assert.Equal("fixture-user", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("subject").GetString());
        if (expected == HttpStatusCode.Unauthorized)
            Assert.Contains(response.Headers.GetValues("Set-Cookie"), Deleted);
        else if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
            Assert.DoesNotContain(cookies, Deleted);
    }

    [Fact]
    public async Task AnonymousSessionRequest_IsUnauthorized()
    {
        using var factory = Factory(new State("valid"));
        using var client = Client(factory);

        using var response = await client.GetAsync("/me/api/session");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Null(response.Headers.Location);
    }

    [Fact]
    public async Task ConcurrentSessionRequests_ProjectTheirOwnValidatedSubjects()
    {
        using var factory = Factory(new State("two-users"));
        using var alice = Client(factory);
        using var bob = Client(factory);
        alice.DefaultRequestHeaders.Add("Cookie", Cookie(factory, "two-users", "alice", "alice-access"));
        bob.DefaultRequestHeaders.Add("Cookie", Cookie(factory, "two-users", "bob", "bob-access"));

        var responses = await Task.WhenAll(alice.GetAsync("/me/api/session"), bob.GetAsync("/me/api/session"));
        try
        {
            Assert.Equal(HttpStatusCode.OK, responses[0].StatusCode);
            Assert.Equal(HttpStatusCode.OK, responses[1].StatusCode);
            Assert.Equal("alice", (await responses[0].Content.ReadFromJsonAsync<JsonElement>()).GetProperty("subject").GetString());
            Assert.Equal("bob", (await responses[1].Content.ReadFromJsonAsync<JsonElement>()).GetProperty("subject").GetString());
        }
        finally
        {
            foreach (var response in responses) response.Dispose();
        }
    }

    [Fact]
    public async Task ConcurrentOldTickets_RefreshOnlyOnce()
    {
        var state = new State("expired");
        using var factory = Factory(state);
        using var client = Client(factory);
        client.DefaultRequestHeaders.Add("Cookie", Cookie(factory, "expired"));
        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => client.GetAsync("/me/api/session")));
        foreach (var response in responses) { Assert.Equal(HttpStatusCode.OK, response.StatusCode); response.Dispose(); }
        Assert.Equal(1, state.RefreshCalls);
    }

    [Fact]
    public async Task LogoutDuringRefresh_DoesNotRestoreSession()
    {
        var state = new State("logout-during-refresh");
        using var factory = Factory(state);
        using var client = Client(factory);
        client.DefaultRequestHeaders.Add("Cookie", Cookie(factory, "expired"));
        using var response = await client.GetAsync("/me/api/session");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(1, state.RefreshCalls);
        Assert.All(response.Headers.GetValues("Set-Cookie"), value => Assert.True(Deleted(value)));
    }

    private static bool Deleted(string value) => value.Contains("expires=Thu, 01 Jan 1970", StringComparison.OrdinalIgnoreCase);
    private static HttpClient Client(WebApplicationFactory<Program> factory) => factory.CreateClient(new WebApplicationFactoryClientOptions
    { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false, HandleCookies = false });
    private static WebApplicationFactory<Program> Factory(State state)
        => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:ClientSecret", "fixture-secret");
            builder.UseSetting("Auth:SessionState:ClientSecret", "fixture-machine-secret");
            builder.UseSetting("Auth:Issuer", "https://idp.example.invalid/");
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<IMeSessionRefresher>(new Refresher(state));
                services.ConfigureAll<HttpClientFactoryOptions>(options => options.HttpMessageHandlerBuilderActions.Add(http => http.PrimaryHandler = new Handler(state)));
            });
        });
    private static string Cookie(WebApplicationFactory<Program> factory, string mode, string subject = "fixture-user", string? accessToken = null)
    {
        var properties = new AuthenticationProperties { IssuedUtc = DateTimeOffset.UtcNow, ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) };
        var tokens = new List<AuthenticationToken> { new() { Name = SessionTokens.RefreshTokenName, Value = "fixture-refresh" } };
        if (mode != "legacy") tokens.Add(new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = accessToken ?? (mode is "valid" or "unavailable" or "subject-mismatch" or "two-users" ? "valid-access" : "expired-access") });
        properties.StoreTokens(tokens);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim("sub", subject), new Claim(MeSessionLifecycle.SessionIdClaimType, Guid.NewGuid().ToString("N")),
            new Claim(MeSessionLifecycle.StartedAtClaimType, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString()),
            new Claim(PandaAuthClaims.SsoSessionId, Guid.NewGuid().ToString("N")),
        ], "Cookies"));
        var options = factory.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get("Cookies");
        return options.Cookie.Name + "=" + options.TicketDataFormat.Protect(new AuthenticationTicket(principal, properties, "Cookies"));
    }
    private sealed class State(string mode)
    {
        public string Mode { get; } = mode;
        public int UserinfoCalls;
        public int RefreshCalls;
        public volatile bool Revoked;
        public string? ProfileToken;
        public string? ProfileUrl;
        public string? ProfileRevision;
    }
    private sealed class Refresher(State state) : IMeSessionRefresher
    {
        public async Task<MeRefreshResult> RefreshAsync(HttpContext context, string refreshToken, CancellationToken cancellationToken)
        {
            Assert.Equal("fixture-refresh", refreshToken);
            Interlocked.Increment(ref state.RefreshCalls);
            await Task.Delay(60, cancellationToken);
            if (state.Mode == "revoked") return new(null, null, "invalid_grant");
            if (state.Mode == "logout-during-refresh") state.Revoked = true;
            return new("valid-access", "new-refresh");
        }
    }
    private sealed class Handler(State state) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path == PandaAuthProfileApi.Self)
            {
                state.ProfileToken = request.Headers.Authorization?.Parameter;
                state.ProfileUrl = request.RequestUri.AbsoluteUri;
                state.ProfileRevision = request.Headers.TryGetValues("If-Match", out var revisions) ? revisions.Single() : null;
                return Json("{\"displayName\":\"fixture-profile\",\"biography\":null,\"hasAvatar\":false,\"contactEmail\":{\"address\":null,\"state\":\"none\"},\"revision\":\"\\\"0\\\"\"}");
            }
            if (path == PandaAuthEndpoints.Token) return Json("{\"access_token\":\"fixture-machine\",\"expires_in\":300}");
            if (path == PandaAuthEndpoints.Userinfo)
            {
                Interlocked.Increment(ref state.UserinfoCalls);
                if (state.Mode == "unavailable") return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
                if (state.Mode == "subject-mismatch" && request.Headers.Authorization?.Parameter == "valid-access") return Json("{\"sub\":\"another-user\"}");
                if (state.Mode == "two-users") return Json(request.Headers.Authorization?.Parameter switch
                {
                    "alice-access" => "{\"sub\":\"alice\"}",
                    "bob-access" => "{\"sub\":\"bob\"}",
                    _ => "{}",
                });
                return request.Headers.Authorization?.Parameter == "valid-access" ? Json("{\"sub\":\"fixture-user\"}") : Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized));
            }
            return Json(JsonSerializer.Serialize(new { revoked = state.Revoked }));
        }
        private static Task<HttpResponseMessage> Json(string body) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        { Content = new StringContent(body, Encoding.UTF8, "application/json") });
    }
}
