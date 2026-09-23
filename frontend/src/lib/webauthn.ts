/**
 * WebAuthn ceremony 的浏览器侧编解码，与 IDP `wwwroot/account/mfa.js` 逐字段对齐。
 * 服务端请求形状由 PandaAuth.Server 的 MfaRequestSerializationTests 钉死：
 * attestation 只送 clientDataJson + AttestationObject，assertion 送
 * clientDataJson + authenticatorData / signature / userHandle，二进制一律 Base64URL。
 */

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function encodeBase64Url(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

type RawCreationOptions = {
  challenge: string
  user: { id: string } & Record<string, unknown>
  excludeCredentials?: { id: string }[]
} & Record<string, unknown>

type RawAssertionOptions = {
  challenge: string
  allowCredentials?: { id: string }[]
} & Record<string, unknown>

export function toCreationOptions(json: unknown): PublicKeyCredentialCreationOptions {
  const raw = json as RawCreationOptions
  return {
    ...(raw as unknown as PublicKeyCredentialCreationOptions),
    challenge: decodeBase64Url(raw.challenge),
    user: { ...(raw.user as unknown as PublicKeyCredentialUserEntity), id: decodeBase64Url(raw.user.id) },
    excludeCredentials: (raw.excludeCredentials ?? []).map((item) => ({
      ...(item as unknown as PublicKeyCredentialDescriptor),
      id: decodeBase64Url(item.id),
    })),
  }
}

export function toAssertionOptions(json: unknown): PublicKeyCredentialRequestOptions {
  const raw = json as RawAssertionOptions
  return {
    ...(raw as unknown as PublicKeyCredentialRequestOptions),
    challenge: decodeBase64Url(raw.challenge),
    allowCredentials: (raw.allowCredentials ?? []).map((item) => ({
      ...(item as unknown as PublicKeyCredentialDescriptor),
      id: decodeBase64Url(item.id),
    })),
  }
}

/** 把 navigator.credentials 的结果序列化成服务端 Fido2 绑定所期望的 JSON。 */
export function credentialToJson(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse &
    AuthenticatorAssertionResponse &
    Record<string, ArrayBuffer | null>
  const encoded: Record<string, string> = { clientDataJson: encodeBase64Url(response.clientDataJSON) }
  if (response.attestationObject) encoded.AttestationObject = encodeBase64Url(response.attestationObject)
  if (response.authenticatorData) encoded.authenticatorData = encodeBase64Url(response.authenticatorData)
  if (response.signature) encoded.signature = encodeBase64Url(response.signature)
  if (response.userHandle) encoded.userHandle = encodeBase64Url(response.userHandle)
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    response: encoded,
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}
