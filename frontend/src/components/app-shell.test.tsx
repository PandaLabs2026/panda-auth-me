import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/app/router"
import { Providers, } from "@/test/utils"

// AppShell 布局组装契约(模板 AppLayout 之上):品牌、导航、返回应用入口。

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("AppShell wiring", () => {
  it("renders PandaAuth brand, account-center nav items and the app-home header action", () => {
    render(
      <Providers>
        <AppShell />
      </Providers>,
    )

    // 品牌:mark + 应用名双行(模板 AppLayout 结构,应用身份)。
    expect(screen.getByText("PandaAuth")).toBeInTheDocument()
    expect(screen.getByAltText("PandaAuth")).toHaveAttribute("src", "/me/pandaauth-icon-512.png")
    // 导航:账户中心两页。
    expect(screen.getByText("账户总览")).toBeInTheDocument()
    expect(screen.getByText("安全设置")).toBeInTheDocument()
    // 顶栏常驻件:返回来源应用(会话 appHomeUrl)。
    expect(screen.getByText("返回应用")).toHaveAttribute("href", "https://appliket.example/")
  })
})
