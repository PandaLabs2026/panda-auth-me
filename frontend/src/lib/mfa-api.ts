/**
 * 账户中心安全设置 → IDP 用户 MFA 端点（/account/mfa/user/*）的直连同源封装。
 * 认证用 IDP 登录 Cookie；写操作需先取 antiforgery 令牌并以默认头
 * RequestVerificationToken 回传（IDP 未配置自定义 antiforgery header）。
 * 应用侧兜底文案按 currentLocale() 二选一；IDP body.error 透传不动（服务端契约）。
 */

import { currentLocale } from "@/i18n/config"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"

const MFA_BASE = "/account/mfa/user"

export type MfaStatus = {
  hasActiveFactor: boolean
  requiresReconfiguration: boolean
  recoveryCodeCount: number
}

export type MfaFactor = {
  id: string
  type: "totp"
  friendlyName: string | null
  createdAt: string
  lastUsedAt: string | null
}

/** 服务端 403 mfaGrantRequired 的结构化信号：携带授权签发所需的全部参数回显。 */
export class GrantRequiredError extends Error {
  constructor(
    readonly operation: string,
    readonly targetId: string,
    readonly parameters: Record<string, string | null> | null,
    readonly passwordRequired: boolean,
  ) {
    super("mfa_grant_required")
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  return fetchWithTimeout(path, init ?? {}, async (response) => {
    // IDP 的 [Authorize] 对未登录请求回 302 到登录页（fetch 会跟随并拿到 200 HTML），
    // 所以「非 JSON 响应」与 401 一样都意味着会话失效，统一送回 /me/login 重走 OIDC。
    const isJson = response.headers.get("content-type")?.includes("application/json") ?? false
    if (response.status === 401 || !isJson) {
      window.location.assign("/me/login")
      throw new Error(
        currentLocale() === "en"
          ? "Your session has expired. Signing you in again..."
          : "登录状态已失效，正在重新登录…",
      )
    }
    if (!response.ok) {
      let parsed: unknown = null
      try {
        parsed = await response.json()
      } catch {
        // 非 JSON 失败体，走通用文案
      }
      const body = parsed as {
        mfaGrantRequired?: boolean
        operation?: string
        targetId?: string
        parameters?: Record<string, string | null> | null
        passwordRequired?: boolean
        error?: unknown
      } | null
      if (body?.mfaGrantRequired && body.operation) {
        throw new GrantRequiredError(
          body.operation,
          body.targetId ?? "",
          body.parameters ?? null,
          body.passwordRequired === true,
        )
      }
      // body 已被消费，不能再读一次：错误串优先取 body.error，否则按状态码给兜底文案。
      if (body && typeof body.error === "string") throw new Error(body.error)
      const en = currentLocale() === "en"
      if (response.status === 403)
        throw new Error(
          en
            ? "Preconditions not met: a confirmed email and a recent verification are required."
            : "当前条件不满足：需要已确认的邮箱，且刚刚完成过验证。",
        )
      throw new Error(en ? `Request failed (HTTP ${response.status})` : `请求失败（HTTP ${response.status}）`)
    }
    return (await response.json()) as T
  })
}

async function post<T>(path: string, body?: unknown, grantId?: string): Promise<T> {
  const { token } = await fetchJson<{ token: string }>(`${MFA_BASE}/antiforgery`)
  return fetchJson<T>(`${MFA_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      RequestVerificationToken: token,
      "X-Requested-With": "XMLHttpRequest",
      ...(grantId ? { "X-Panda-Mfa-Grant": grantId } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
}

export const mfaApi = {
  status: () => fetchJson<MfaStatus>(`${MFA_BASE}/status`),
  factors: () => fetchJson<MfaFactor[]>(`${MFA_BASE}/factors`),

  // 操作授权（AUTH-DELIVERY-002，Passkey 退役后特敏感自助操作的单次授权）：
  // TOTP 码 + 操作者本人密码 → { grantId }，5 分钟内单次消费，重试原请求时带
  // X-Panda-Mfa-Grant 头。
  requestGrant: (operation: string, targetId: string, parameters: Record<string, string | null> | null, totpCode: string, currentPassword?: string) =>
    post<{ grantId: string; expiresAt: string }>("grants", { operation, targetId, parameters, totpCode, currentPassword }),

  totpOptions: (grantId?: string) =>
    post<{ factorId: string; secret: string; provisioningUri: string }>("totp/options", undefined, grantId),
  totpConfirm: (factorId: string, code: string) => post<{ status: string }>("totp/confirm", { factorId, code }),

  recoveryCodes: (grantId?: string) => post<string[]>("recovery-codes", undefined, grantId),
  revokeFactor: (factorId: string, grantId?: string) => post<{ status: string }>("factors/revoke", { factorId }, grantId),
}
