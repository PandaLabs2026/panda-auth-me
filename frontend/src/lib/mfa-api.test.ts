import { afterEach, beforeEach, expect, it, vi } from "vitest"
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {"content-type": "application/json"}})
const assign = vi.fn()
beforeEach(() => {
 vi.resetModules(); assign.mockReset()
 const original = window
 vi.stubGlobal("window", {location: {origin: "https://me.example", href: "https://me.example/me/security", pathname: "/me/security", search: "", assign}, setTimeout: original.setTimeout.bind(original), clearTimeout: original.clearTimeout.bind(original)})
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
async function runtime() {return {api: await import("./mfa-api"), lifecycle: await import("./auth-lifecycle")}}
it("signals one merged session check for an MFA 401 without navigating", async () => {
 const {api, lifecycle} = await runtime(); const unauthorized = vi.spyOn(lifecycle.meAuthLifecycle, "unauthorized")
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 401)))
 await expect(api.mfaApi.status()).rejects.toMatchObject({status: 401})
 expect(unauthorized).toHaveBeenCalledOnce(); expect(assign).not.toHaveBeenCalled()
})
it("keeps a non-JSON 503 as a service failure instead of logging in", async () => {
 const {api, lifecycle} = await runtime(); const unauthorized = vi.spyOn(lifecycle.meAuthLifecycle, "unauthorized")
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", {status: 503, headers: {"content-type": "text/html"}})))
 await expect(api.mfaApi.status()).rejects.toMatchObject({status: 503})
 expect(assign).not.toHaveBeenCalled(); expect(unauthorized).not.toHaveBeenCalled()
})
it("recognizes a same-origin identity login redirect but does not follow it with another navigation", async () => {
 const {api, lifecycle} = await runtime(); const unauthorized = vi.spyOn(lifecycle.meAuthLifecycle, "unauthorized")
 const response = new Response("<html>login</html>", {headers: {"content-type": "text/html"}})
 Object.defineProperties(response, {redirected: {value: true}, url: {value: "https://me.example/account/login"}})
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))
 await expect(api.mfaApi.status()).rejects.toMatchObject({status: 401})
 expect(unauthorized).toHaveBeenCalledOnce(); expect(assign).not.toHaveBeenCalled()
})
it("rejects unrecognized HTML without inferring an expired identity", async () => {
 const {api, lifecycle} = await runtime(); const unauthorized = vi.spyOn(lifecycle.meAuthLifecycle, "unauthorized")
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>unexpected</html>", {headers: {"content-type": "text/html"}})))
 await expect(api.mfaApi.status()).rejects.toMatchObject({status: 0})
 expect(assign).not.toHaveBeenCalled(); expect(unauthorized).not.toHaveBeenCalled()
})
it("drops a late read when the transport ignores cancellation", async () => {
 const {api, lifecycle} = await runtime(); let finish!: (response: Response) => void
 vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => {finish = resolve})))
 const outcome = expect(api.mfaApi.factors()).rejects.toMatchObject({name: "StaleMfaResponseError"})
 lifecycle.meAuthLifecycle.pause(true); finish(json([{id: "old-factor"}]))
 await outcome
})
it("does not even fetch antiforgery admission while paused", async () => {
 const {api, lifecycle} = await runtime(); lifecycle.meAuthLifecycle.pause(true)
 const fetch = vi.fn().mockResolvedValue(json({token: "fixture"})); vi.stubGlobal("fetch", fetch)
 await expect(api.mfaApi.totpConfirm("factor", "123456")).rejects.toMatchObject({name: "StaleMfaResponseError"})
 expect(fetch).not.toHaveBeenCalled()
})
it("does not dispatch a write when the epoch changes during antiforgery lookup", async () => {
 const {api, lifecycle} = await runtime(); let finish!: (response: Response) => void
 const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => {finish = resolve})).mockResolvedValue(json({status: "ok"})); vi.stubGlobal("fetch", fetch)
 const outcome = expect(api.mfaApi.totpConfirm("factor", "123456")).rejects.toMatchObject({name: "StaleMfaResponseError"})
 lifecycle.meAuthLifecycle.pause(true); lifecycle.meAuthLifecycle.pause(false); finish(json({token: "fixture"}))
 await outcome; expect(fetch).toHaveBeenCalledOnce()
})
it("retains an uncertain write warning after a network failure without replay", async () => {
 const {api, lifecycle} = await runtime()
 const fetch = vi.fn().mockResolvedValueOnce(json({token: "fixture"})).mockRejectedValueOnce(new TypeError("fixture offline")); vi.stubGlobal("fetch", fetch)
 await expect(api.mfaApi.totpConfirm("factor", "123456")).rejects.toThrow()
 expect(lifecycle.meAuthLifecycle.reasons().join()).toMatch(/结果待核实/)
 expect(fetch).toHaveBeenCalledTimes(2)
})
it("protects in-flight writes and keeps an unknown result after cancellation", async () => {
 const {api, lifecycle} = await runtime(); let finish!: (response: Response) => void
 const fetch = vi.fn().mockResolvedValueOnce(json({token: "fixture"})).mockImplementationOnce(() => new Promise<Response>(resolve => {finish = resolve})); vi.stubGlobal("fetch", fetch)
 const outcome = expect(api.mfaApi.totpConfirm("factor", "123456")).rejects.toMatchObject({name: "StaleMfaResponseError"})
 await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
 const inFlightReasons = lifecycle.meAuthLifecycle.reasons().join()
 lifecycle.meAuthLifecycle.pause(true); finish(json({status: "ok"})); await outcome
 expect(inFlightReasons).toMatch(/进行中/)
 expect(lifecycle.meAuthLifecycle.reasons().join()).toMatch(/结果待核实/)
 expect(fetch).toHaveBeenCalledTimes(2)
})
it("preserves the existing confirmed 403 operation-grant signal", async () => {
 const {api, lifecycle} = await runtime()
 vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({token: "fixture"})).mockResolvedValueOnce(json({mfaGrantRequired: true, operation: "self.totp-enroll", targetId: "user", parameters: {}, passwordRequired: true}, 403)))
 await expect(api.mfaApi.totpOptions()).rejects.toBeInstanceOf(api.GrantRequiredError)
 expect(lifecycle.meAuthLifecycle.reasons()).toEqual([])
})
it("does not turn a 503 body into an operation-grant challenge", async () => {
 const {api} = await runtime()
 vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({token: "fixture"})).mockResolvedValueOnce(json({mfaGrantRequired: true, operation: "self.totp-enroll", targetId: "user", parameters: {}, passwordRequired: true}, 503)))
 await expect(api.mfaApi.totpOptions()).rejects.toMatchObject({status: 503})
})
it("releases a confirmed write and preserves the original CSRF protocol", async () => {
 const {api, lifecycle} = await runtime(); const fetch = vi.fn().mockResolvedValueOnce(json({token: "fixture"})).mockResolvedValueOnce(json({status: "ok"})); vi.stubGlobal("fetch", fetch)
 await expect(api.mfaApi.totpConfirm("factor", "123456")).resolves.toEqual({status: "ok"})
 expect(lifecycle.meAuthLifecycle.reasons()).toEqual([])
 expect(fetch.mock.calls[1]?.[1]).toMatchObject({method: "POST", headers: {RequestVerificationToken: "fixture"}})
})

