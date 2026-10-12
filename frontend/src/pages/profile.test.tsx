import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import ProfilePage from "@/pages/profile"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ProfilePage branding", () => {
  it("renders the horizontal PandaAuth lockup at the shared 36px height", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))

    render(<ProfilePage />)

    const logo = screen.getByRole("img", { name: "PandaAuth" })
    expect(logo).toHaveAttribute("src", "/me/pandaauth-logo-horizontal.png")
    expect(logo).toHaveClass("h-9", "w-auto", "object-contain")
    expect(screen.getByText("账户中心")).toBeInTheDocument()
  })
})
