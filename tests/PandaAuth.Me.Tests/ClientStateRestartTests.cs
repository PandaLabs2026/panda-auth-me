using System.Net;
using System.Net.Http;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols;
using OpenIddict.Abstractions;
using OpenIddict.Client;
using Xunit;
using static OpenIddict.Abstractions.OpenIddictConstants;
namespace PandaAuth.Me.Tests;

public class ClientStateRestartTests
{
    private const string Issuer = "https://idp.example.invalid/";
    private sealed class CallbackFactory(string directory) : WebApplicationFactory<Program>
    {
        public int TokenRequests;
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:ClientSecret", "fixture-secret");
            builder.UseSetting("Auth:Issuer", Issuer);
            builder.UseSetting("Auth:DataProtectionKeyPath", directory);
            builder.ConfigureServices(services =>
            {
                services.ConfigureAll<HttpClientFactoryOptions>(options =>
                    options.HttpMessageHandlerBuilderActions.Add(http => http.AdditionalHandlers.Add(new TokenHandler(this))));
                services.PostConfigure<OpenIddictClientOptions>(options =>
                {
                    var configuration = new OpenIddictConfiguration
                    {
                        Issuer = new Uri(Issuer),
                        AuthorizationEndpoint = new Uri(Issuer + "connect/authorize"),
                        TokenEndpoint = new Uri(Issuer + "connect/token"),
                    };
                    configuration.GrantTypesSupported.Add(GrantTypes.AuthorizationCode);
                    configuration.GrantTypesSupported.Add(GrantTypes.RefreshToken);
                    configuration.ResponseTypesSupported.Add(ResponseTypes.Code);
                    configuration.ResponseModesSupported.Add(ResponseModes.Query);
                    configuration.CodeChallengeMethodsSupported.Add(CodeChallengeMethods.Sha256);
                    configuration.TokenEndpointAuthMethodsSupported.Add(ClientAuthenticationMethods.ClientSecretPost);
                    foreach (var scope in new[] { Scopes.OpenId, Scopes.Profile, Scopes.Email, Scopes.Roles, Scopes.OfflineAccess }) configuration.ScopesSupported.Add(scope);
                    var registration = options.Registrations.Single(r => r.ProviderName == "pandaauth");
                    registration.Configuration = configuration;
                    registration.ConfigurationManager = new StaticConfigurationManager<OpenIddictConfiguration>(configuration);
                });
            });
        }
    }
    private sealed class TokenHandler(CallbackFactory factory) : DelegatingHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal(Issuer + "connect/token", request.RequestUri!.AbsoluteUri);
            Interlocked.Increment(ref factory.TokenRequests);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)
            { Content = new StringContent("{\"error\":\"server_error\"}", System.Text.Encoding.UTF8, "application/json") });
        }
    }
    private static HttpClient Client(CallbackFactory factory) => factory.CreateClient(new WebApplicationFactoryClientOptions
    { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false, HandleCookies = false });
    private static string DirectoryPath()
    {
        var path=Path.Combine(Path.GetTempPath(),"panda-me-state-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(path);return path;
    }
    private static async Task<(string State,string Cookie)> Challenge(CallbackFactory factory)
    {
        using var client=Client(factory);using var r=await client.GetAsync("/me/login");Assert.Equal(HttpStatusCode.Redirect,r.StatusCode);
        var state=QueryHelpers.ParseQuery(r.Headers.Location!.Query)["state"].ToString();Assert.NotEmpty(state);
        var cookie=r.Headers.GetValues("Set-Cookie").Single(c=>c.Contains("OpenIddict",StringComparison.OrdinalIgnoreCase)).Split(';')[0];
        return (state,cookie);
    }
    private static async Task Callback(CallbackFactory factory,(string State,string Cookie) challenge)
    {
        using var client=Client(factory);using var request=new HttpRequestMessage(HttpMethod.Get,"/me/callback/login/pandaauth?code=fixture-code&state="+Uri.EscapeDataString(challenge.State));
        request.Headers.Add("Cookie",challenge.Cookie);using var response=await client.SendAsync(request);
        // The offline token endpoint deliberately rejects exchange; observe TokenRequests, not UI status.
    }
    [Fact]
    public void ProductionWithoutPersistentPath_RefusesStartup()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("Auth:ClientSecret", "fixture-secret");
            builder.UseSetting("Auth:DataProtectionKeyPath", "");
        });
        var error = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains("Auth:DataProtectionKeyPath", error.Message);
    }
    [Fact]
    public async Task SameDirectoryRestart_StateReachesTokenExchange()
    {
        var dir=DirectoryPath();try {
            (string State,string Cookie) challenge;
            using(var a=new CallbackFactory(dir)) challenge=await Challenge(a);
            using var b=new CallbackFactory(dir);await Callback(b,challenge);Assert.Equal(1,b.TokenRequests);
        } finally {Directory.Delete(dir,true);}
    }
    [Fact]
    public async Task DifferentClientKeys_StateRejectedBeforeTokenExchange()
    {
        var dir=DirectoryPath();try {
            (string State,string Cookie) challenge;
            using(var a=new CallbackFactory(dir)) challenge=await Challenge(a);
            // Keep DP/correlation material unchanged and rotate only the state keys.
            var key=Path.Combine(dir,"client-keys.json");if(File.Exists(key)) File.Delete(key);
            using var b=new CallbackFactory(dir);await Callback(b,challenge);Assert.Equal(0,b.TokenRequests);
        } finally {Directory.Delete(dir,true);}
    }
    [Fact]
    public void ExistingSessionCookie_RemainsReadableAcrossRestart()
    {
        var dir=DirectoryPath();try {
            string cookie;
            using(var a=new CallbackFactory(dir)) {
                var format=a.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(CookieAuthenticationDefaults.AuthenticationScheme).TicketDataFormat;
                cookie=format.Protect(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(new[]{new Claim("sub","fixture-user")},"Cookies")),new AuthenticationProperties(),"Cookies"));
            }
            using var b=new CallbackFactory(dir);
            var restored=b.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get("Cookies").TicketDataFormat.Unprotect(cookie);
            Assert.Equal("fixture-user",restored!.Principal.FindFirst("sub")!.Value);
        } finally {Directory.Delete(dir,true);}
    }
}
