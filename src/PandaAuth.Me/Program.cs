using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.HttpOverrides;
using OpenIddict.Abstractions;
using OpenIddict.Client;
using OpenIddict.Client.AspNetCore;
using PandaAuth.Me;
using PandaAuth.Shared;
using static OpenIddict.Abstractions.OpenIddictConstants;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddAntiforgery(options => options.HeaderName = "X-XSRF-Token");
builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = OpenIddictClientAspNetCoreDefaults.AuthenticationScheme;
    })
    .AddCookie(options =>
    {
        options.Cookie.Name = "PandaAuth.Me";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    });
builder.Services.AddAuthorization();
builder.Services.AddHealthChecks();

builder.Services.AddOpenIddict()
    .AddClient(options =>
    {
        options.AllowAuthorizationCodeFlow();
        options.AllowRefreshTokenFlow();
        options.AddEphemeralEncryptionKey();
        options.AddEphemeralSigningKey();
        options.UseSystemNetHttp();
        options.UseAspNetCore()
            .EnableRedirectionEndpointPassthrough()
            .EnablePostLogoutRedirectionEndpointPassthrough()
            .EnableErrorPassthrough();

        // 第一方客户端（me-web，机密 + PKCE），由 panda-auth-server 的 Seeder 预置。
        options.AddRegistration(new OpenIddictClientRegistration
        {
            ProviderName = "pandaauth",
            Issuer = new Uri(builder.Configuration["Auth:Issuer"] ?? "http://localhost:9004/"),
            ClientId = builder.Configuration["Auth:ClientId"] ?? "me-web",
            // 机密客户端密钥失败关闭：缺失/为空即拒绝启动，不回退明文默认值（与 server 侧 Seeder 行为对齐）。
            ClientSecret = string.IsNullOrWhiteSpace(builder.Configuration["Auth:ClientSecret"])
                ? throw new InvalidOperationException("缺少 Auth:ClientSecret 配置（me-web 为机密客户端，密钥须由部署环境注入）。")
                : builder.Configuration["Auth:ClientSecret"]!,
            Scopes =
            {
                OpenIddictConstants.Scopes.OpenId,
                OpenIddictConstants.Scopes.Profile,
                OpenIddictConstants.Scopes.Email,
                OpenIddictConstants.Scopes.Roles,
                OpenIddictConstants.Scopes.OfflineAccess,
            },
            // 实际回调路由为 /me/callback/login/{provider}（Caddy 以 /me 路径反代），默认值须带 /me 前缀；生产值由 compose 注入。
            RedirectUri = new Uri(builder.Configuration["Auth:RedirectUri"] ?? "http://localhost:9007/me/callback/login/pandaauth"),
            PostLogoutRedirectUri = new Uri(builder.Configuration["Auth:PostLogoutRedirectUri"] ?? "http://localhost:9007/me/"),
        });
    });

var app = builder.Build();

// Caddy 以 HTTP 反代到 127.0.0.1:9007 并终结 TLS，需还原真实 Scheme 与客户端 IP。
// 仅信任回环代理（Caddy 与容器同 host network，真实代理永远是回环地址）：伪造发生在 XFF 头链而非连接层，
// 端口绑定 127.0.0.1 不能消除伪造风险，全量网段信任属失败开放配置。
// ForwardLimit=1：只消费 Caddy 追加的最右一跳真实客户端 IP，攻击者伪造的最左值无法污染还原结果。
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1,
    KnownProxies = { IPAddress.Loopback, IPAddress.IPv6Loopback },
});

app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseStaticFiles();

// 登录：challenge 到同域 IDP（用户看到 PandaAuth 统一登录页）。
app.MapGet("/me/login", (string? returnUrl) =>
    Results.Challenge(new AuthenticationProperties
    {
        RedirectUri = string.IsNullOrEmpty(returnUrl) ? "/me/" : returnUrl,
    }));

// OIDC 回调：复制身份与令牌到本服务会话 Cookie。
app.MapGet("/me/callback/login/{provider}", async (HttpContext context) =>
{
    var result = await context.AuthenticateAsync(OpenIddictClientAspNetCoreDefaults.AuthenticationScheme);
    if (result is not { Succeeded: true } || result.Principal is null)
    {
        return Results.Redirect("/me/");
    }

    var identity = new ClaimsIdentity(CookieAuthenticationDefaults.AuthenticationScheme);
    identity.AddClaim(new Claim(Claims.Subject, result.Principal.GetClaim(Claims.Subject) ?? string.Empty));
    var name = result.Principal.GetClaim(Claims.Name);
    if (!string.IsNullOrEmpty(name))
    {
        identity.AddClaim(new Claim(Claims.Name, name));
    }
    var email = result.Principal.GetClaim(Claims.Email);
    if (!string.IsNullOrEmpty(email))
    {
        identity.AddClaim(new Claim(Claims.Email, email));
    }
    var nickname = result.Principal.GetClaim(PandaAuthClaims.Nickname);
    if (!string.IsNullOrEmpty(nickname))
    {
        identity.AddClaim(new Claim(PandaAuthClaims.Nickname, nickname));
    }
    identity.AddClaims(result.Principal.FindAll(Claims.Role));

    var properties = new AuthenticationProperties();
    var refreshToken = result.Properties.GetTokenValue("refresh_token");
    var tokens = new List<AuthenticationToken>();
    var accessToken = result.Properties.GetTokenValue("access_token");
    if (accessToken is not null)
    {
        tokens.Add(new AuthenticationToken { Name = "access_token", Value = accessToken });
    }
    if (refreshToken is not null)
    {
        tokens.Add(new AuthenticationToken { Name = "refresh_token", Value = refreshToken });
    }
    properties.StoreTokens(tokens);

    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), properties);
    return Results.Redirect("/me/");
});

// 退出：清本服务会话 + RP 发起 end-session（IDP 统一单点登出）。
app.MapPost("/me/api/logout", async (HttpContext context, IAntiforgery antiforgery) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(context);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.SignOut(
        new AuthenticationProperties { RedirectUri = "/me/" },
        [OpenIddictClientAspNetCoreDefaults.AuthenticationScheme]);
});

// 会话查询（SPA 用）：未登录 401，前端引导跳 /me/login。
app.MapGet("/me/api/session", (HttpContext context) =>
{
    if (context.User.Identity?.IsAuthenticated != true)
    {
        return Results.Unauthorized();
    }

    return Results.Ok(new
    {
        subject = context.User.FindFirst(Claims.Subject)?.Value,
        name = context.User.FindFirst(Claims.Name)?.Value,
        email = context.User.FindFirst(Claims.Email)?.Value,
        nickname = context.User.FindFirst(PandaAuthClaims.Nickname)?.Value,
        roles = context.User.FindAll(Claims.Role).Select(claim => claim.Value).ToArray(),
    });
});

app.MapGet("/me/api/antiforgery", (HttpContext context, IAntiforgery antiforgery) =>
{
    var tokens = antiforgery.GetAndStoreTokens(context);
    return Results.Ok(new { token = tokens.RequestToken });
});

app.MapHealthChecks("/me/healthz");

// SPA 回退：/me 下非文件路径一律返回 index.html。
app.MapFallbackToFile("/me/{*path:nonfile}", "me/index.html");

app.Run();
