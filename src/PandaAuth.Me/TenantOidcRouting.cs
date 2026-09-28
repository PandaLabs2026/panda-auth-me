namespace PandaAuth.Me;

public static class TenantOidcRouting
{
    public static Uri ResolveIssuer(HttpRequest request, Uri platformIssuer)
    {
        var host = request.Host.Host;
        const string suffix = ".auth.pandalabs.cn";
        if (!host.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            return platformIssuer;

        var prefix = host[..^suffix.Length];
        if (prefix.Length != 5 || char.ToLowerInvariant(prefix[0]) != 't' || !prefix[1..].All(char.IsDigit))
            throw new InvalidOperationException($"非法 PandaAuth 租户 Host：{host}");

        return new Uri($"{request.Scheme}://{host}/");
    }
}
