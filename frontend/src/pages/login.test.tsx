import { StrictMode } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Providers } from "@/test/utils"
import { afterEach, expect, it, vi } from "vitest"
import LoginPage from "./login"
const start = vi.hoisted(() => vi.fn(() => false))
vi.mock("@/lib/auth-lifecycle", () => ({meAuthNavigation: {start, home: "/me/", href: (target: string) => "/me/login?returnUrl=" + encodeURIComponent(target)}}))
afterEach(() => {vi.clearAllMocks()})
function page(url: string) {render(<StrictMode><Providers initialEntries={[url]}><LoginPage /></Providers></StrictMode>)}
it("attempts automatic login once and retains a usable manual continuation when blocked", async () => {
 page("/sign-in?returnUrl=%2Fme%2Fsecurity%3Ftab%3Dtotp")
 expect(await screen.findByRole("heading", {name: "登录未完成"})).toBeInTheDocument()
 expect(start).toHaveBeenCalledTimes(1)
 expect(start).toHaveBeenCalledWith("/me/security?tab=totp")
 await userEvent.click(screen.getByRole("link", {name: "继续登录"}))
 expect(start).toHaveBeenLastCalledWith("/me/security?tab=totp", true)
})
it("does not automatically replay cancelled or failed authentication", async () => {
 page("/sign-in?error=cancelled")
 expect(await screen.findByRole("heading", {name: "登录未完成"})).toBeInTheDocument()
 expect(start).not.toHaveBeenCalled()
})
