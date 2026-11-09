import { afterEach, beforeEach, expect, it, vi } from "vitest"

const profile = { displayName: "Alice", biography: null, hasAvatar: false, contactEmail: { address: null, state: "none" }, revision: "\"0\"" }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
beforeEach(() => vi.resetModules())
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it("sends revision and CSRF only to the same-origin BFF without bearer tokens", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ token: "csrf" })).mockResolvedValueOnce(json(profile))
  vi.stubGlobal("fetch", fetch)
  const { profileApi } = await import("./profile-api")
  expect(await profileApi.patch({ biography: "Hello" }, '"0"')).toEqual(profile)
  expect(fetch.mock.calls[1][0]).toBe("/me/api/profile")
  const init = fetch.mock.calls[1][1] as RequestInit
  const headers = new Headers(init.headers)
  expect(init.method).toBe("PATCH")
  expect(headers.get("If-Match")).toBe('"0"')
  expect(headers.get("X-XSRF-Token")).toBe("csrf")
  expect(headers.has("Authorization")).toBe(false)
  expect(JSON.parse(init.body as string)).toEqual({ biography: "Hello" })
})

it("preserves revision conflict and never retries writes", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ token: "csrf" })).mockResolvedValueOnce(json({ code: "profile_revision_mismatch" }, 412))
  vi.stubGlobal("fetch", fetch)
  const { profileApi } = await import("./profile-api")
  await expect(profileApi.patch({ displayName: "Alice" }, '"old"')).rejects.toMatchObject({ status: 412, code: "profile_revision_mismatch" })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it("rejects malformed successful profile responses at the browser boundary", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...profile, revision: null })))
  const { profileApi } = await import("./profile-api")
  await expect(profileApi.read()).rejects.toMatchObject({ code: "profile_response_invalid" })
})

it("discards late reads after identity lifecycle changes even if transport ignores abort", async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve })))
  const { profileApi } = await import("./profile-api")
  const { meAuthLifecycle } = await import("./auth-lifecycle")
  const outcome = expect(profileApi.read()).rejects.toMatchObject({ code: "profile_identity_changed" })
  meAuthLifecycle.pause(true)
  finish(json(profile))
  await outcome
})

it("does not dispatch a mutation after identity changes during CSRF admission", async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal("fetch", fetch)
  const { profileApi } = await import("./profile-api")
  const { meAuthLifecycle } = await import("./auth-lifecycle")
  const outcome = expect(profileApi.deleteContact('"0"')).rejects.toMatchObject({ code: "profile_identity_changed" })
  meAuthLifecycle.pause(true)
  finish(json({ token: "csrf" }))
  await outcome
  expect(fetch).toHaveBeenCalledOnce()
})

it("uploads the raw avatar with its media type and returns only the validated profile", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(json({ token: "csrf" })).mockResolvedValueOnce(json({ ...profile, hasAvatar: true }))
  vi.stubGlobal("fetch", fetch)
  const { profileApi } = await import("./profile-api")
  const file = new File(["image fixture"], "avatar.png", { type: "image/png" })
  expect((await profileApi.uploadAvatar(file, '"0"')).hasAvatar).toBe(true)
  expect(fetch.mock.calls[1][0]).toBe("/me/api/profile/avatar")
  const init = fetch.mock.calls[1][1] as RequestInit
  expect(init.body).toBe(file)
  expect(new Headers(init.headers).get("Content-Type")).toBe("image/png")
})

it("keeps confirmation separate from challenge delivery without storing token in a URL", async () => {
  const challengeId = "12345678-1234-1234-1234-123456789abc"
  const pending = { ...profile, contactEmail: { address: "contact@example.invalid", state: "pending" } }
  const fetch = vi.fn().mockResolvedValueOnce(json({ token: "csrf" })).mockResolvedValueOnce(json({ profile: pending, challengeId }))
    .mockResolvedValueOnce(json({ token: "csrf" })).mockResolvedValueOnce(json({ ...pending, contactEmail: { ...pending.contactEmail, state: "verified" } }))
  vi.stubGlobal("fetch", fetch)
  const { profileApi } = await import("./profile-api")
  expect((await profileApi.createChallenge("contact@example.invalid", '"0"')).profile.contactEmail.state).toBe("pending")
  expect((await profileApi.confirmContact(challengeId, "mail-only-token")).contactEmail.state).toBe("verified")
  expect(fetch.mock.calls[3][0]).toBe("/me/api/profile/contact-email/confirmation")
  expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ challengeId, token: "mail-only-token" })
})
