import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, useEffect, useSyncExternalStore } from "react"
import { useSession } from "./auth"
import { meAuthLifecycle } from "./auth-lifecycle"
import { profileApi, type SelfProfile } from "./profile-api"

interface ProfilePresentation {
  displayName?: string | null
  avatarUrl?: string
  loginEmail?: string
  confirmProfile?: (profile: SelfProfile) => void
}

export const ProfilePresentationContext = createContext<ProfilePresentation>({})

export function useProfilePresentation(): ProfilePresentation {
  const { data: session } = useSession()
  const client = useQueryClient()
  const paused = useSyncExternalStore(meAuthLifecycle.subscribe, meAuthLifecycle.paused)
  const scope = session?.subject
  const origin = window.location.origin
  const ready = Boolean(scope && session?.profileEditingEnabled && !paused)
  const key = ["self-profile", origin, scope]
  const { data } = useQuery({
    queryKey: key,
    queryFn: profileApi.read,
    enabled: ready,
    retry: false,
    staleTime: 30_000,
  })
  const profile = ready ? data : undefined
  const revision = profile?.hasAvatar ? profile.revision : undefined
  const { data: avatarUrl } = useQuery({
    queryKey: [...key, "avatar", revision],
    enabled: Boolean(ready && revision),
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch("/me/api/profile/avatar", {
        credentials: "same-origin", cache: "no-store", redirect: "error", signal,
      })
      if (!response.ok || response.headers.get("Content-Type")?.split(";")[0] !== "image/png") return ""
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > 256 * 1024 || signal.aborted) return ""
      let binary = ""
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return "data:image/png;base64," + btoa(binary)
    },
  })

  useEffect(() => {
    if (!paused && session?.profileEditingEnabled) return
    const filter = { queryKey: ["self-profile", origin] }
    void client.cancelQueries(filter)
    client.removeQueries(filter)
  }, [client, origin, paused, session?.profileEditingEnabled])

  return {
    displayName: ready ? profile?.displayName ?? null : undefined,
    loginEmail: !paused ? session?.email : undefined,
    avatarUrl: ready && revision ? avatarUrl || undefined : undefined,
    confirmProfile: next => {
      if (!ready || meAuthLifecycle.paused()) return
      void client.cancelQueries({ queryKey: key, exact: true })
      client.setQueryData(key, next)
    },
  }
}
