using System.Net.Http.Headers;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using PandaAuth.Shared;

namespace PandaAuth.Me;

internal static class MeProfileEndpoints
{
    internal const string ClientName = "me-private-profile";
    internal static void MapMeProfile(this WebApplication app, Uri issuer)
    {
        Map("", PandaAuthProfileApi.Self, ["GET", "PATCH"]);
        Map("/avatar", PandaAuthProfileApi.Avatar, ["GET", "PUT", "DELETE"]);
        Map("/contact-email", PandaAuthProfileApi.ContactEmail, ["DELETE"]);
        Map("/contact-email/challenges", PandaAuthProfileApi.ContactEmailChallenges, ["POST"]);
        Map("/contact-email/confirmation", PandaAuthProfileApi.ContactEmailConfirmation, ["POST"]);

        void Map(string suffix, string upstream, string[] methods) =>
            app.MapMethods("/me/api/profile" + suffix, methods, async (HttpContext context,
                MeSessionValidator validator, IAntiforgery antiforgery, IHttpClientFactory clients) =>
            {
                context.Response.Headers.CacheControl = "no-store";
                if (!app.Configuration.GetValue<bool>("Profile:Enabled")) return Error(404, "profile_unavailable");
                if (context.User.Identity?.IsAuthenticated != true) return Error(401, "profile_identity_invalid");
                if (context.Request.QueryString.HasValue) return Error(400, "profile_request_invalid");
                var targetIssuer = TenantOidcRouting.ResolveIssuer(context.Request, issuer);
                if (await validator.ValidateAsync(context, targetIssuer, context.RequestAborted) is { } failure) return failure;
                var write = !HttpMethods.IsGet(context.Request.Method);
                if (write)
                {
                    try { await antiforgery.ValidateRequestAsync(context); }
                    catch (AntiforgeryValidationException) { return Error(400, "profile_csrf_invalid"); }
                }
                var ticket = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                var (accessToken, _) = SessionTokens.Read(ticket);
                if (string.IsNullOrWhiteSpace(accessToken)) return Error(401, "profile_identity_invalid");
                using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), new Uri(targetIssuer, upstream));
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                var revision = context.Request.Headers.IfMatch;
                if (revision.Count > 1) return Error(400, "profile_request_invalid");
                if (revision.Count == 1) request.Headers.TryAddWithoutValidation("If-Match", revision.ToString());
                if (write && !HttpMethods.IsDelete(context.Request.Method))
                {
                    var avatar = upstream == PandaAuthProfileApi.Avatar;
                    var limit = avatar ? 2 * 1024 * 1024 : 16 * 1024;
                    byte[]? bytes;
                    try { bytes = await ReadBounded(context.Request.Body, limit, context.RequestAborted); }
                    catch (BadHttpRequestException) { return Error(413, "profile_request_too_large"); }
                    if (bytes is null) return Error(413, "profile_request_too_large");
                    request.Content = new ByteArrayContent(bytes);
                    var type = context.Request.ContentType;
                    if (!MediaTypeHeaderValue.TryParse(type, out var contentType)) return Error(400, "profile_request_invalid");
                    request.Content.Headers.ContentType = contentType;
                }
                try
                {
                    using var client = clients.CreateClient(ClientName);
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
                    deadline.CancelAfter(client.Timeout);
                    using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
                    var avatar = upstream == PandaAuthProfileApi.Avatar && !write && response.IsSuccessStatusCode;
                    var media = response.Content.Headers.ContentType?.MediaType;
                    if (avatar ? media != "image/png" : media != "application/json") return Error(502, "profile_response_invalid");
                    await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
                    var result = await ReadBounded(stream, avatar ? 256 * 1024 : 16 * 1024, deadline.Token);
                    if (result is null || (int)response.StatusCode is < 200 or >= 600 || (int)response.StatusCode is >= 300 and < 400)
                        return Error(502, "profile_response_invalid");
                    if (response.Headers.ETag is { } etag) context.Response.Headers.ETag = etag.ToString();
                    if (response.Headers.RetryAfter is { } retry) context.Response.Headers.RetryAfter = retry.ToString();
                    context.Response.StatusCode = (int)response.StatusCode;
                    return Results.Bytes(result, avatar ? "image/png" : "application/json");
                }
                catch (HttpRequestException) { return Error(503, "profile_service_unavailable"); }
                catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested)
                { return Error(503, "profile_service_unavailable"); }

                IResult Error(int status, string code) => Results.Json(new ProfileErrorDto(code, context.TraceIdentifier), statusCode: status);
            });
    }

    private static async Task<byte[]?> ReadBounded(Stream stream, int limit, CancellationToken ct)
    {
        using var output = new MemoryStream();
        var buffer = new byte[8192];
        while (true)
        {
            var count = await stream.ReadAsync(buffer.AsMemory(0, Math.Min(buffer.Length, limit + 1 - (int)output.Length)), ct);
            if (count == 0) return output.ToArray();
            await output.WriteAsync(buffer.AsMemory(0, count), ct);
            if (output.Length > limit) return null;
        }
    }
}
