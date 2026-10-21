namespace PandaAuth.Me;

internal sealed record MeRefreshResult(string? AccessToken, string? RefreshToken, string? Error = null);

internal interface IMeSessionRefresher
{
    Task<MeRefreshResult> RefreshAsync(HttpContext context, string refreshToken, CancellationToken cancellationToken);
}
