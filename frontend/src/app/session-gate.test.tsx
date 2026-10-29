import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router"
import { I18nProvider } from "@/lib/i18n"
import { SessionGate } from "./SessionGate"

const i18n = { defaultLocale: "zh-CN", locales: ["zh-CN"], dictionaries: { "zh-CN": { "会话服务异常，请刷新重试。": "会话服务异常，请刷新重试。", "重试": "重试" } } }

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("SessionGate", () => {
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
