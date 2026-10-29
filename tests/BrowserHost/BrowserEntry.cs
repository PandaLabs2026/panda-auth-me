using System.Net;
using Microsoft.AspNetCore.DataProtection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc.Testing;
namespace PandaAuth.Me.BrowserTests;

// Test-only entrypoint. Never referenced by the application or Docker image.
public static class BrowserEntry
{
    public static async Task Main(string[] args)
    {
        if (args.Length != 2) throw new ArgumentException("Expected repository root and private temporary metadata path.");
        var root = Path.GetFullPath(args[0]);
        if (!File.Exists(Path.Combine(root, "src/PandaAuth.Me/wwwroot/me/index.html")))
            throw new InvalidOperationException("Build the actual frontend first.");
        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=localhost", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var certificate = X509CertificateLoader.LoadPkcs12(request.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddHours(1)).Export(X509ContentType.Pfx), null);
        await using var identity = new FixtureIdentity();
        await identity.StartAsync(certificate);
        await using var factory = new WebApplicationFactory<global::Program>().WithWebHostBuilder(builder =>
        {
            builder.UseContentRoot(Path.Combine(root, "src/PandaAuth.Me"));
            builder.UseEnvironment("Development");
            builder.UseSetting("Auth:DataProtectionKeyPath", "");
            builder.UseSetting("Auth:Issuer", identity.Issuer);
            builder.UseSetting("Auth:IdpInternalBaseAddress", identity.Issuer);
            builder.UseSetting("Auth:ClientId", "me-web");
            builder.UseSetting("Auth:ClientSecret", "browser-fixture-only");
            builder.UseSetting("Auth:SessionState:ClientSecret", "browser-fixture-session-only");
            builder.ConfigureLogging(logging => logging.ClearProviders());
            builder.ConfigureServices(services => {
                services.AddDataProtection().UseEphemeralDataProtectionProvider();
                HttpClientHandler Handler() => new() { ServerCertificateCustomValidationCallback = (message, cert, _, _) =>
                    message.RequestUri?.IsLoopback == true && cert?.GetCertHashString() == certificate.GetCertHashString() };
                services.AddOpenIddict().AddClient(options => options.UseSystemNetHttp().ConfigureHttpClientHandler(handler => {
                    handler.ServerCertificateCustomValidationCallback = (message, cert, _, _) => message.RequestUri?.IsLoopback == true && cert?.GetCertHashString() == certificate.GetCertHashString();
                }));
                services.AddHttpClient("me-session-validation").ConfigurePrimaryHttpMessageHandler(Handler);
                services.AddSingleton<IStartupFilter>(new FixtureMfaProxy(identity, certificate));
                services.AddHttpClient<PandaAuth.Me.TokenRevocationClient>().ConfigurePrimaryHttpMessageHandler(Handler);
                services.AddHttpClient("session-state").ConfigurePrimaryHttpMessageHandler(Handler);
                services.AddOpenIddict().AddClient(options => options.AddEventHandler<OpenIddict.Client.OpenIddictClientEvents.ProcessSignOutContext>(descriptor => descriptor.UseInlineHandler(context => {
                    if (identity.Mode == "signout-error") throw new InvalidOperationException("Synthetic signout handoff failure");
                    return default;
                })));
            });
        });
        factory.UseKestrel(options => options.Listen(IPAddress.Loopback, 0, listener => listener.UseHttps(certificate)));
        factory.StartServer();
        var origin = factory.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        identity.ClientOrigin = origin;
        using (var stream = new FileStream(args[1], FileMode.CreateNew, FileAccess.Write, FileShare.None))
            JsonSerializer.Serialize(stream, new {origin, issuer = identity.Issuer, fixture = "me-browser-https", runId = identity.RunId});
        if (OperatingSystem.IsLinux()) File.SetUnixFileMode(args[1], UnixFileMode.UserRead | UnixFileMode.UserWrite);
        using var stop = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
        try { await Task.Delay(Timeout.Infinite, stop.Token); } catch (OperationCanceledException) { }
    }
}
