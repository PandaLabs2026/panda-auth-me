import { useMutation, useQuery } from "@tanstack/react-query"
import { useAuthState } from "@/components/patterns/auth/context"
import { meAuthLifecycle } from "@/lib/auth-lifecycle"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"

/**
 * 认证会话（真实 BFF 版，对齐模板 v0.5.0 会话层契约）：
 * 会话来自 PandaAuth Me BFF 的 GET /me/api/session（me-web 第一方 OIDC 客户端）；
 * 登录是整页跳转 BFF /me/login（challenge 到同域 IDP）；登出是防伪令牌成对的
 * POST /me/api/logout（本地 Cookie + IDP end-session）。
 * 组件层（useSession/useLogout/RequireAuth/AppLayout/NavUser）保持模板形态。
 * 本应用**就是**账户中心（IDP /me 契约的本体），accountEntryUrl 恒空——
 * 反向地，其他后台应用经会话下发的 accountEntryUrl 指向这里。
 * 数据面 401 语义在 mfa-api（IDP 直连）与 lib/api 无关：本应用无 Envelope 数据层，
 * 页面数据自行取数（会话外的端点都带 IDP 302→HTML 的会话失效语义）。
 */

export interface Session {
  displayName: string
  /** userinfo email 声明；BFF 出 JSON null 时归一为 undefined（对齐模板组件层契约）。 */
  email?: string
  roles?: string[]
  /** 账号自助入口（模板 IDP /me 契约）：本应用即该契约的本体，恒空。 */
  accountEntryUrl?: string | null
  /** BFF 原始会话字段透传（应用扩展）。 */
  subject?: string
  appHomeUrl?: string | null
  appHomeLabel?: string | null
}

/** BFF 会话契约（camelCase，对应 Program.cs 的会话端点）。 */
type BffSession = {
  subject: string
  name: string | null
  email: string | null
  nickname: string | null
  roles: string[]
  appHomeUrl: string | null
  appHomeLabel?: string | null
}

function isBffSession(value: unknown): value is BffSession {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  return typeof raw.subject === "string" && raw.subject.trim().length > 0
    && Array.isArray(raw.roles) && raw.roles.every((role) => typeof role === "string")
    && ["name", "nickname", "email", "appHomeUrl", "appHomeLabel"].every(
      (key) => raw[key] == null || typeof raw[key] === "string",
    )
}

/** A rejected resource triggers a merged session recheck, never direct navigation/replay. */
export function handleUnauthorized() {
  meAuthLifecycle.unauthorized(window.location.pathname + window.location.search)
}

export class AuthResponseError extends Error {
  constructor(readonly status: number, message: string) {super(message)}
}

async function responseError(response: Response): Promise<Error> {
  let message = "请求失败(HTTP " + response.status + ")"
  try {
    const problem = (await response.json()) as { detail?: string; title?: string }
    message = problem.detail ?? problem.title ?? message
  } catch {
    // Keep the status fallback for empty or non-JSON failures.
  }
  return new AuthResponseError(response.status, message)
}

export const sessionApi = {
  /** 会话探测：未登录/会话失效（401）静默收敛为 null，守卫据此送 /login 桥接页。 */
  async me(signal?: AbortSignal): Promise<Session | null> {
    return fetchWithTimeout(
      "/me/api/session",
      { signal, headers: { "X-Requested-With": "XMLHttpRequest" } },
      async (res) => {
        if (res.status === 401) return null
        if (!res.ok) throw await responseError(res)
        if (!(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error("会话响应格式无效")
        const raw: unknown = await res.json()
        if (!isBffSession(raw)) throw new Error("会话响应格式无效")
        return {
          displayName: raw.nickname ?? raw.name ?? raw.subject,
          email: raw.email ?? undefined,
          roles: raw.roles,
          accountEntryUrl: null,
          subject: raw.subject,
          appHomeUrl: raw.appHomeUrl,
          appHomeLabel: raw.appHomeLabel,
        }
      },
      10_000,
    )
  },

  /** Only fetch CSRF admission; a native form owns the full BFF/IdP logout navigation. */
  async logout(): Promise<void> {
    const token = await fetchWithTimeout(
      "/me/api/antiforgery",
      {},
      async (antiforgery) => {
        if (!antiforgery.ok) throw await responseError(antiforgery)
        return ((await antiforgery.json()) as { token: string }).token
      },
      10_000,
    )
    if (typeof token !== "string" || !token) throw new Error("退出请求缺少防伪凭据。")
    const form = document.createElement("form")
    form.method = "post"
    form.action = "/me/api/logout"
    form.hidden = true
    const field = document.createElement("input")
    field.type = "hidden"
    field.name = "__RequestVerificationToken"
    field.value = token
    form.append(field)
    document.body.append(form)
    try { HTMLFormElement.prototype.submit.call(form) }
    finally { form.remove() }
  },
}

/** 会话查询：无会话=null（守卫据此跳登录），Query 缓存单飞。 */
export function useSession() {
  const auth = useAuthState()
  return useQuery({ enabled: !auth.lifecycle, queryKey: ["session"], queryFn: ({ signal }) => sessionApi.me(signal), staleTime: 60_000, retry: false })
}

export function useLogout() {
  const auth = useAuthState()
  return useMutation({mutationFn: () => auth.lifecycle ? auth.logout() : sessionApi.logout()})
}
