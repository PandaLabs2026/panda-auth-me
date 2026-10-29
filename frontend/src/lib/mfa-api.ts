/**
 * 账户中心安全设置 → IDP 用户 MFA 端点（/account/mfa/user/*）的直连同源封装。
 * 认证用 IDP 登录 Cookie；写操作需先取 antiforgery 令牌并以默认头
 * RequestVerificationToken 回传（IDP 未配置自定义 antiforgery header）。
 * 应用侧兜底文案按 currentLocale() 二选一；IDP body.error 透传不动（服务端契约）。
 */

import { currentLocale } from "@/i18n/config"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"
import { handleUnauthorized } from "@/lib/auth"
import { currentMfaSubject, meAuthLifecycle, markOperationUncertain } from "@/lib/auth-lifecycle"

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

export class MfaRequestError extends Error {
  constructor(readonly status: number, message: string) {super(message)}
}
export class StaleMfaResponseError extends Error {
  constructor() {super(currentLocale() === "en" ? "Your sign-in state changed. Reload the security settings explicitly." : "登录状态变化，请重新读取安全设置。"); this.name = "StaleMfaResponseError"}
}
function requireActive(epoch: number) {
  if (meAuthLifecycle.paused() || meAuthLifecycle.epoch() !== epoch) throw new StaleMfaResponseError()
}
function identityLogin(response: Response) {
  if (!response.redirected || !response.url) return false
  const target = new URL(response.url)
  return target.origin === window.location.origin && target.pathname === "/account/login"
}

async function fetchJson<T>(path: string, init?: RequestInit, epoch = meAuthLifecycle.epoch()): Promise<T> {
  requireActive(epoch)
  const write = init?.method === "POST", owner = currentMfaSubject(), controller = new AbortController()
  const off = meAuthLifecycle.subscribe(() => {
    if (meAuthLifecycle.paused() || meAuthLifecycle.epoch() !== epoch) controller.abort()
  })
  try {
    return await fetchWithTimeout(path, {...init, signal: controller.signal}, async response => {
      requireActive(epoch)
      const en = currentLocale() === "en"
      const isJson = /^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(response.headers.get("content-type") ?? "")
      if (response.status === 401 || (!isJson && identityLogin(response))) {
        handleUnauthorized()
        throw new MfaRequestError(401, en ? "Your identity session has expired. Explicitly sign in again before retrying." : "身份会话已失效，请明确重新认证后重试。")
      }
      if (!isJson) throw new MfaRequestError(response.ok ? 0 : response.status,
        en ? "The account security service returned an invalid response. Retry explicitly." : "账户安全服务返回了无效响应，请明确重试。")
      if (!response.ok) {
        let parsed: unknown = null
        try {parsed = await response.json()} catch { /* Retain the HTTP status for malformed error bodies. */ }
        requireActive(epoch)
        const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
        if (response.status === 403 && body?.mfaGrantRequired === true && typeof body.operation === "string" && body.operation
          && typeof body.targetId === "string" && body.targetId && typeof body.passwordRequired === "boolean"
          && (body.parameters == null || typeof body.parameters === "object" && !Array.isArray(body.parameters)
            && Object.values(body.parameters).every(value => value === null || typeof value === "string"))) {
          throw new GrantRequiredError(body.operation, body.targetId,
            (body.parameters ?? null) as Record<string, string | null> | null, body.passwordRequired)
        }
        if (typeof body?.error === "string") throw new MfaRequestError(response.status, body.error)
        if (response.status === 403) throw new MfaRequestError(403, en
          ? "Preconditions not met: a confirmed email and a recent verification are required."
          : "当前条件不满足：需要已确认的邮箱，且刚刚完成过验证。")
        throw new MfaRequestError(response.status, en ? `Request failed (HTTP ${response.status})` : `请求失败（HTTP ${response.status}）`)
      }
      const result: unknown = await response.json()
      requireActive(epoch)
      return result as T
    })
  } catch (error) {
    const rejected = error instanceof GrantRequiredError || error instanceof MfaRequestError && error.status >= 400 && error.status < 500
    if (write && !rejected) markOperationUncertain(owner)
    // A verified 401 has a fixed, non-sensitive message the page can retain for manual reauthentication.
    if (!(error instanceof MfaRequestError && error.status === 401)) requireActive(epoch)
    throw error
  } finally {off()}
}

async function post<T>(path: string, body?: unknown, grantId?: string): Promise<T> {
  const epoch = meAuthLifecycle.epoch()
  requireActive(epoch)
  const release = meAuthLifecycle.protect("进行中的账户安全操作")
  try {
    const admission = await fetchJson<{token?: unknown}>(`${MFA_BASE}/antiforgery`, undefined, epoch)
    if (typeof admission?.token !== "string" || !admission.token) throw new MfaRequestError(0, "操作请求缺少防伪凭据。")
    requireActive(epoch)
    return await fetchJson<T>(`${MFA_BASE}/${path}`, {
      method: "POST",
      headers: {"Content-Type": "application/json", RequestVerificationToken: admission.token,
        "X-Requested-With": "XMLHttpRequest", ...(grantId ? {"X-Panda-Mfa-Grant": grantId} : {})},
      body: JSON.stringify(body ?? {}),
    }, epoch)
  } finally {release()}
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
