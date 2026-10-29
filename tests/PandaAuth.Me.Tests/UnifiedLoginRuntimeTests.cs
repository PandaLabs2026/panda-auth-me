using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
namespace PandaAuth.Me.Tests;

public class UnifiedLoginRuntimeTests
{
    private static WebApplicationFactory<Program> Factory() => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => {
        builder.UseEnvironment("Development");
        builder.UseSetting("Auth:ClientSecret", "fixture-browser-secret");
        builder.UseSetting("Auth:SessionState:ClientSecret", "fixture-session-secret");
        builder.UseSetting("Auth:Issuer", "https://idp.example.invalid/");
    });
    private static HttpClient Client(WebApplicationFactory<Program> factory) => factory.CreateClient(new WebApplicationFactoryClientOptions {
        BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false, HandleCookies = false
    });

    [Fact]
    public async Task DirectTerminal_IsPublic_AndDoesNotClaimLogoutWasConfirmed()
    {
        using var factory = Factory(); using var client = Client(factory);
        using var response = await client.GetAsync("/me/signed-out");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var html = await response.Content.ReadAsStringAsync();
        Assert.Contains("本应用的本地退出结果未确认", html);
        Assert.Contains("href=\"/me/sign-in\"", html);
        Assert.Contains("身份中心及关联应用的退出结果未确认", html);
        Assert.DoesNotContain("<script", html, StringComparison.OrdinalIgnoreCase);
        Assert.Null(response.Headers.Location);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
    }
    [Fact]
    public async Task NativeLogout_WithoutSession_StopsInsteadOfChallenging()
    {
        using var factory = Factory(); using var client = Client(factory);
        using var response = await client.PostAsync("/me/api/logout", new FormUrlEncodedContent(new Dictionary<string,string> { ["__RequestVerificationToken"] = "fixture-invalid" }));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("退出未完成", await response.Content.ReadAsStringAsync());
        Assert.Null(response.Headers.Location);
    }
    [Fact]
    public async Task DuplicateLoginReturnTargets_StopBeforeChallenge()
    {
        using var factory = Factory(); using var client = Client(factory);
        using var response = await client.GetAsync("/me/login?returnUrl=%2Fme%2Fsecurity&returnUrl=https%3A%2F%2Fevil.invalid");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(response.Headers.Location);
    }
    [Fact]
    public async Task LoginError_IsTerminalAndDoesNotEchoExternalParameters()
    {
        using var factory = Factory(); using var client = Client(factory);
        using var response = await client.GetAsync("/me/login?error=cancelled&returnUrl=https%3A%2F%2Fevil.invalid");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var html = await response.Content.ReadAsStringAsync();
        Assert.Contains("登录未完成", html); Assert.DoesNotContain("evil.invalid", html);
        Assert.DoesNotContain("<script", html, StringComparison.OrdinalIgnoreCase);
        Assert.Null(response.Headers.Location);
    }
}
