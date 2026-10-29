using Microsoft.AspNetCore.DataProtection;
using Xunit;
namespace PandaAuth.Me.Tests;
public class MeLogoutProofTests
{
    [Fact]
    public void Proof_IsLocalShortLivedAndCannotClaimLogoutForAuthenticatedSession()
    {
        var proof = new MeLogoutProof(new EphemeralDataProtectionProvider());
        var now = DateTimeOffset.UtcNow; var token = proof.Create(now);
        Assert.True(proof.Validate(token, now, false));
        Assert.False(proof.Validate(token, now, true));
        Assert.False(proof.Validate(token, now.AddMinutes(2), false));
        Assert.False(proof.Validate(token, now.AddMinutes(-1), false));
        Assert.False(proof.Validate("true", now, false));
        Assert.False(proof.Validate(null, now, false));
    }
}
