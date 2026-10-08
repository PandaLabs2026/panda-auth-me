using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.IdentityModel.Tokens;

namespace PandaAuth.Me;

/// <summary>Persistent OpenIddict state credentials; corrupt files fail closed.</summary>
public static class ClientKeys
{
    private const string FileName = "client-keys.json";

    /// <summary>加载持久化密钥；文件不存在则生成并写入，随后返回新建材料。</summary>
    public static (EncryptingCredentials Encryption, SigningCredentials Signing) LoadOrCreate(string directory)
    {
        if (!Directory.Exists(directory))
            throw new InvalidOperationException("客户端密钥目录必须已存在。");
        var path = Path.Combine(directory, FileName);
        if (File.Exists(path))
        {
            return Read(path);
        }

        // 对称加密密钥 256 位（A256KW + A256CBC-HS512 的要求）；签名 RSA-2048/RS256——
        // 与 AddEphemeral* 的算法族一致，令牌格式不因持久化而变。
        var encryption = new EncryptingCredentials(
            new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(32)),
            SecurityAlgorithms.Aes256KW,
            SecurityAlgorithms.Aes256CbcHmacSha512);

        using var rsa = RSA.Create(keySizeInBits: 2048);
        var parameters = rsa.ExportParameters(includePrivateParameters: true);
        var signing = new SigningCredentials(new RsaSecurityKey(parameters), SecurityAlgorithms.RsaSha256);

        var document = new KeyDocument(
            Version: 1,
            Encryption: new EncryptionMaterial(Algorithm: SecurityAlgorithms.Aes256KW,
                EncryptionAlgorithm: SecurityAlgorithms.Aes256CbcHmacSha512,
                Key: Base64UrlEncoder.Encode(((SymmetricSecurityKey)encryption.Key).Key)),
            Signing: ToMaterial(SecurityAlgorithms.RsaSha256, parameters));
        var temporary = Path.Combine(directory, ".client-keys-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            var fileOptions = new FileStreamOptions
            {
                Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None,
            };
            if (!OperatingSystem.IsWindows())
                fileOptions.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            using (var stream = new FileStream(temporary, fileOptions))
            {
                JsonSerializer.Serialize(stream, document, JsonOptions);
                stream.Flush(flushToDisk: true);
            }
            try { File.Move(temporary, path, overwrite: false); }
            catch (IOException) when (File.Exists(path))
            {
                // A concurrent creator won. Read its complete file, never overwrite it.
                return Read(path);
            }
            return (encryption, signing);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static (EncryptingCredentials Encryption, SigningCredentials Signing) Read(string path)
    {
        try
        {
            var document = JsonSerializer.Deserialize<KeyDocument>(File.ReadAllText(path), JsonOptions)
                ?? throw new InvalidOperationException("文件内容为空。");
            if (document.Version != 1
                || document.Encryption is not { Algorithm: SecurityAlgorithms.Aes256KW,
                    EncryptionAlgorithm: SecurityAlgorithms.Aes256CbcHmacSha512, Key.Length: > 0 }
                || document.Signing is not { Algorithm: SecurityAlgorithms.RsaSha256,
                    Modulus.Length: > 0, Exponent.Length: > 0, D.Length: > 0,
                    P.Length: > 0, Q.Length: > 0, DP.Length: > 0, DQ.Length: > 0, InverseQ.Length: > 0 })
                throw new InvalidOperationException("密钥版本、算法或材料无效。");
            var encryptionKey = Base64UrlEncoder.DecodeBytes(document.Encryption.Key);
            if (encryptionKey.Length != 32) throw new InvalidOperationException("加密密钥长度无效。");
            var parameters = FromMaterial(document.Signing);
            using var rsa = RSA.Create();
            rsa.ImportParameters(parameters);
            if (rsa.KeySize != 2048) throw new InvalidOperationException("签名密钥长度无效。");
            return (
                new EncryptingCredentials(new SymmetricSecurityKey(encryptionKey),
                    SecurityAlgorithms.Aes256KW, SecurityAlgorithms.Aes256CbcHmacSha512),
                new SigningCredentials(new RsaSecurityKey(parameters), SecurityAlgorithms.RsaSha256));
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException
            or FormatException or ArgumentException or CryptographicException)
        {
            // Do not log inner exceptions: malformed JSON can contain sensitive material.
            throw new InvalidOperationException($"OpenIddict 客户端密钥文件无效：{path}；拒绝静默轮换。");
        }
    }

    private static SigningMaterial ToMaterial(string algorithm, RSAParameters parameters) => new(
        Algorithm: algorithm,
        Modulus: Base64UrlEncoder.Encode(parameters.Modulus),
        Exponent: Base64UrlEncoder.Encode(parameters.Exponent),
        D: Base64UrlEncoder.Encode(parameters.D),
        P: parameters.P is null ? null : Base64UrlEncoder.Encode(parameters.P),
        Q: parameters.Q is null ? null : Base64UrlEncoder.Encode(parameters.Q),
        DP: parameters.DP is null ? null : Base64UrlEncoder.Encode(parameters.DP),
        DQ: parameters.DQ is null ? null : Base64UrlEncoder.Encode(parameters.DQ),
        InverseQ: parameters.InverseQ is null ? null : Base64UrlEncoder.Encode(parameters.InverseQ));

    private static RSAParameters FromMaterial(SigningMaterial material) => new()
    {
        Modulus = Base64UrlEncoder.DecodeBytes(material.Modulus),
        Exponent = Base64UrlEncoder.DecodeBytes(material.Exponent),
        D = Base64UrlEncoder.DecodeBytes(material.D),
        P = material.P is null ? null : Base64UrlEncoder.DecodeBytes(material.P),
        Q = material.Q is null ? null : Base64UrlEncoder.DecodeBytes(material.Q),
        DP = material.DP is null ? null : Base64UrlEncoder.DecodeBytes(material.DP),
        DQ = material.DQ is null ? null : Base64UrlEncoder.DecodeBytes(material.DQ),
        InverseQ = material.InverseQ is null ? null : Base64UrlEncoder.DecodeBytes(material.InverseQ),
    };

    private static JsonSerializerOptions JsonOptions => new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private sealed record KeyDocument(int Version, EncryptionMaterial? Encryption, SigningMaterial? Signing);

    private sealed record EncryptionMaterial(string Algorithm, string EncryptionAlgorithm, string Key);

    private sealed record SigningMaterial(
        string Algorithm,
        string Modulus,
        string Exponent,
        string D,
        string? P,
        string? Q,
        string? DP,
        string? DQ,
        string? InverseQ);
}
