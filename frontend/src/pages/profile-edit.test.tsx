import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createMemoryRouter, RouterProvider } from "react-router"
import { I18nProvider } from "@/lib/i18n"
import { i18nConfig } from "@/i18n/config"
import type { ReactNode } from "react"
import ProfileEditPage from "./profile-edit"
import { profileApi, ProfileRequestError } from "@/lib/profile-api"

vi.mock("@/lib/profile-api", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/profile-api")>()
  return { ...original, profileApi: { read: vi.fn(), patch: vi.fn(), uploadAvatar: vi.fn(), deleteAvatar: vi.fn(), createChallenge: vi.fn(), confirmContact: vi.fn(), deleteContact: vi.fn() } }
})
const saved = { displayName: "Alice", biography: "Original", hasAvatar: false, contactEmail: { address: null, state: "none" as const }, revision: '"0"' }
function Providers({ children }: { children: ReactNode }) {
  const router = createMemoryRouter([{ path: "/profile", element: children }, { path: "/", element: <p>Account overview destination</p> }], { initialEntries: ["/profile"] })
  return <I18nProvider config={i18nConfig}><RouterProvider router={router}/></I18nProvider>
}
beforeEach(() => { vi.mocked(profileApi.read).mockResolvedValue(saved) })
afterEach(() => { vi.resetAllMocks(); localStorage.setItem("panda.me.lang", "zh-CN") })

it("saves a draft with the loaded revision and shows server-confirmed success", async () => {
  vi.mocked(profileApi.patch).mockResolvedValue({ ...saved, displayName: "Updated" })
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  const name = await screen.findByLabelText("名称")
  await user.clear(name); await user.type(name, "Updated")
  await user.click(screen.getByRole("button", { name: "保存基本资料" }))
  await waitFor(() => expect(profileApi.patch).toHaveBeenCalledWith({ displayName: "Updated" }, '"0"'))
  expect(await screen.findByText("资料已保存")).toBeInTheDocument()
})

it("keeps the draft on conflict and offers explicit reread without automatic overwrite", async () => {
  vi.mocked(profileApi.patch).mockRejectedValue(new ProfileRequestError(412, "profile_revision_mismatch"))
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  const name = await screen.findByLabelText("名称")
  await user.clear(name); await user.type(name, "My draft")
  await user.click(screen.getByRole("button", { name: "保存基本资料" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("资料已在其他位置更新")
  expect(name).toHaveValue("My draft")
  expect(profileApi.patch).toHaveBeenCalledOnce()
  expect(screen.getByRole("button", { name: "重新读取资料" })).toBeInTheDocument()
})

it("shows unavailable without a misleading editable form when feature is closed", async () => {
  vi.mocked(profileApi.read).mockRejectedValue(new ProfileRequestError(404, "profile_unavailable"))
  render(<Providers><ProfileEditPage /></Providers>)
  expect(await screen.findByRole("alert")).toHaveTextContent("个人资料编辑暂不可用")
  expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
})

it("rejects oversized avatars before any API write", async () => {
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  const upload = await screen.findByLabelText("选择头像")
  await user.upload(upload, new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("头像须为 JPEG、PNG 或 WebP，且不超过 2 MiB")
  expect(profileApi.uploadAvatar).not.toHaveBeenCalled()
})

it("shows pending contact until manual confirmation succeeds", async () => {
  const pending = { ...saved, contactEmail: { address: "contact@example.invalid", state: "pending" as const } }
  vi.mocked(profileApi.createChallenge).mockResolvedValue({ profile: pending, challengeId: "fixture-challenge" })
  vi.mocked(profileApi.confirmContact).mockResolvedValue({ ...pending, contactEmail: { ...pending.contactEmail, state: "verified" } })
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  await user.type(await screen.findByLabelText("联系邮箱"), "contact@example.invalid")
  await user.click(screen.getByRole("button", { name: "发送验证邮件" }))
  expect(await screen.findByText("等待验证")).toBeInTheDocument()
  expect(screen.queryByText("已验证")).not.toBeInTheDocument()
  await user.type(screen.getByLabelText("邮件中的验证令牌"), "mail-only-token")
  await user.click(screen.getByRole("button", { name: "确认联系邮箱" }))
  expect(await screen.findByText("已验证")).toBeInTheDocument()
  expect(profileApi.confirmContact).toHaveBeenCalledWith("fixture-challenge", "mail-only-token")
})

it("clears the visible draft when the authenticated lifecycle pauses", async () => {
  const { meAuthLifecycle } = await import("@/lib/auth-lifecycle")
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  await user.type(await screen.findByLabelText("名称"), "private draft")
  const { act } = await import("@testing-library/react")
  act(() => meAuthLifecycle.pause(true))
  expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue(/private draft/)).not.toBeInTheDocument()
  act(() => meAuthLifecycle.pause(false))
})

it("keeps unsaved changes when leaving the page is declined", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  await user.type(await screen.findByLabelText("名称"), " private draft")
  await user.click(screen.getByRole("link", { name: "返回账户总览" }))
  expect(confirm).toHaveBeenCalledOnce()
  expect(screen.getByLabelText("名称")).toHaveValue("Alice private draft")
  expect(screen.queryByText("Account overview destination")).not.toBeInTheDocument()
  confirm.mockRestore()
})

it("does not discard a selected avatar when saving a separate contact email", async () => {
  vi.mocked(profileApi.createChallenge).mockResolvedValue({ profile: { ...saved, contactEmail: { address: "contact@example.invalid", state: "pending" } }, challengeId: "fixture" })
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  await user.upload(await screen.findByLabelText("选择头像"), new File(["fixture"], "avatar.png", { type: "image/png" }))
  await user.type(screen.getByLabelText("联系邮箱", { exact: true }), "contact@example.invalid")
  await user.click(screen.getByRole("button", { name: "发送验证邮件" }))
  expect(await screen.findByText("等待验证")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "上传头像" })).toBeEnabled()
})

