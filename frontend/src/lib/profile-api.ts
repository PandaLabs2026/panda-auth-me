import { meAuthLifecycle } from "./auth-lifecycle"
import { handleUnauthorized } from "./auth"
import { fetchWithTimeout } from "./fetch-with-timeout"

export interface SelfProfile {
  displayName: string | null
  biography: string | null
  hasAvatar: boolean
  contactEmail: { address: string | null; state: "none" | "pending" | "verified" }
  revision: string
}
export class ProfileRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
function active(epoch: number) {
  if (meAuthLifecycle.paused() || epoch !== meAuthLifecycle.epoch()) throw new ProfileRequestError(0, "profile_identity_changed")
}
function selfProfile(value: unknown): SelfProfile {
  if (!value || typeof value !== "object") throw new ProfileRequestError(0, "profile_response_invalid")
  const p = value as Record<string, unknown>
  const contact = p.contactEmail as Record<string, unknown> | null
  if (!(p.displayName === null || typeof p.displayName === "string")
    || !(p.biography === null || typeof p.biography === "string") || typeof p.hasAvatar !== "boolean"
    || typeof p.revision !== "string" || !/^"(?:0|[a-f0-9]{32})"$/.test(p.revision)
    || !contact || !["none", "pending", "verified"].includes(String(contact.state))
    || !(contact.address === null || typeof contact.address === "string")
    || (contact.state === "none" ? contact.address !== null : typeof contact.address !== "string")) {
    throw new ProfileRequestError(0, "profile_response_invalid")
  }
  return value as SelfProfile
}

async function request(path: string, init: RequestInit, epoch: number): Promise<unknown> {
  active(epoch)
  const controller = new AbortController()
  const unsubscribe = meAuthLifecycle.subscribe(() => {
    if (meAuthLifecycle.paused() || epoch !== meAuthLifecycle.epoch()) controller.abort()
  })
  try {
    return await fetchWithTimeout(path, { ...init, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal }, async response => {
      active(epoch)
      if (response.status === 401) { handleUnauthorized(); throw new ProfileRequestError(401, "profile_identity_invalid") }
      if (!/^application\/json(?:;|$)/i.test(response.headers.get("Content-Type") ?? ""))
        throw new ProfileRequestError(response.ok ? 0 : response.status, "profile_response_invalid")
      const value: unknown = await response.json()
      active(epoch)
      if (!response.ok) {
        const code = value && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : "profile_request_failed"
        throw new ProfileRequestError(response.status, code)
      }
      return value
    })
  } catch (error) {
    active(epoch)
    throw error
  } finally { unsubscribe() }
}
async function write(path: string, method: string, revision: string | undefined, body?: unknown): Promise<unknown> {
  const epoch = meAuthLifecycle.epoch()
  const token = await request("/me/api/antiforgery", {}, epoch)
  active(epoch)
  if (!token || typeof token !== "object" || !("token" in token) || typeof token.token !== "string" || !token.token)
    throw new ProfileRequestError(0, "profile_response_invalid")
  const headers = new Headers({ "Content-Type": body instanceof Blob ? body.type : "application/json", "X-XSRF-Token": token.token })
  if (revision !== undefined) headers.set("If-Match", revision)
  return request(path, { method, headers, body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body) }, epoch)
}
export const profileApi = {
  read: async (): Promise<SelfProfile> => selfProfile(await request("/me/api/profile", {}, meAuthLifecycle.epoch())),
  patch: async (patch: { displayName?: string; biography?: string | null }, revision: string) => selfProfile(await write("/me/api/profile", "PATCH", revision, patch)),
  deleteContact: async (revision: string) => selfProfile(await write("/me/api/profile/contact-email", "DELETE", revision)),
  uploadAvatar: async (file: File, revision: string) => selfProfile(await write("/me/api/profile/avatar", "PUT", revision, file)),
  deleteAvatar: async (revision: string) => selfProfile(await write("/me/api/profile/avatar", "DELETE", revision)),
  createChallenge: async (address: string, revision: string): Promise<{ profile: SelfProfile; challengeId: string }> => {
    const value = await write("/me/api/profile/contact-email/challenges", "POST", revision, { address })
    if (!value || typeof value !== "object" || !("profile" in value) || !("challengeId" in value)
      || typeof value.challengeId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.challengeId))
      throw new ProfileRequestError(0, "profile_response_invalid")
    return { profile: selfProfile(value.profile), challengeId: value.challengeId }
  },
  confirmContact: async (challengeId: string, token: string) => selfProfile(await write("/me/api/profile/contact-email/confirmation", "POST", undefined, { challengeId, token })),
}
