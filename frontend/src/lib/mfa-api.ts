/**
 * 账户中心安全设置 → IDP 用户 MFA 端点（/account/mfa/user/*）的直连同源封装。
 * 认证用 IDP 登录 Cookie；写操作需先取 antiforgery 令牌并以默认头
 * RequestVerificationToken 回传（IDP 未配置自定义 antiforgery header）。
 */

const MFA_BASE = "/account/mfa/user"

export type MfaStatus = {
  hasActiveFactor: boolean
  requiresReconfiguration: boolean
  recoveryCodeCount: number
  activePasskeyCount: number
}

export type MfaFactor = {
  id: string
  type: "totp" | "passkey"
  friendlyName: string | null
  createdAt: string
  lastUsedAt: string | null
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (body && typeof body.error === "string") return body.error
  } catch {
    // 非 JSON 响应体，落到通用文案
  }
  if (response.status === 403) return "当前条件不满足：需要已确认的邮箱，且刚刚完成过验证。"
  return `请求失败（HTTP ${response.status}）`
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (response.status === 401) {
    window.location.assign("/me/login")
    throw new Error("登录状态已失效，正在重新登录…")
  }
  if (!response.ok) throw new Error(await errorMessage(response))
  return (await response.json()) as T
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const { token } = await fetchJson<{ token: string }>(`${MFA_BASE}/antiforgery`)
  return fetchJson<T>(`${MFA_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      RequestVerificationToken: token,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify(body ?? {}),
  })
}

export const mfaApi = {
  status: () => fetchJson<MfaStatus>(`${MFA_BASE}/status`),
  factors: () => fetchJson<MfaFactor[]>(`${MFA_BASE}/factors`),

  passkeyEnrollmentOptions: () =>
    post<{ ceremonyId: string; publicKey: Record<string, unknown> }>("passkey/enrollment/options"),
  passkeyEnrollmentComplete: (ceremonyId: string, response: unknown) =>
    post<{ status: string; activePasskeyCount: number }>("passkey/enrollment/complete", { ceremonyId, response }),
  passkeyAssertionOptions: () =>
    post<{ ceremonyId: string; publicKey: Record<string, unknown> }>("passkey/assertion/options"),
  passkeyAssertionComplete: (ceremonyId: string, response: unknown) =>
    post<{ status: string }>("passkey/assertion/complete", { ceremonyId, response }),

  totpOptions: () =>
    post<{ factorId: string; secret: string; provisioningUri: string }>("totp/options"),
  totpConfirm: (factorId: string, code: string) => post<{ status: string }>("totp/confirm", { factorId, code }),

  recoveryCodes: () => post<string[]>("recovery-codes"),
  revokeFactor: (factorId: string) => post<{ status: string }>("factors/revoke", { factorId }),
}
