import { afterEach, describe, expect, it, vi } from "vitest"
import { sessionApi } from "./auth"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("sessionApi", () => {
  it("treats only an unauthenticated response as an absent session", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))))
    await expect(sessionApi.me()).resolves.toBeNull()
  })

  it("rejects HTML at the JSON session boundary instead of assuming anonymous", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("<html>login</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }))))
    await expect(sessionApi.me()).rejects.toThrow()
  })

  it("surfaces session endpoint failures instead of redirecting as if the user were signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ status: 503, title: "Unavailable", detail: "会话检查暂不可用。" }),
      { status: 503, headers: { "content-type": "application/problem+json" } },
    ))))
    await expect(sessionApi.me()).rejects.toThrow("会话检查暂不可用。")
  })

  it("reports failed antiforgery admission without submitting a logout or navigating", async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {})
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({detail: "退出暂不可用"}), {status: 503, headers: {"content-type": "application/problem+json"}}))
    vi.stubGlobal("fetch", fetch)
    await expect(sessionApi.logout()).rejects.toThrow("退出暂不可用")
    expect(fetch).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()
  })

  it("submits one native CSRF form and lets the browser own the IdP logout chain", async () => {
    let submitted: {action: string; method: string; token: FormDataEntryValue | null} | undefined
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function(this: HTMLFormElement) {
      submitted = {action: this.getAttribute("action")!, method: this.method, token: new FormData(this).get("__RequestVerificationToken")}
    })
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({token: "fixture-csrf"}), {headers: {"content-type": "application/json"}}))
    vi.stubGlobal("fetch", fetch)
    await sessionApi.logout()
    expect(submitted).toEqual({action: "/me/api/logout", method: "post", token: "fixture-csrf"})
    expect(fetch).toHaveBeenCalledOnce()
    expect(document.querySelector('form[action="/me/api/logout"]')).toBeNull()
  })

  it("rejects missing CSRF tokens before any native submission", async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", {headers: {"content-type": "application/json"}})))
    await expect(sessionApi.logout()).rejects.toThrow("防伪")
    expect(submit).not.toHaveBeenCalled()
  })
})


describe("session payload boundary", () => {
  it.each([null, {}, {subject: "", roles: []}, {subject: "user", roles: "admin"}, {subject: "user", roles: [], name: 42}])("rejects malformed session %j without inferring authentication", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {headers: {"content-type": "application/json"}})))
    await expect(sessionApi.me()).rejects.toThrow()
  })
  it("keeps a valid session and optional nullable fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({subject: "user", name: null, nickname: null, email: null, roles: [], appHomeUrl: null}), {headers: {"content-type": "application/json"}})))
    await expect(sessionApi.me()).resolves.toMatchObject({subject: "user", displayName: "user", roles: []})
  })
})
