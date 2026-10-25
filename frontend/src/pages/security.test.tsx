import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import SecurityPage from "@/pages/security"
import { Providers } from "@/test/utils"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

type RecordedCall = { url: string; body: unknown; grantHeader?: string }

/** 按前缀路由 mock fetch（长前缀放前面），并记录写请求的授权头供断言。 */
function routeFetch(routes: Array<[string, () => Response]>) {
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

const totpUserState = (): Array<[string, () => Response]> => [
  [
    "/account/mfa/user/status",
    () =>
      jsonResponse({
        hasActiveFactor: true,
        requiresReconfiguration: false,
        recoveryCodeCount: 10,
        activePasskeyCount: 0,
      }),
  ],
  [
    "/account/mfa/user/factors",
    () =>
      jsonResponse([
        { id: "f2", type: "totp", friendlyName: null, createdAt: "2026-09-23T08:00:00+00:00", lastUsedAt: null },
      ]),
  ],
]

const retiredPasskeyState = (): Array<[string, () => Response]> => [
  [
    "/account/mfa/user/status",
    () =>
      jsonResponse({
        hasActiveFactor: false,
        requiresReconfiguration: false,
        recoveryCodeCount: 0,
        activePasskeyCount: 1,
      }),
  ],
  [
    "/account/mfa/user/factors",
    () =>
      jsonResponse([
        { id: "f1", type: "passkey", friendlyName: "Windows Hello", createdAt: "2026-09-23T08:00:00+00:00", lastUsedAt: null },
      ]),
  ],
]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SecurityPage", () => {
  it("labels retired passkey rows as retired and offers no passkey enrollment", async () => {
    routeFetch(retiredPasskeyState())

    render(<Providers><SecurityPage /></Providers>)

    expect(await screen.findByText(/已退役 Passkey/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "撤销" })).toBeInTheDocument()
    // Passkey 已退役：页面不出现任何添加/注册 Passkey 入口。
    expect(screen.queryByRole("button", { name: /Passkey/ })).not.toBeInTheDocument()
  })

  it("sends the user back to login when the IDP answers with an HTML login redirect", async () => {
    routeFetch([
      ["/account/mfa/user/status", () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } })],
      ["/account/mfa/user/factors", () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } })],
    ])

    render(<Providers><SecurityPage /></Providers>)

    expect(await screen.findByRole("alert")).toHaveTextContent(/登录状态已失效/)
  })

  it("revokes a retired passkey row without an operation grant (migration action)", async () => {
    const calls = routeFetch([
      antiforgery,
      ["/account/mfa/user/factors/revoke", () => jsonResponse({ status: "ok" })],
      ...retiredPasskeyState(),
    ])
    const user = userEvent.setup()

    render(<Providers><SecurityPage /></Providers>)
    await screen.findByText(/已退役 Passkey/)

    await user.click(screen.getByRole("button", { name: "撤销" }))
    await user.click(screen.getByTestId("confirm-action-confirm"))

    await screen.findByText(/因子已撤销/)
    const revokeCall = calls.find((call) => call.url.includes("/factors/revoke"))
    expect(revokeCall).toBeTruthy()
    expect(revokeCall?.grantHeader).toBeUndefined()
  })

  it("shows the replace hint instead of a revoke button for the only TOTP factor", async () => {
    routeFetch(totpUserState())

    render(<Providers><SecurityPage /></Providers>)

    await screen.findAllByText("TOTP 验证器")
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
