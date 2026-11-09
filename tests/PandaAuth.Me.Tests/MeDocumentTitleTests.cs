using Xunit;

namespace PandaAuth.Me.Tests;

public class MeDocumentTitleTests
{
    [Theory]
    [InlineData("登录未完成")]
    [InlineData("退出状态")]
    [InlineData("服务暂不可用")]
    public void AuthenticationStatusDocumentsKeepTheRegisteredApplicationTitle(string heading)
    {
        var html = MeAuthPage.Render(heading, ["synthetic status"], true);
        Assert.Contains("<title>PandaAuth 账户中心 | Panda Labs</title>", html);
        Assert.Contains(heading, html);
    }
}
