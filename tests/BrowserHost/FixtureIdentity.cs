using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PandaAuth.Shared;
namespace PandaAuth.Me.BrowserTests;

internal sealed class FixtureIdentity : IAsyncDisposable
{
    private sealed record Actor(string Subject, string Sid, string Name);
    private readonly RSA key = RSA.Create(2048);
    private readonly ConcurrentDictionary<string, Dictionary<string,string>> codes = new();
    private readonly ConcurrentDictionary<string, Actor> accessTokens = new(), refreshTokens = new();
    private readonly ConcurrentDictionary<string, byte> revoked = new();
    private WebApplication app = null!;
    private volatile string mode = "normal";
    public string Mode => mode;
    public string RunId {get;} = Guid.NewGuid().ToString("N");
    public string Issuer {get; private set;} = "";
    public string ClientOrigin {get; set;} = "";
    private int authorizations, exchanges, writes, logouts;
    private bool pkce;
    public async Task StartAsync(X509Certificate2 certificate)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions {EnvironmentName = "Testing"});
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(k => k.Listen(IPAddress.Loopback, 0, o => o.UseHttps(certificate)));
        app = builder.Build();
        app.MapGet("/.well-known/openid-configuration", () => Results.Json(new {
            issuer = Issuer, authorization_response_iss_parameter_supported = true, authorization_endpoint = Issuer + "connect/authorize", token_endpoint = Issuer + "connect/token",
            userinfo_endpoint = Issuer + "connect/userinfo", jwks_uri = Issuer + "jwks", end_session_endpoint = Issuer + "connect/logout", revocation_endpoint = Issuer + "connect/revoke",
            response_types_supported = new[] {"code"}, response_modes_supported = new[] {"query"}, grant_types_supported = new[] {"authorization_code", "refresh_token", "client_credentials"},
            subject_types_supported = new[] {"public"}, id_token_signing_alg_values_supported = new[] {"RS256"}, token_endpoint_auth_methods_supported = new[] {"client_secret_post"},
            code_challenge_methods_supported = new[] {"S256"}, scopes_supported = new[] {"openid", "profile", "email", "roles", "offline_access"}
        }));
        app.MapGet("/jwks", () => {var p = key.ExportParameters(false); return Results.Json(new {keys = new[] {new {
            kty = "RSA", kid = "browser-fixture", use = "sig", alg = "RS256", n = Base64UrlEncoder.Encode(p.Modulus!), e = Base64UrlEncoder.Encode(p.Exponent!)}}});});
        app.MapGet("/connect/authorize", (HttpContext context) => {
            Interlocked.Increment(ref authorizations); var q = context.Request.Query;
            if (q["client_id"] != "me-web" || q["response_type"] != "code" || q["code_challenge_method"] != "S256" || q["redirect_uri"] != ClientOrigin + "/me/callback/login/pandaauth") return Results.BadRequest();
            if (Mode == "cancel") return Results.Redirect(QueryHelpers.AddQueryString(q["redirect_uri"].ToString(), new Dictionary<string,string?> {
                ["error"] = "access_denied", ["state"] = q["state"], ["iss"] = Issuer}));
            var code = Guid.NewGuid().ToString("N"); var values = q.ToDictionary(p => p.Key, p => p.Value.ToString());
            values["fixture-subject"] = Mode == "actor-b" ? "browser-user-b" : "browser-user"; codes[code] = values;
            return Results.Redirect(QueryHelpers.AddQueryString(q["redirect_uri"].ToString(), new Dictionary<string,string?> {["code"] = code, ["state"] = q["state"], ["iss"] = Issuer}));
        });
        app.MapPost("/connect/token", async (HttpContext context) => {
            var form = await context.Request.ReadFormAsync();
            if (form["grant_type"] == "client_credentials") return Results.Json(new {access_token = "synthetic-session-access", token_type = "Bearer", expires_in = 300});
            if (form["client_id"] != "me-web" || form["client_secret"] != "browser-fixture-only") return Results.BadRequest();
            if (form["grant_type"] == "refresh_token") {
                if (Mode == "expired" || !refreshTokens.TryGetValue(form["refresh_token"].ToString(), out var actor)) return Results.Json(new {error = "invalid_grant"}, statusCode: 400);
                var access = Guid.NewGuid().ToString("N"); accessTokens[access] = actor;
                return Results.Json(new {access_token = access, refresh_token = form["refresh_token"].ToString(), token_type = "Bearer", expires_in = 300});
            }
            if (!codes.TryRemove(form["code"].ToString(), out var q) || form["redirect_uri"] != q["redirect_uri"]) return Results.BadRequest();
            var challenge = Base64UrlEncoder.Encode(SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(form["code_verifier"].ToString())));
            if (challenge != q["code_challenge"]) return Results.BadRequest(); pkce = true; Interlocked.Increment(ref exchanges);
            var subject = q["fixture-subject"]; var identity = new Actor(subject, subject == "browser-user" ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", subject == "browser-user" ? "Browser User" : "Browser User B");
            var token = Guid.NewGuid().ToString("N"); var refresh = Guid.NewGuid().ToString("N"); accessTokens[token] = identity; refreshTokens[refresh] = identity;
            var jwt = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor {
                Issuer = Issuer, Audience = "me-web", IssuedAt = DateTime.UtcNow, NotBefore = DateTime.UtcNow.AddSeconds(-10), Expires = DateTime.UtcNow.AddMinutes(5),
                SigningCredentials = new SigningCredentials(new RsaSecurityKey(key) {KeyId = "browser-fixture"}, SecurityAlgorithms.RsaSha256),
                Claims = new Dictionary<string,object> {["sub"] = identity.Subject, ["nonce"] = q["nonce"], ["at_hash"] = Base64UrlEncoder.Encode(SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(token))[..16]), [PandaAuthClaims.SsoSessionId] = identity.Sid}
            });
            return Results.Json(new {access_token = token, refresh_token = refresh, token_type = "Bearer", expires_in = 300, id_token = jwt, scope = q["scope"]});
        });
        app.MapGet("/connect/userinfo", (HttpContext context) => {
            if (Mode == "unavailable") return Results.StatusCode(503);
            if (Mode == "expired" || !accessTokens.TryGetValue(context.Request.Headers.Authorization.ToString().Replace("Bearer ", "", StringComparison.Ordinal), out var actor)) return Results.Unauthorized();
            return Results.Json(new Dictionary<string,object> {["sub"] = actor.Subject, ["name"] = actor.Name, ["role"] = new[] {"user"}, [PandaAuthClaims.SsoSessionId] = actor.Sid});
        });
        app.MapGet("/connect/logout", (HttpContext context) => {
            if (context.Request.Query["post_logout_redirect_uri"] != ClientOrigin + "/me/callback/logout/pandaauth") return Results.BadRequest();
            Interlocked.Increment(ref logouts);
            return Results.Redirect(QueryHelpers.AddQueryString(context.Request.Query["post_logout_redirect_uri"].ToString(), "state", context.Request.Query["state"].ToString()));
        });
        app.MapPost("/connect/revoke", () => Results.NoContent());
        app.MapPost(PandaAuthSessionApi.Check, (Delegate) Check); app.MapPost(PandaAuthSessionApi.SsoCheck, (Delegate) Check);
        app.MapPost(PandaAuthSessionApi.Revoke, (Delegate) Revoke); app.MapPost(PandaAuthSessionApi.SsoRevoke, (Delegate) Revoke);
        app.MapGet("/fixture/evidence", () => Results.Json(new {kind = "synthetic-me-oidc-fixture", runId = RunId, authorizations, exchanges, pkceVerified = pkce, logouts, writes}));
        app.MapPost("/fixture/mode", (HttpContext context) => {
            var value = context.Request.Query["value"].ToString();
            if (!new[] {"normal", "actor-b", "expired", "unavailable", "cancel", "mfa-expired", "revocation-unavailable", "signout-error"}.Contains(value)) return Results.BadRequest();
            mode = value; return Results.NoContent();
        });
        app.MapGet("/account/mfa/user/status", () => Mode == "mfa-expired" ? Results.Unauthorized() : Results.Json(new {hasActiveFactor = true, requiresReconfiguration = false, recoveryCodeCount = 10}));
        app.MapGet("/account/mfa/user/factors", () => Results.Json(new[] {new {id = "fixture-factor", type = "totp", friendlyName = (string?) null, createdAt = "2026-10-29T00:00:00Z", lastUsedAt = (string?) null}}));
        app.MapGet("/account/mfa/user/antiforgery", () => Results.Json(new {token = "synthetic-mfa-csrf"}));
        app.MapPost("/account/mfa/user/totp/options", (HttpContext context) => {
            Interlocked.Increment(ref writes);
            if (context.Request.Headers["RequestVerificationToken"] != "synthetic-mfa-csrf") return Results.BadRequest();
            return Results.Json(new {mfaGrantRequired = true, operation = "self.totp-enroll", targetId = Mode == "actor-b" ? "browser-user-b" : "browser-user", parameters = new Dictionary<string,string>(), passwordRequired = true}, statusCode: 403);
        });
        await app.StartAsync(); Issuer = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single().TrimEnd('/') + "/";
    }
    private async Task<IResult> Check(HttpContext context) {
        var body = await context.Request.ReadFromJsonAsync<SessionStateCheckRequest>();
        return body is null ? Results.BadRequest() : Results.Json(new {revoked = revoked.ContainsKey(body.SessionId)});
    }
    private async Task<IResult> Revoke(HttpContext context) {
        if (Mode == "revocation-unavailable") return Results.StatusCode(503);
        var body = await context.Request.ReadFromJsonAsync<SessionStateRevokeRequest>();
        if (body is null) return Results.BadRequest(); revoked[body.SessionId] = 1; return Results.NoContent();
    }
    public async ValueTask DisposeAsync() {await app.DisposeAsync(); key.Dispose();}
}
