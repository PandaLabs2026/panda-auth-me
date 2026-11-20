import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryRouter, RouterProvider } from "react-router"
import { I18nProvider } from "@/lib/i18n"
import { i18nConfig } from "@/i18n/config"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell, router } from "@/app/router"
import { Providers } from "@/test/utils"

// AppShell 布局组装契约(模板 AppLayout 之上):品牌、导航、返回应用入口。

afterEach(() => {
  cleanup()
  localStorage.setItem("panda.me.lang", "zh-CN")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("AppShell wiring", () => {
  it("updates the sidebar group label when the language changes", async () => {
    const user = userEvent.setup()
    render(<Providers><AppShell /></Providers>)
    expect(screen.getByText("导航")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "切换语言" }))
    expect(screen.getByText("Navigation")).toBeInTheDocument()
    expect(screen.queryByText("导航")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /测试用户/ }))
    expect(screen.queryByRole("menuitem", { name: "Profile" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Account and security" })).not.toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument()
  })

  it("renders PandaAuth brand, account-center nav items and the app-home header action", () => {
    render(
      <Providers>
        <AppShell />
      </Providers>,
    )

    // 品牌使用注册的横版应用锁定组合。
    const logo = screen.getByRole("img", { name: "PandaAuth by PandaLabs" })
    expect(logo).toHaveAttribute("src", "/me/pandaauth-logo-horizontal.png")
    expect(logo).toHaveClass("h-9", "w-auto", "object-contain")
    expect(screen.queryByRole("link", { name: "账户总览" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "账号与安全" })).toBeInTheDocument()
    // 顶栏常驻件:返回来源应用(会话 appHomeUrl)。
    expect(screen.getByText("返回应用")).toHaveAttribute("href", "https://appliket.example/")
  })

  it("keeps enabled account settings in the main navigation once", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(JSON.stringify(
      path === "/me/api/session"
        ? { subject: "actor", name: "Session user", email: null, roles: [], profileEditingEnabled: true }
        : { displayName: "Saved user", biography: null, hasAvatar: false, contactEmail: { address: null, state: "none" }, revision: '"0"' },
    ), { headers: { "Content-Type": "application/json" } })))
    render(<Providers session="fetch"><AppShell /></Providers>)
    expect(await screen.findByRole("link", { name: "个人资料" })).toHaveAttribute("href", "/profile")
    await user.click(await screen.findByRole("button", { name: /Saved user/ }))
    expect(screen.queryByRole("menuitem", { name: "个人资料" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "账号与安全" })).not.toBeInTheDocument()
  })
})


describe("Account center landing", () => {
  it.each([
    { enabled: true, entry: "/me/", expectedPath: "/me/profile", heading: "个人资料" },
    { enabled: false, entry: "/me", expectedPath: "/me/security", heading: "账号与安全" },
    { enabled: true, entry: "/me/security", expectedPath: "/me/security", heading: "账号与安全" },
  ])("opens $expectedPath from $entry (profile enabled: $enabled)", async ({ enabled, entry, expectedPath, heading }) => {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      const responses: Record<string, unknown> = {
        "/me/api/session": { subject: "actor", name: "Session user", email: "session@example.invalid", roles: [], profileEditingEnabled: enabled },
        "/me/api/profile": { displayName: "Profile user", biography: null, hasAvatar: false, contactEmail: { address: null, state: "none" }, revision: '"0"' },
        "/account/mfa/user/factors": [],
        "/account/mfa/user/status": { hasActiveFactor: false, requiresReconfiguration: false, recoveryCodeCount: 0 },
      }
      return Response.json(responses[path] ?? {}, { status: path in responses ? 200 : 404 })
    }))
    const testRouter = createMemoryRouter(router.routes, { basename: "/me", initialEntries: [entry] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<I18nProvider config={i18nConfig}><QueryClientProvider client={client}>
      <RouterProvider router={testRouter} />
    </QueryClientProvider></I18nProvider>)

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument()
    expect(testRouter.state.location.pathname).toBe(expectedPath)
    expect(screen.queryByRole("link", { name: "返回账户总览" })).not.toBeInTheDocument()
    if (entry !== expectedPath) expect(testRouter.state.historyAction).toBe("REPLACE")
  })
})