it("does not attach a late previous-actor write warning to a newly verified actor", async () => {
 const {api, lifecycle} = await runtime(); lifecycle.bindMfaSubject("actor-a")
 let finish!: (response: Response) => void
 const fetch = vi.fn().mockResolvedValueOnce(json({token: "fixture"})).mockImplementationOnce(() => new Promise<Response>(resolve => {finish = resolve})); vi.stubGlobal("fetch", fetch)
 const outcome = expect(api.mfaApi.totpConfirm("factor-a", "123456")).rejects.toMatchObject({name: "StaleMfaResponseError"})
 await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
 lifecycle.meAuthLifecycle.pause(true); lifecycle.bindMfaSubject("actor-b"); lifecycle.meAuthLifecycle.pause(false)
 finish(json({status: "ok"})); await outcome
 expect(lifecycle.meAuthLifecycle.reasons().join()).not.toMatch(/结果待核实/)
})
it("retains unknown-result protection when identity is absent or the same actor rechecks", async () => {
 const {api, lifecycle} = await runtime(); lifecycle.bindMfaSubject("actor-a")
 vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({token: "fixture"})).mockRejectedValueOnce(new TypeError("fixture offline")))
 await expect(api.mfaApi.totpConfirm("factor-a", "123456")).rejects.toThrow()
 lifecycle.bindMfaSubject(undefined); lifecycle.bindMfaSubject("actor-a")
 expect(lifecycle.meAuthLifecycle.reasons().join()).toMatch(/结果待核实/)
 lifecycle.bindMfaSubject("actor-b")
 expect(lifecycle.meAuthLifecycle.reasons().join()).not.toMatch(/结果待核实/)
})
