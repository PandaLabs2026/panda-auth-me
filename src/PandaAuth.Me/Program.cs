using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
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
        // 时效：不沿用 ASP.NET Core 默认的「14 天滑动过期」——这枚 Cookie 里装着 refresh_token
        // （IDP 侧有效期 14 天），默认值等于把一枚长期凭据长期留在浏览器上。收紧为
        // 「闲置 8 小时过期、有活动即滑动续期」：这是安全与免重复登录之间的取舍——
        // 闲置超过 8 小时需重新登录（可接受），连续使用的人不会被中途打断。
        // 注意这只是浏览器侧时效；令牌本身的有效期由 IDP 与登出撤销另行约束，不由此值决定。
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
    });

// 会话 Cookie、防伪令牌与 OpenIddict 客户端状态均由 DataProtection 保护。
// Auth:DataProtectionKeyPath 非空时持久化密钥环（生产由 compose 注入卷路径），
// 容器重建后既有登录态不失效；默认空串 = 临时密钥，仅限开发环境。
// 应用名固定为 PandaAuth.Me：不同服务不共用密钥环，各服务的卷本就独立。
var dataProtectionKeyPath = builder.Configuration["Auth:DataProtectionKeyPath"];
if (!string.IsNullOrWhiteSpace(dataProtectionKeyPath))
{
    // 路径必须已存在：生产由 compose 命名卷挂载保证；不存在即说明「配置路径与卷挂载点不一致」，
    // 此时绝不能静默创建到容器临时层（密钥随容器重建即丢），必须失败关闭。
    // PersistKeysToFileSystem 自身会静默创建缺失目录且不告警，故守卫必须显式。
    if (!Directory.Exists(dataProtectionKeyPath))
    {
        throw new InvalidOperationException(
            $"DataProtection 密钥目录不存在：{dataProtectionKeyPath}（生产应由 compose 命名卷挂载到该路径）");
    }

    builder.Services
        .AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeyPath))
        .SetApplicationName("PandaAuth.Me");
}

builder.Services.AddAuthorization();
builder.Services.AddHealthChecks();

// IDP 侧取值集中取出：OpenIddict 客户端注册与登出撤销客户端共用同一组配置，避免两份事实源。
var issuer = new Uri(builder.Configuration["Auth:Issuer"] ?? "http://localhost:9004/");
var clientId = builder.Configuration["Auth:ClientId"] ?? "me-web";
// 机密客户端密钥失败关闭：缺失/为空即拒绝启动，不回退明文默认值（与 server 侧 Seeder 行为对齐）。
var clientSecret = builder.Configuration["Auth:ClientSecret"];
if (string.IsNullOrWhiteSpace(clientSecret))
{
    throw new InvalidOperationException("缺少 Auth:ClientSecret 配置（me-web 为机密客户端，密钥须由部署环境注入）。");
}

// 登出撤销客户端。超时取值的读取与校验都在 AddTokenRevocation 内、启动期完成——
// 不能留给 AddHttpClient 的 configure 委托（它只在解析该类型时才执行，见该方法的注释）。
builder.Services.AddTokenRevocation(builder.Configuration, new TokenRevocationOptions(issuer, clientId, clientSecret));

builder.Services.AddOpenIddict()
    .AddClient(options =>
    {
        options.AllowAuthorizationCodeFlow();
        options.AllowRefreshTokenFlow();

        // me 是 BFF：令牌保存在 DataProtection 保护的会话 Cookie 中（回调处显式 StoreTokens），
        // 不使用 OpenIddict 的服务端令牌存储，故无需注册 OpenIddict core 服务。
        // 不禁用则挑战阶段（生成 state 令牌）会抛 InvalidOperationException
        // （「The core services must be registered when enabling the OpenIddict client feature」），
        // 使 /me/login 直接 500——登录入口完全不可用，而非降级。
        options.DisableTokenStorage();

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
            Issuer = issuer,
            ClientId = clientId,
            ClientSecret = clientSecret,
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

    // 令牌名称取自 SessionTokens：写入侧（此处）与读取侧（登出撤销）必须同名，否则登出会「看起来成功但没撤」。
    var properties = new AuthenticationProperties();
    var refreshToken = result.Properties.GetTokenValue(SessionTokens.RefreshTokenName);
    var tokens = new List<AuthenticationToken>();
    var accessToken = result.Properties.GetTokenValue(SessionTokens.AccessTokenName);
    if (accessToken is not null)
    {
        tokens.Add(new AuthenticationToken { Name = SessionTokens.AccessTokenName, Value = accessToken });
    }
    if (refreshToken is not null)
    {
        tokens.Add(new AuthenticationToken { Name = SessionTokens.RefreshTokenName, Value = refreshToken });
    }
    properties.StoreTokens(tokens);

    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), properties);
    return Results.Redirect("/me/");
});

// 退出：撤销 Cookie 中的 IDP 令牌 → 清本服务会话 → RP 发起 end-session（IDP 统一单点登出）。
app.MapPost("/me/api/logout", async (HttpContext context, IAntiforgery antiforgery, TokenRevocationClient revocationClient) =>
{
    try
    {
        await antiforgery.ValidateRequestAsync(context);
    }
    catch (AntiforgeryValidationException)
    {
        return Results.BadRequest();
    }

    // 撤销必须排在 SignOutAsync 之前：Cookie 一清，票据里的令牌就再也取不回来了。
    // 取法与回调侧写入对称（SessionTokens.Read）；未登录或票据无令牌时得到 (null, null)，
    // 撤销客户端会跳过、不发请求。撤销失败只记 warning，不阻断下面的登出。
    var (accessToken, refreshToken) = SessionTokens.Read(
        await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme));
    await revocationClient.RevokeAsync(accessToken, refreshToken, context.RequestAborted);

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
