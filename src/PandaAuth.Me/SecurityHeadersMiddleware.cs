namespace PandaAuth.Me;

/// <summary>自助中心安全响应头。</summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;
        headers.XContentTypeOptions = "nosniff";
        headers.XFrameOptions = "DENY";
        headers["Referrer-Policy"] = "no-referrer";
        headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'";
        headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";

        await next(context);
    }
}
