import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import SecurityPage from "@/pages/security"
import { SessionGate } from "@/app/SessionGate"
import { useSession } from "@/lib/auth"
import { meAuthLifecycle } from "@/lib/auth-lifecycle"
import { MfaRequestError, StaleMfaResponseError, mfaApi } from "@/lib/mfa-api"
import { Providers } from "@/test/utils"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

type RecordedCall = { url: string; body: unknown; grantHeader?: string }

/** 按前缀路由 mock fetch（长前缀放前面），并记录写请求的授权头供断言。 */
function routeFetch(routes: Array<[string, () => Response | Promise<Response>]>) {
  const calls: RecordedCall[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const handler = routes.find(([prefix]) => url.startsWith(prefix))
    if (!handler) throw new Error(`unexpected fetch: ${url}`)
    if (init?.method === "POST") {
      const headers = init.headers as Record<string, string> | undefined
      calls.push({
        url,
        body: init.body ? JSON.parse(String(init.body)) : null,
        grantHeader: headers?.["X-Panda-Mfa-Grant"],
      })
    }
    return handler[1]()
  })
  vi.stubGlobal("fetch", fetchMock)
  return calls
}

const antiforgery: [string, () => Response] = [
  "/account/mfa/user/antiforgery",
  () => jsonResponse({ token: "test-token" }),
]

