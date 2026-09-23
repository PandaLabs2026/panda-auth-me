import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import SecurityPage from "@/pages/security"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** 按前缀路由 mock fetch（长前缀放前面，避免 /factors 抢走 /factors/revoke）。 */
function routeFetch(routes: Array<[string, () => Response]>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const handler = routes.find(([prefix]) => url.startsWith(prefix))
    if (!handler) throw new Error(`unexpected fetch: ${url}`)
    return handler[1]()
  })
  vi.stubGlobal("fetch", fetchMock)
}

const loadedState = () => [
  [
    "/account/mfa/user/status",
    () =>
      jsonResponse({
        hasActiveFactor: true,
        requiresReconfiguration: false,
        recoveryCodeCount: 10,
        activePasskeyCount: 1,
      }),
  ],
  [
    "/account/mfa/user/factors",
    () =>
      jsonResponse([
        {
          id: "f1",
          type: "passkey",
          friendlyName: "Windows Hello",
          createdAt: "2026-09-23T08:00:00+00:00",
          lastUsedAt: null,
        },
      ]),
  ],
] as Array<[string, () => Response]>

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SecurityPage", () => {
  it("renders mfa status and registered factors", async () => {
    routeFetch(loadedState())

    render(<SecurityPage />)

    expect(await screen.findByText(/已启用/)).toBeInTheDocument()
    expect(screen.getByText("Windows Hello")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "撤销" })).toBeInTheDocument()
  })

  it("marks passkey as unsupported and keeps enrollment disabled without WebAuthn", async () => {
    routeFetch(loadedState())

    render(<SecurityPage />)

    expect(await screen.findByText(/此浏览器不支持 Passkey/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "添加 Passkey" })).toBeDisabled()
  })

  it("sends the user back to login when the IDP answers with an HTML login redirect", async () => {
    routeFetch([
      ["/account/mfa/user/status", () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } })],
      ["/account/mfa/user/factors", () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } })],
    ])

    render(<SecurityPage />)

    expect(await screen.findByRole("alert")).toHaveTextContent(/登录状态已失效/)
  })

  it("surfaces the server error when revoking the last active factor fails", async () => {
    routeFetch([
      ["/account/mfa/user/antiforgery", () => jsonResponse({ token: "test-token" })],
      ["/account/mfa/user/factors/revoke", () => jsonResponse({ error: "Cannot remove the last active factor." }, 400)],
      ...loadedState(),
    ])
    vi.spyOn(window, "confirm").mockReturnValue(true)

    render(<SecurityPage />)
    await screen.findByText("Windows Hello")
    await userEvent.click(screen.getByRole("button", { name: "撤销" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(/Cannot remove the last active factor/)
  })
})
