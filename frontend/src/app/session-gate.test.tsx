import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router"
import { I18nProvider } from "@/lib/i18n"
import { i18nConfig } from "@/i18n/config"
import { SessionGate } from "./SessionGate"
import { meAuthNavigation } from "@/lib/auth-lifecycle"

const i18n = { defaultLocale: "zh-CN", locales: ["zh-CN"], dictionaries: { "zh-CN": { "会话服务异常，请刷新重试。": "会话服务异常，请刷新重试。", "重试": "重试" } } }

afterEach(() => {
  sessionStorage.clear()
  localStorage.setItem("panda.me.lang", "zh-CN")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("SessionGate", () => {
describe("SessionGate quiet recovery", () => {
  it("presents the quiet stage text on anonymous recovery and challenges exactly once", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))))
    const start = vi.spyOn(meAuthNavigation, "start").mockReturnValue(true)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <I18nProvider config={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/protected"]}>
            <SessionGate><p>受保护页面</p></SessionGate>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>,
    )
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    // quiet 呈现:无恢复卡,仅可访问的阶段文字
    expect(screen.getByText("正在前往认证…")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "正在前往登录…" })).not.toBeInTheDocument()
  })
})

  it("keeps the protected route in an error state when session lookup returns 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <I18nProvider config={i18n}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/protected"]}>
            <Routes>
              <Route path="/protected" element={<SessionGate><p>受保护页面</p></SessionGate>} />
              <Route path="/login" element={<p>登录页</p>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>,
    )

    expect(await screen.findByRole("heading", {name: "暂时无法确认登录状态"})).toBeInTheDocument()
    expect(screen.queryByText("登录页")).not.toBeInTheDocument()
    expect(screen.queryByText("受保护页面")).not.toBeInTheDocument()
  })
})


function boundary() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  return render(<I18nProvider config={i18n}><QueryClientProvider client={client}><MemoryRouter initialEntries={["/security?tab=totp"]}><SessionGate><p>private account content</p></SessionGate></MemoryRouter></QueryClientProvider></I18nProvider>)
}

it("stops a repeated anonymous attempt outside the business shell and retains the query", async () => {
  sessionStorage.setItem("panda.me.auth.login-attempt", String(Date.now()))
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {status: 401})))
  boundary()
  expect(await screen.findByRole("heading", {name: "登录未完成"})).toBeInTheDocument()
  expect(screen.queryByText("private account content")).not.toBeInTheDocument()
  expect(screen.getByRole("link", {name: "重新登录"})).toHaveAttribute("href", "/me/login?returnUrl=%2Fme%2Fsecurity%3Ftab%3Dtotp")
})
it("keeps permission failures out of automatic login", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {status: 403, headers: {"content-type": "application/json"}})))
  boundary()
  expect(await screen.findByRole("heading", {name: "此账号没有访问权限"})).toBeInTheDocument()
  expect(screen.queryByRole("link", {name: "继续登录"})).not.toBeInTheDocument()
  expect(screen.queryByText("private account content")).not.toBeInTheDocument()
})

it("keeps the existing English preference on an unavailable session without mounting business", async () => {
 localStorage.setItem("panda.me.lang", "en")
 const fetch = vi.fn().mockResolvedValue(new Response(null, {status: 503}))
 vi.stubGlobal("fetch", fetch)
 const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
 render(<I18nProvider config={i18nConfig}><QueryClientProvider client={client}><MemoryRouter><SessionGate><p>private account content</p></SessionGate></MemoryRouter></QueryClientProvider></I18nProvider>)
 expect(document.documentElement.lang).toBe("en")
 expect(await screen.findByRole("heading", {name: "Unable to confirm sign-in"})).toBeInTheDocument()
 expect(screen.getByRole("button", {name: "Retry"})).toBeInTheDocument()
 expect(screen.queryByText("private account content")).not.toBeInTheDocument()
 expect(fetch).toHaveBeenCalledOnce()
})
