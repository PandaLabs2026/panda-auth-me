using OpenIddict.Abstractions;
using OpenIddict.Client;

namespace PandaAuth.Me;

internal sealed class MeSessionRefresher(OpenIddictClientService client, IConfiguration configuration) : IMeSessionRefresher
{
    private readonly Uri platformIssuer = new(configuration["Auth:Issuer"] ?? "http://localhost:9004/");

    public async Task<MeRefreshResult> RefreshAsync(HttpContext context, string refreshToken, CancellationToken cancellationToken)
    {
        try
        {
            var response = await client.AuthenticateWithRefreshTokenAsync(new OpenIddictClientModels.RefreshTokenAuthenticationRequest
            {
                ProviderName = "pandaauth", Issuer = TenantOidcRouting.ResolveIssuer(context.Request, platformIssuer),
                RefreshToken = refreshToken, CancellationToken = cancellationToken,
            });
            return new(response.AccessToken, response.RefreshToken);
        }
        catch (OpenIddictExceptions.ProtocolException exception)
        {
            return new(null, null, exception.Error ?? OpenIddictConstants.Errors.ServerError);
        }
    }
}
