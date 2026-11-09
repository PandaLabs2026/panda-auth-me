import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import ProfilePage from "@/pages/profile"
import { Providers } from "@/test/utils"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.setItem("panda.me.lang", "zh-CN")
})

describe("ProfilePage", () => {
  it("translates the security settings description in English", async () => {
    localStorage.setItem("panda.me.lang", "en")
    render(<Providers><ProfilePage /></Providers>)
    expect(await screen.findByText("TOTP and recovery code management")).toBeInTheDocument()
    expect(screen.queryByText("TOTP 与恢复码管理")).not.toBeInTheDocument()
  })

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

    // Descriptive session names are shown; placeholders remain explicit.
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

 it.each([["zh-CN", "未设置名称", "邮箱暂不可用"], ["en", "Name not set", "Email unavailable"]])("minimizes the self profile in %s", async (locale, name, email) => {
  localStorage.setItem("panda.me.lang", locale)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({subject: "internal-secret-id", name: " ", nickname: null, email: null, roles: ["internal-admin-role"]}), {headers: {"content-type": "application/json"}})))
  render(<Providers session="fetch"><ProfilePage /></Providers>)
  expect(await screen.findByText(name)).toBeInTheDocument()
  expect(screen.getByText(email)).toBeInTheDocument()
  expect(screen.queryByText(/internal-secret-id|internal-admin-role|普通用户|未绑定邮箱/)).not.toBeInTheDocument()
 })
