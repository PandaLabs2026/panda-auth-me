using System.Net.Http.Headers;
using System.Security.Cryptography.X509Certificates;
namespace PandaAuth.Me.BrowserTests;

/// <summary>Test-only stand-in for the same-origin IDP MFA route in the production reverse proxy.</summary>
internal sealed class FixtureMfaProxy(FixtureIdentity identity, X509Certificate2 certificate) : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app => {
        app.Use(async (context, pipeline) => {
            if (!context.Request.Path.StartsWithSegments("/account/mfa/user")) {await pipeline(context); return;}
            using var http = new HttpClient(new HttpClientHandler {ServerCertificateCustomValidationCallback = (message, cert, _, _) =>
                message.RequestUri?.IsLoopback == true && cert?.GetCertHashString() == certificate.GetCertHashString()});
            using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), identity.Issuer.TrimEnd('/') + context.Request.Path + context.Request.QueryString);
            if (context.Request.Method == "POST") {
                request.Content = new StreamContent(context.Request.Body);
                if (context.Request.ContentType is { } contentType) request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
            }
            foreach (var header in new[] {"RequestVerificationToken", "X-Panda-Mfa-Grant"})
                if (context.Request.Headers.TryGetValue(header, out var value)) request.Headers.TryAddWithoutValidation(header, value.ToString());
            using var response = await http.SendAsync(request, context.RequestAborted);
            context.Response.StatusCode = (int) response.StatusCode;
            context.Response.ContentType = response.Content.Headers.ContentType?.ToString();
            await response.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
        });
        next(app);
    };
}
