using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using OpenIddict.Abstractions;
using PandaAuth.Shared;

namespace PandaAuth.Me;

internal sealed class MeSessionValidator(
    IHttpClientFactory clients, IMeSessionRefresher refresher, MeSessionLifecycle lifecycle, SessionStateClient remote)
{
    internal const string ClientName = "me-session-validation";
    private sealed class Gate(DateTimeOffset expiresAt)
    {
        internal readonly SemaphoreSlim Lock = new(1, 1);
        internal readonly DateTimeOffset ExpiresAt = expiresAt;
        internal string? OldRefresh;
        internal MeRefreshResult? Latest;
    }
    private readonly ConcurrentDictionary<string, Gate> gates = new(StringComparer.Ordinal);
    private long lastPrune;

    public async Task<IResult?> ValidateAsync(HttpContext context, Uri issuer, CancellationToken cancellationToken)
    {
        try { return await ValidateCoreAsync(context, issuer, cancellationToken); }
        catch (HttpRequestException) { return Unavailable(); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return Unavailable(); }
        catch (JsonException) { return Results.Problem(statusCode: 502, title: "IDP 会话响应无效"); }
    }

    private async Task<IResult?> ValidateCoreAsync(HttpContext context, Uri issuer, CancellationToken cancellationToken)
    {
        var ticket = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        var principal = ticket.Principal;
        var subject = principal?.FindFirstValue(OpenIddictConstants.Claims.Subject);
        if (!ticket.Succeeded || string.IsNullOrWhiteSpace(subject) ||
            !MeSessionLifecycle.TryGetSessionId(principal, out var sid) ||
            !MeSessionLifecycle.TryGetSessionStartedAt(principal, ticket.Properties, out var startedAt) ||
            MeSessionLifecycle.IsAbsoluteExpired(principal, DateTimeOffset.UtcNow) || lifecycle.IsRevoked(principal, ticket.Properties))
            return await RejectAsync(context);

        using var http = clients.CreateClient(ClientName);
        var tokens = SessionTokens.Read(ticket);
        if (tokens.AccessToken is { Length: > 0 } accessToken)
        {
            var status = await CheckAsync(http, issuer, accessToken, subject, cancellationToken);
            if (status == HttpStatusCode.OK) return null;
            if (status != HttpStatusCode.Unauthorized) return Unavailable();
        }
        if (string.IsNullOrWhiteSpace(tokens.RefreshToken)) return await RejectAsync(context);

        Prune();
        var gate = gates.GetOrAdd(subject + "\n" + sid,
            _ => new Gate(DateTimeOffset.FromUnixTimeSeconds(startedAt).Add(PandaAuthSessionApi.MeAbsoluteLifetime).AddMinutes(1)));
        await gate.Lock.WaitAsync(cancellationToken);
        try
        {
            if (!await ActiveAsync(principal!, ticket.Properties, sid, cancellationToken)) return await RejectAsync(context);
            MeRefreshResult refreshed;
            if (gate.OldRefresh == tokens.RefreshToken && gate.Latest is { } latest)
                refreshed = latest;
            else
                refreshed = await refresher.RefreshAsync(context, tokens.RefreshToken, cancellationToken);

            if (refreshed.Error is OpenIddictConstants.Errors.InvalidGrant or OpenIddictConstants.Errors.InvalidToken) return await RejectAsync(context);
            if (refreshed.Error is not null) return Unavailable();
            if (string.IsNullOrWhiteSpace(refreshed.AccessToken)) return Results.Problem(statusCode: 502, title: "IDP 刷新响应无效");
            var status = await CheckAsync(http, issuer, refreshed.AccessToken, subject, cancellationToken);
            if (status == HttpStatusCode.Unauthorized) return await RejectAsync(context);
            if (status != HttpStatusCode.OK) return Unavailable();
            if (!await ActiveAsync(principal!, ticket.Properties, sid, cancellationToken)) return await RejectAsync(context);

            var newRefresh = refreshed.RefreshToken ?? tokens.RefreshToken;
            gate.OldRefresh = tokens.RefreshToken;
            gate.Latest = new(refreshed.AccessToken, newRefresh);
            // Preserve auth time and expiry; this is credential rotation, not a new login.
            var properties = ticket.Properties!;
            var stored = properties.GetTokens().Where(token => token.Name != SessionTokens.AccessTokenName && token.Name != SessionTokens.RefreshTokenName).ToList();
            stored.Add(new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = refreshed.AccessToken });
            stored.Add(new AuthenticationToken { Name = SessionTokens.RefreshTokenName, Value = newRefresh });
            properties.StoreTokens(stored);
            await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal!, properties);
            return null;
        }
        finally { gate.Lock.Release(); }
    }

    private async Task<bool> ActiveAsync(ClaimsPrincipal principal, AuthenticationProperties? properties, string sid, CancellationToken cancellationToken)
        => !lifecycle.IsRevoked(principal, properties) && !MeSessionLifecycle.IsAbsoluteExpired(principal, DateTimeOffset.UtcNow)
            && !await remote.IsRevokedAsync(sid, cancellationToken)
            && !await remote.IsLoginRevokedAsync(principal.FindFirstValue(PandaAuthClaims.SsoSessionId)!, cancellationToken);

    private static async Task<HttpStatusCode> CheckAsync(HttpClient http, Uri issuer, string accessToken, string subject, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(issuer, PandaAuthEndpoints.Userinfo));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await http.SendAsync(request, cancellationToken);
        if (response.StatusCode != HttpStatusCode.OK) return response.StatusCode;
        using var payload = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellationToken), cancellationToken: cancellationToken);
        return payload.RootElement.TryGetProperty(OpenIddictConstants.Claims.Subject, out var value) && value.GetString() == subject
            ? HttpStatusCode.OK : HttpStatusCode.Unauthorized;
    }

    private void Prune()
    {
        var now = DateTimeOffset.UtcNow;
        var previous = Interlocked.Read(ref lastPrune);
        if (now.UtcTicks - previous < TimeSpan.TicksPerMinute || Interlocked.CompareExchange(ref lastPrune, now.UtcTicks, previous) != previous) return;
        foreach (var pair in gates)
            if (pair.Value.ExpiresAt < now) gates.TryRemove(pair);
    }
    private static IResult Unavailable() => Results.Problem(statusCode: 503, title: "IDP 暂时不可用");
    private static async Task<IResult> RejectAsync(HttpContext context)
    {
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Results.Unauthorized();
    }
}
