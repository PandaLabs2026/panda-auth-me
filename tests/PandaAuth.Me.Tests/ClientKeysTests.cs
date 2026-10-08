using System.Text.Json.Nodes;
using Microsoft.IdentityModel.Tokens;
using Xunit;
namespace PandaAuth.Me.Tests;
public class ClientKeysTests
{
    [Fact]
    public void SameDirectory_ReusesCredentials_AnotherDirectoryHasDifferentKeys()
    {
        var directory = Path.Combine(Path.GetTempPath(), "panda-me-repeat-" + Guid.NewGuid().ToString("N"));
        var other = directory + "-other";
        Directory.CreateDirectory(directory); Directory.CreateDirectory(other);
        try
        {
            var first = ClientKeys.LoadOrCreate(directory);
            var repeated = ClientKeys.LoadOrCreate(directory);
            var different = ClientKeys.LoadOrCreate(other);
            Assert.Equal(((SymmetricSecurityKey)first.Encryption.Key).Key, ((SymmetricSecurityKey)repeated.Encryption.Key).Key);
            Assert.NotEqual(((SymmetricSecurityKey)first.Encryption.Key).Key, ((SymmetricSecurityKey)different.Encryption.Key).Key);
        }
        finally { Directory.Delete(directory, true); Directory.Delete(other, true); }
    }
    [Fact]
    public async Task AtomicFirstCreation_AllReadersReceiveTheSameCompleteKey()
    {
        var directory=Path.Combine(Path.GetTempPath(),"panda-me-keys-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);
        try {
            var results=await Task.WhenAll(Enumerable.Range(0,8).Select(_=>Task.Run(()=>ClientKeys.LoadOrCreate(directory))));
            var expected=((SymmetricSecurityKey)results[0].Encryption.Key).Key;
            foreach(var result in results) Assert.Equal(expected,((SymmetricSecurityKey)result.Encryption.Key).Key);
            Assert.Single(Directory.GetFiles(directory));
            if(!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead|UnixFileMode.UserWrite,File.GetUnixFileMode(Path.Combine(directory,"client-keys.json")));
        } finally {Directory.Delete(directory,true);}
    }
    [Theory]
    [InlineData("truncated")]
    [InlineData("version")]
    [InlineData("algorithm")]
    [InlineData("material")]
    public void CorruptMaterial_IsRejectedWithoutReplacingFile(string mutation)
    {
        var directory=Path.Combine(Path.GetTempPath(),"panda-me-keys-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);
        try {
            ClientKeys.LoadOrCreate(directory);var file=Path.Combine(directory,"client-keys.json");var node=JsonNode.Parse(File.ReadAllText(file))!;
            if(mutation=="version") node["Version"]=2;
            if(mutation=="algorithm") node["Encryption"]!["Algorithm"]="none";
            if(mutation=="material") node["Encryption"]!["Key"]="";
            var corrupted=mutation=="truncated"?"{":node.ToJsonString();File.WriteAllText(file,corrupted);
            Assert.Throws<InvalidOperationException>(()=>ClientKeys.LoadOrCreate(directory));Assert.Equal(corrupted,File.ReadAllText(file));Assert.Single(Directory.GetFiles(directory));
        } finally {Directory.Delete(directory,true);}
    }
    [Fact]
    public void MissingDirectory_IsNotCreated()
    {
        var path=Path.Combine(Path.GetTempPath(),"panda-me-absent-"+Guid.NewGuid().ToString("N"));
        Assert.Throws<InvalidOperationException>(()=>ClientKeys.LoadOrCreate(path));Assert.False(Directory.Exists(path));
    }
    [Fact]
    public void FailedPublish_CleansTemporaryFileAndPreservesExistingDirectory()
    {
        var directory=Path.Combine(Path.GetTempPath(),"panda-me-keys-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(directory);
        try {
            Directory.CreateDirectory(Path.Combine(directory,"client-keys.json"));
            Assert.ThrowsAny<IOException>(()=>ClientKeys.LoadOrCreate(directory));
            Assert.Empty(Directory.GetFiles(directory));Assert.True(Directory.Exists(Path.Combine(directory,"client-keys.json")));
        } finally {Directory.Delete(directory,true);}
    }
}
