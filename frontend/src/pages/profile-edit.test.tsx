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

it.each([
  {
    editedField: "名称", draft: "My display name", patch: { displayName: "My display name" },
    untouchedField: "简介", latestValue: "Bio saved elsewhere", serverChange: { biography: "Bio saved elsewhere" },
  },
  {
    editedField: "简介", draft: "My bio", patch: { biography: "My bio" },
    untouchedField: "名称", latestValue: "Name saved elsewhere", serverChange: { displayName: "Name saved elsewhere" },
  },
])("uses the latest untouched field after rereading a conflict on $editedField", async ({
  editedField, draft, patch, untouchedField, latestValue, serverChange,
}) => {
  const latest = { ...saved, ...serverChange, revision: '"1"' }
  vi.mocked(profileApi.read).mockResolvedValueOnce(saved).mockResolvedValueOnce(latest)
  vi.mocked(profileApi.patch)
    .mockRejectedValueOnce(new ProfileRequestError(412, "profile_revision_mismatch"))
    .mockResolvedValueOnce({ ...latest, ...patch, revision: '"2"' })
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)

  const input = await screen.findByLabelText(editedField)
  await user.clear(input)
  await user.type(input, draft)
  await user.click(screen.getByRole("button", { name: "保存基本资料" }))
  await screen.findByRole("alert")
  await user.click(screen.getByRole("button", { name: "重新读取资料" }))

  await waitFor(() => expect(screen.getByLabelText(untouchedField)).toHaveValue(latestValue))
  expect(input).toHaveValue(draft)
  expect(profileApi.patch).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole("button", { name: "保存基本资料" }))
  await screen.findByText("资料已保存")
  expect(profileApi.patch).toHaveBeenNthCalledWith(2, patch, '"1"')
})

it("shows unavailable without a misleading editable form when feature is closed", async () => {
  vi.mocked(profileApi.read).mockRejectedValue(new ProfileRequestError(404, "profile_unavailable"))
  render(<Providers><ProfileEditPage /></Providers>)
  expect(await screen.findByRole("alert")).toHaveTextContent("个人资料编辑暂不可用")
  expect(screen.queryByLabelText("名称")).not.toBeInTheDocument()
})

it("resumes a delivered verification without sending a replacement email", async () => {
  const pending = { ...saved, contactEmail: { address: "contact@example.invalid", state: "pending" as const,
    pendingVerification: { challengeId: "resumed-challenge", expiresAt: "2099-01-01T00:00:00Z" } } }
  vi.mocked(profileApi.read).mockResolvedValue(pending)
  vi.mocked(profileApi.confirmContact).mockResolvedValue({ ...saved,
    contactEmail: { address: "contact@example.invalid", state: "verified" } })
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  await user.type(await screen.findByLabelText("邮件中的验证令牌"), "mail-only")
  await user.click(screen.getByRole("button", { name: "确认联系邮箱" }))
  expect(await screen.findByText("已验证")).toBeInTheDocument()
  expect(profileApi.confirmContact).toHaveBeenCalledWith("resumed-challenge", "mail-only")
  expect(profileApi.createChallenge).not.toHaveBeenCalled()
})

it("requires a choice before replacing a field changed on another device", async () => {
  const latest = { ...saved, displayName: "Latest name", revision: '"1"' }
  vi.mocked(profileApi.read).mockResolvedValueOnce(saved).mockResolvedValueOnce(latest)
  vi.mocked(profileApi.patch)
    .mockRejectedValueOnce(new ProfileRequestError(412, "profile_revision_mismatch"))
    .mockResolvedValueOnce({ ...latest, displayName: "My draft", revision: '"2"' })
  const user = userEvent.setup()
  render(<Providers><ProfileEditPage /></Providers>)
  const name = await screen.findByLabelText("名称")
  await user.clear(name)
  await user.type(name, "My draft")
  const save = screen.getByRole("button", { name: "保存基本资料" })
  await user.click(save)
  await screen.findByRole("alert")
  await user.click(screen.getByRole("button", { name: "重新读取资料" }))
  expect(await screen.findByText("Latest name")).toBeInTheDocument()
  expect(save).toBeDisabled()
  await user.click(screen.getByRole("button", { name: "保留我的修改" }))
  await user.click(save)
  await screen.findByText("资料已保存")
  expect(profileApi.patch).toHaveBeenNthCalledWith(2, { displayName: "My draft" }, '"1"')
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
  expect(screen.getByRole("heading", { name: "Profile" })).toBeVisible()
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