it("requires a reread after an uncertain deletion before another write", async () => {
  vi.mocked(profileApi.read).mockResolvedValue({ ...saved, hasAvatar: true })
  vi.mocked(profileApi.deleteAvatar).mockRejectedValue(new TypeError("offline fixture"))
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  await user.click(await screen.findByRole("button", { name: "删除头像" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("操作结果未确认")
  expect(screen.getByRole("button", { name: "删除头像" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "重新读取资料" })).toBeEnabled()
  confirm.mockRestore()
})

it("reports a rejected contact token as invalid while retaining it for correction", async () => {
  vi.mocked(profileApi.createChallenge).mockResolvedValue({ profile: { ...saved, contactEmail: { address: "contact@example.invalid", state: "pending" } }, challengeId: "fixture" })
  vi.mocked(profileApi.confirmContact).mockRejectedValue(new ProfileRequestError(422, "contact_challenge_invalid"))
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  await user.type(await screen.findByLabelText("联系邮箱", { exact: true }), "contact@example.invalid")
  await user.click(screen.getByRole("button", { name: "发送验证邮件" }))
  await user.type(await screen.findByLabelText("邮件中的验证令牌"), "incorrect-token")
  await user.click(screen.getByRole("button", { name: "确认联系邮箱" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("验证令牌无效或已过期")
  expect(screen.getByLabelText("邮件中的验证令牌")).toHaveValue("incorrect-token")
  expect(profileApi.confirmContact).toHaveBeenCalledOnce()
})

it("renders the private editor and contact state in English", async () => {
  localStorage.setItem("panda.me.lang", "en")
  render(<Providers><ProfileEditPage /></Providers>)
  expect(await screen.findByLabelText("Name", { exact: true })).toHaveValue("Alice")
  expect(screen.getByRole("heading", { name: "Edit personal profile" })).toBeInTheDocument()
  expect(screen.getByText("Contact email not set")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Send verification email" })).toBeInTheDocument()
  expect(screen.queryByText("保存基本资料")).not.toBeInTheDocument()
})

it("can save a biography while the optional initial profile name is still unset", async () => {
  vi.mocked(profileApi.read).mockResolvedValue({ ...saved, displayName: null, biography: null })
  vi.mocked(profileApi.patch).mockResolvedValue({ ...saved, displayName: null, biography: "Biography only" })
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  await user.type(await screen.findByLabelText("简介"), "Biography only")
  await user.click(screen.getByRole("button", { name: "保存基本资料" }))
  await waitFor(() => expect(profileApi.patch).toHaveBeenCalledWith({ biography: "Biography only" }, '"0"'))
})
