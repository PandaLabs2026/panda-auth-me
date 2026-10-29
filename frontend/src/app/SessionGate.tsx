import { useMemo, type ReactNode } from "react"
import { useLocation } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import AuthBoundary from "@/components/patterns/auth/AuthBoundary"
import type { AuthAdapter } from "@/components/patterns/auth/types"
import { sessionApi, AuthResponseError, type Session } from "@/lib/auth"
import { meAuthLifecycle, meAuthNavigation } from "@/lib/auth-lifecycle"

/** One admission boundary outside the business shell; shared modules retain protected drafts. */
export function SessionGate({children}: {children: ReactNode}) {
  const client = useQueryClient(), location = useLocation()
  const adapter = useMemo<AuthAdapter<Session>>(() => ({
    session: signal => sessionApi.me(signal),
    status: error => error instanceof AuthResponseError ? error.status : 0,
    sameSession: (current, next) => current.subject === next.subject
      && JSON.stringify([...(current.roles ?? [])].sort()) === JSON.stringify([...(next.roles ?? [])].sort()),
    async logout() {await sessionApi.logout(); return {kind: "navigation"}},
    sessionChanged(session) {
      const previous = client.getQueryData<Session | null>(["session"])
      if (previous?.subject !== session?.subject) {
        void client.cancelQueries({predicate: query => query.queryKey[0] !== "session"})
        client.removeQueries({predicate: query => query.queryKey[0] !== "session"})
      }
      client.setQueryData(["session"], session ?? null)
    },
  }), [client])
  return <AuthBoundary adapter={adapter} lifecycle={meAuthLifecycle} navigation={meAuthNavigation}
    target={"/me" + (location.pathname === "/" ? "/" : location.pathname) + location.search}
    revalidateOnResume brand={<img src="/me/pandaauth-logo-horizontal.png" alt="PandaAuth by PandaLabs" className="h-9 w-auto max-w-full object-contain"/>}>
    {children}
  </AuthBoundary>
}
