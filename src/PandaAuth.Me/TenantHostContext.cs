using System.Security.Claims;
using PandaAuth.Shared;

namespace PandaAuth.Me;

/// <summary>校验 PandaAuth Me 当前请求主机与会话中的租户声明是否一致。</summary>
public static class TenantHostContext
{
    private const string PlatformHost = "auth.pandalabs.cn";

    public static bool TryValidate(HttpContext context, ClaimsPrincipal principal, out string? reason)
    {
        var host = context.Request.Host.Host;
        if (string.Equals(host, PlatformHost, StringComparison.OrdinalIgnoreCase) ||
            !LooksLikeTenantHost(host))
        {
            reason = null;
            return true;
        }

        var suffix = ".auth.pandalabs.cn";
        var prefix = host[..^suffix.Length];
        TenantId tenantId;
        try
        {
            tenantId = TenantId.Parse(prefix);
        }
        catch (FormatException)
        {
            reason = TenantContextErrors.UnknownHost;
            return false;
        }

        if (!string.Equals(principal.FindFirstValue(PandaAuthClaims.TenantId), tenantId.Value, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(principal.FindFirstValue(PandaAuthClaims.TenantHost), host, StringComparison.OrdinalIgnoreCase))
        {
            reason = TenantContextErrors.ContextMismatch;
            return false;
        }

        reason = null;
        return true;
    }

    public static bool LooksLikeTenantHost(string host) =>
        host.EndsWith(".auth.pandalabs.cn", StringComparison.OrdinalIgnoreCase) &&
        host.Length > ".auth.pandalabs.cn".Length;
}

/// <summary>已登录请求的租户主机边界；平台主机保留平台入口兼容行为。</summary>
public sealed class TenantHostContextMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if ((context.Request.Path.StartsWithSegments("/me/login") ||
             context.Request.Path.StartsWithSegments("/me/callback/login")) ||
            context.User.Identity?.IsAuthenticated != true)
        {
            await next(context);
            return;
        }

        if (TenantHostContext.LooksLikeTenantHost(context.Request.Host.Host) &&
            !TenantHostContext.TryValidate(context, context.User, out var reason))
        {
            context.Response.StatusCode = reason == TenantContextErrors.UnknownHost
                ? StatusCodes.Status421MisdirectedRequest
                : StatusCodes.Status403Forbidden;
            return;
        }

        await next(context);
    }
}
