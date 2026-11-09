using System.Collections.Concurrent;
using PandaAuth.Shared;

namespace PandaAuth.Me.BrowserTests;

// Synthetic private profile store for BFF/browser transport tests; no persistence or real delivery.
internal sealed class FixtureProfile
{
    private readonly ConcurrentDictionary<string, SelfProfileDto> profiles = new();
    private readonly ConcurrentDictionary<string, string> challenges = new();
    internal void Map(WebApplication app, Func<HttpContext, string?> actor, Func<string> mode)
    {
        app.MapMethods(PandaAuthProfileApi.Self + "/{**suffix}", ["GET", "PATCH", "PUT", "POST", "DELETE"], (Delegate)Handle);
        app.MapMethods(PandaAuthProfileApi.Self, ["GET", "PATCH"], (Delegate)Handle);
        async Task<IResult> Handle(HttpContext context)
        {
            context.Response.Headers.CacheControl = "no-store";
            var owner = actor(context);
            if (owner is null) return Results.Json(new { code = "profile_identity_invalid" }, statusCode: 401);
            var current = profiles.GetOrAdd(owner, _ => new SelfProfileDto(null, null, false, new(null, ProfileContactEmailState.None), "\"0\""));
            var path = context.Request.Path.Value!;
            if (context.Request.Method == "GET")
            {
                if (path == PandaAuthProfileApi.Avatar)
                    return current.HasAvatar ? Results.Bytes(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA4sAAAAASUVORK5CYII="), "image/png")
                        : Results.Json(new { code = "profile_avatar_unavailable" }, statusCode: 404);
                return Results.Json(current);
            }
            if (path != PandaAuthProfileApi.ContactEmailConfirmation && (context.Request.Headers.IfMatch != current.Revision || mode() == "profile-conflict"))
                return Results.Json(new { code = "profile_revision_mismatch" }, statusCode: 412);
            var next = current;
            if (path == PandaAuthProfileApi.Self)
            {
                var input = await context.Request.ReadFromJsonAsync<Dictionary<string, string?>>();
                if (input!.TryGetValue("displayName", out var name)) next = next with { DisplayName = name };
                if (input.TryGetValue("biography", out var bio)) next = next with { Biography = bio };
            }
            else if (path == PandaAuthProfileApi.Avatar) next = next with { HasAvatar = context.Request.Method == "PUT" };
            else if (path == PandaAuthProfileApi.ContactEmail) next = next with { ContactEmail = new(null, ProfileContactEmailState.None) };
            else if (path == PandaAuthProfileApi.ContactEmailChallenges)
            {
                var input = (await context.Request.ReadFromJsonAsync<ProfileContactEmailChallengeRequest>())!;
                next = next with { ContactEmail = new(input.Address, ProfileContactEmailState.Pending) };
            }
            else if (path == PandaAuthProfileApi.ContactEmailConfirmation)
            {
                var input = (await context.Request.ReadFromJsonAsync<ProfileContactEmailConfirmationRequest>())!;
                if (!challenges.TryGetValue(owner, out var challenge) || input.ChallengeId != challenge || input.Token != "fixture-mail-token")
                    return Results.Json(new { code = "contact_challenge_invalid" }, statusCode: 422);
                next = next with { ContactEmail = next.ContactEmail with { State = ProfileContactEmailState.Verified } };
            }
            else return Results.NotFound();
            challenges.TryRemove(owner, out _);
            next = next with { Revision = "\"" + Guid.NewGuid().ToString("N") + "\"" };
            profiles[owner] = next;
            if (path == PandaAuthProfileApi.ContactEmailChallenges)
            {
                var id = Guid.NewGuid().ToString("D"); challenges[owner] = id;
                return Results.Json(new ProfileContactEmailChallengeResponse(next, id));
            }
            return Results.Json(next);
        }
    }
}
