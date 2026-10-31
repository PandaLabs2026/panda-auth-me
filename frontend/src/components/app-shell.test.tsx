import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/app/router"
import { Providers, } from "@/test/utils"

// AppShell 布局组装契约(模板 AppLayout 之上):品牌、导航、返回应用入口。

afterEach(() => {
  cleanup()
  localStorage.setItem("panda.me.lang", "zh-CN")
  vi.restoreAllMocks()
})

describe("AppShell wiring", () => {
  it("updates the sidebar group label when the language changes", async () => {
    const user = userEvent.setup()
    render(<Providers><AppShell /></Providers>)
    expect(screen.getByText("导航")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "切换语言" }))
    expect(screen.getByText("Navigation")).toBeInTheDocument()
    expect(screen.queryByText("导航")).not.toBeInTheDocument()
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
    // 导航:账户中心两页。
    expect(screen.getByRole("link", { name: "账户总览" })).toBeInTheDocument()
    expect(screen.getByText("安全设置")).toBeInTheDocument()
    // 顶栏常驻件:返回来源应用(会话 appHomeUrl)。
    expect(screen.getByText("返回应用")).toHaveAttribute("href", "https://appliket.example/")
  })
})
