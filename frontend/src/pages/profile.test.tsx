import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import ProfilePage from "@/pages/profile"
import { Providers } from "@/test/utils"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ProfilePage", () => {
  it("renders the identity card and self-service entries from the session", async () => {
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/me/api/session") {
        return new Response(JSON.stringify({
          subject: "user-1",
          name: "张三",
          email: "zhang@example.com",
          nickname: null,
          roles: [],
          appHomeUrl: "https://appliket.example/",
          appHomeLabel: null,
        }), { headers: { "content-type": "application/json" } })
      }
      return Promise.reject(new Error(`unexpected fetch: ${path}`))
    }))

    render(<Providers session="fetch"><ProfilePage /></Providers>)

    // displayName 三级回退 name → nickname → subject;占位卡如实标注 Phase 2。
    expect(await screen.findByText("张三")).toBeInTheDocument()
    expect(screen.getByText(/zhang@example\.com/)).toBeInTheDocument()
    expect(screen.getByText("登录记录")).toBeInTheDocument()
    expect(screen.getAllByText("Phase 2 上线")).toHaveLength(3)
  })

  it("keeps a loading skeleton at the content anchor while the session loads", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))

    render(<Providers session="fetch"><ProfilePage /></Providers>)

    expect(screen.getByRole("status")).toBeInTheDocument()
  })
})