const totpUserState = (): Array<[string, () => Response | Promise<Response>]> => [
  [
    "/account/mfa/user/status",
    () => jsonResponse({ hasActiveFactor: true, requiresReconfiguration: false, recoveryCodeCount: 10 }),
  ],
  [
    "/account/mfa/user/factors",
    () =>
      jsonResponse([
        { id: "f2", type: "totp", friendlyName: null, createdAt: "2026-09-23T08:00:00+00:00", lastUsedAt: null },
      ]),
  ],
]

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.setItem("panda.me.lang", "zh-CN")
  meAuthLifecycle.pause(false)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SecurityPage", () => {
  it("shows the TOTP revocation explanation in English", async () => {
    localStorage.setItem("panda.me.lang", "en")
    routeFetch(totpUserState())
    render(<Providers><SecurityPage /></Providers>)
    expect(await screen.findByText("Revoking TOTP requires the current verification code and password; the last TOTP authenticator cannot be revoked (use “Replace TOTP” instead).")).toBeInTheDocument()
  })

  it("shows malformed identity responses as unavailable without declaring an expired session", async () => {
    routeFetch([
      ["/account/mfa/user/status", () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } })],
      ["/account/mfa/user/factors", () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } })],
    ])

    render(<Providers><SecurityPage /></Providers>)

    expect(await screen.findByRole("alert")).toHaveTextContent(/无效响应/)
  })

  it("renders the single TOTP factor with a replace hint and no revoke button", async () => {
    routeFetch(totpUserState())

    render(<Providers><SecurityPage /></Providers>)

    await screen.findAllByText("TOTP 验证器")
    // 轮换机制下唯一 TOTP 是稳态：撤销不可用，引导「更换 TOTP」。
    expect(screen.getByText(/更换请使用/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument()
  })

  // 操作授权流（AUTH-DELIVERY-002）：裸试 403 mfaGrantRequired → 授权对话框（TOTP+密码）
  // → POST grants → 带 X-Panda-Mfa-Grant 头重放原操作。
  it("runs the grant flow for replacing TOTP: 403 marker → dialog → grant header retry", async () => {
    let grantRequiredOnce = true
    const calls = routeFetch([
      antiforgery,
      [
        "/account/mfa/user/totp/options",
        () =>
          grantRequiredOnce
            ? jsonResponse(
                {
                  mfaGrantRequired: true,
                  operation: "self.totp-enroll",
                  targetId: "user-1",
                  parameters: {},
                  passwordRequired: true,
                },
                403,
              )
            : jsonResponse({ factorId: "f3", secret: "ABC", provisioningUri: "otpauth://totp/x" }),
      ],
      [
        "/account/mfa/user/grants",
        () => jsonResponse({ grantId: "11111111-1111-1111-1111-111111111111", expiresAt: "2026-10-25T12:00:00Z" }),
      ],
      ...totpUserState(),
    ])

    const user = userEvent.setup()
    render(<Providers><SecurityPage /></Providers>)
    await screen.findAllByText("TOTP 验证器")

    // 裸试：服务端 403 授权标记 → 弹出授权对话框（需验证码+密码）。
    await user.click(screen.getByRole("button", { name: "更换 TOTP" }))
    expect(await screen.findByRole("dialog")).toHaveTextContent(/更换 TOTP/)
    expect(screen.getByLabelText(/当前密码/)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/输入认证器 6 位验证码/), "123456")
    await user.type(screen.getByLabelText(/当前密码/), "Strong!Pass123")
    grantRequiredOnce = false
    await user.click(screen.getByRole("button", { name: "验证并继续" }))

    // 签发授权 → 重放 totp/options 带授权头，页面进入新验证器确认态。
    expect(await screen.findByText(/或手动添加密钥/)).toBeInTheDocument()

    const grantCall = calls.find((call) => call.url.includes("/grants"))
    expect(grantCall?.body).toMatchObject({ operation: "self.totp-enroll", targetId: "user-1", totpCode: "123456" })
    const retryCall = calls.filter((call) => call.url.includes("/totp/options")).at(-1)
    expect(retryCall?.grantHeader).toBe("11111111-1111-1111-1111-111111111111")
  })

  it("surfaces grant issuance failures inside the dialog without losing it", async () => {
    routeFetch([
      antiforgery,
      [
        "/account/mfa/user/totp/options",
        () =>
          jsonResponse(
            { mfaGrantRequired: true, operation: "self.totp-enroll", targetId: "user-1", parameters: {}, passwordRequired: true },
            403,
          ),
      ],
      ["/account/mfa/user/grants", () => jsonResponse({ error: "当前密码不正确。" }, 400)],
      ...totpUserState(),
    ])

    const user = userEvent.setup()
    render(<Providers><SecurityPage /></Providers>)
    await screen.findAllByText("TOTP 验证器")

    await user.click(screen.getByRole("button", { name: "更换 TOTP" }))
    await user.type(screen.getByLabelText(/输入认证器 6 位验证码/), "123456")
    await user.type(screen.getByLabelText(/当前密码/), "wrong")
    await user.click(screen.getByRole("button", { name: "验证并继续" }))

    expect(await screen.findByText(/当前密码不正确/)).toBeInTheDocument()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})

const grantRequired = () => jsonResponse({mfaGrantRequired: true, operation: "self.totp-enroll", targetId: "user-1", parameters: {}, passwordRequired: true}, 403)
const bffSession = (subject = "user-1") => jsonResponse({subject, name: "Fixture", nickname: null, email: null, roles: [], appHomeUrl: null})
function Subject() {const session = useSession(); return <span>{session.data?.subject}</span>}
function protectedSecurity() {return render(<Providers initialEntries={["/security"]}><SessionGate><Subject/><SecurityPage/></SessionGate></Providers>)}
async function openGrant() {
 const user = userEvent.setup(); await screen.findAllByText("TOTP 验证器")
 await user.click(screen.getByRole("button", {name: "更换 TOTP"}))
 await user.type(await screen.findByLabelText(/输入认证器 6 位验证码/), "123456")
 await user.type(screen.getByLabelText(/当前密码/), "fixture-private-password")
 return user
}
it("hides the portaled MFA dialog while paused and preserves its draft for the same subject", async () => {
 let pausedCheck = false; let finish!: (value: Response) => void
 const calls = routeFetch([["/me/api/session", () => pausedCheck ? new Promise<Response>(resolve => {finish = resolve}) : bffSession()], antiforgery, ["/account/mfa/user/totp/options", grantRequired], ...totpUserState()])
 protectedSecurity(); await openGrant()
 pausedCheck = true; act(() => meAuthLifecycle.unauthorized())
 await waitFor(() => expect(finish).toBeDefined())
 const visiblePortalWhilePaused = screen.queryByRole("dialog") !== null
 await act(async () => finish(jsonResponse({}, 401)))
 expect(await screen.findByRole("heading", {name: "登录已过期"})).toBeInTheDocument()
 expect(visiblePortalWhilePaused).toBe(false)
 pausedCheck = false; act(() => meAuthLifecycle.unauthorized())
 expect(await screen.findByLabelText(/当前密码/)).toHaveValue("fixture-private-password")
 expect(screen.getByLabelText(/输入认证器 6 位验证码/)).toHaveValue("123456")
 expect(calls.filter(call => call.url.includes("/totp/options"))).toHaveLength(1)
})
it("discards prior-subject MFA state on a forced session check without replaying an operation", async () => {
 let subject = "user-1"
 const calls = routeFetch([["/me/api/session", () => bffSession(subject)], antiforgery, ["/account/mfa/user/totp/options", grantRequired], ...totpUserState()])
 protectedSecurity(); await openGrant()
 subject = "user-2"; act(() => meAuthLifecycle.unauthorized())
 await screen.findByText("user-2")
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
 expect(document.querySelector("#grant-password")).toBeNull()
 expect(calls.filter(call => call.url.includes("/totp/options"))).toHaveLength(1)
})
it("does not use an operation grant that completes after the authentication epoch changed", async () => {
 let finish!: (value: {grantId: string; expiresAt: string}) => void
 vi.spyOn(mfaApi, "requestGrant").mockImplementation(() => new Promise(resolve => {finish = resolve}))
 const calls = routeFetch([antiforgery, ["/account/mfa/user/totp/options", grantRequired], ...totpUserState()])
 render(<Providers><SecurityPage/></Providers>); const user = await openGrant()
 await user.click(screen.getByRole("button", {name: "验证并继续"}))
 act(() => {meAuthLifecycle.pause(true); meAuthLifecycle.pause(false)})
 await act(async () => finish({grantId: "fixture-obsolete-grant", expiresAt: "2026-10-30T00:00:00Z"}))
 expect(calls.filter(call => call.url.includes("/totp/options"))).toHaveLength(1)
})

it("keeps a manual identity reauthentication action when the BFF session remains valid", async () => {
 const calls = routeFetch([["/me/api/session", () => bffSession()], antiforgery, ["/account/mfa/user/totp/options", () => jsonResponse({}, 401)], ...totpUserState()])
 protectedSecurity(); const user = userEvent.setup(); await screen.findAllByText("TOTP 验证器")
 await user.click(screen.getByRole("button", {name: "更换 TOTP"}))
 expect(await screen.findByRole("link", {name: "重新认证"})).toBeInTheDocument()
 expect(calls.filter(call => call.url.includes("/totp/options"))).toHaveLength(1)
})
it("drops cancelled password and OTP drafts instead of retaining a phantom leave warning", async () => {
 routeFetch([["/me/api/session", () => bffSession()], antiforgery, ["/account/mfa/user/totp/options", grantRequired], ...totpUserState()])
 protectedSecurity(); const user = await openGrant()
 expect(meAuthLifecycle.reasons().join()).toMatch(/MFA/)
 await user.click(screen.getByRole("button", {name: "取消"}))
 await waitFor(() => expect(meAuthLifecycle.reasons().join()).not.toMatch(/未完成的MFA/))
 expect(document.querySelector("#grant-password")).toBeNull()
})
it("submits an operation grant once while verification is pending", async () => {
 const finish: Array<(value: {grantId: string; expiresAt: string}) => void> = []
 const grant = vi.spyOn(mfaApi, "requestGrant").mockImplementation(() => new Promise(resolve => {finish.push(resolve)}))
 routeFetch([antiforgery, ["/account/mfa/user/totp/options", grantRequired], ...totpUserState()])
 render(<Providers><SecurityPage/></Providers>); const user = await openGrant()
 await user.dblClick(screen.getByRole("button", {name: "验证并继续"}))
 const attempts = grant.mock.calls.length
 await act(async () => finish.forEach(resolve => resolve({grantId: "fixture-grant", expiresAt: "2026-10-30T00:00:00Z"})))
 expect(attempts).toBe(1)
})

it("retains verified identity expiry when a concurrent read is cancelled first", async () => {
 vi.spyOn(mfaApi, "status").mockImplementation(async () => {
  await new Promise(resolve => setTimeout(resolve, 10))
  throw new MfaRequestError(401, "身份会话已失效")
 })
 vi.spyOn(mfaApi, "factors").mockRejectedValue(new StaleMfaResponseError())
 render(<Providers><SecurityPage /></Providers>)
 expect(await screen.findByRole("link", {name: "重新认证"})).toBeInTheDocument()
})
