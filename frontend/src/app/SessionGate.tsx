import { useI18n } from "@/lib/i18n"
import { Fragment, useLayoutEffect, useMemo, useRef, type ReactNode } from "react"
import { useLocation } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import AuthBoundary from "@/components/patterns/auth/AuthBoundary"
import { useAuthState } from "@/components/patterns/auth/context"
import type { AuthAdapter } from "@/components/patterns/auth/types"
import { sessionApi, AuthResponseError, type Session } from "@/lib/auth"
import { bindMfaSubject, meAuthLifecycle, meAuthNavigation } from "@/lib/auth-lifecycle"

/** One admission boundary outside the business shell; shared modules retain protected drafts. */
export function SessionGate({children}: {children: ReactNode}) {
  const { t } = useI18n()
  const client = useQueryClient(), location = useLocation()
  const adapter = useMemo<AuthAdapter<Session>>(() => ({
    session: signal => sessionApi.me(signal),
    status: error => error instanceof AuthResponseError ? error.status : 0,
    // subject + roles(集合比较,投影顺序不稳定不重挂)判定同会话;其余载荷
    // (邮箱/昵称/MFA 状态)漂移视为身份变化,作废重挂。
    sameSession: (current, next) => current.subject === next.subject
      && JSON.stringify([...(current.roles ?? [])].sort()) === JSON.stringify([...(next.roles ?? [])].sort()),
    async logout() {await sessionApi.logout(); return {kind: "navigation"}},
    sessionChanged(session) {
      bindMfaSubject(session?.subject)
      const previous = client.getQueryData<Session | null>(["session"])
      if (previous?.subject !== session?.subject) {
        void client.cancelQueries({predicate: query => query.queryKey[0] !== "session"})
        client.removeQueries({predicate: query => query.queryKey[0] !== "session"})
      }
      client.setQueryData(["session"], session ?? null)
    },
  }), [client])
  return <AuthBoundary translate={t} adapter={adapter} lifecycle={meAuthLifecycle} navigation={meAuthNavigation}
    target={"/me" + (location.pathname === "/" ? "/" : location.pathname) + location.search}
    revalidateOnResume recoveryPresentation="quiet" brand={<img src="/me/pandaauth-logo-horizontal.png" alt="PandaAuth by PandaLabs" className="h-9 w-auto max-w-full object-contain"/>}>
    <AccountContent>{children}</AccountContent>
  </AuthBoundary>
}

/** Retain drafts while admission is paused; remount all local/portaled state for a new verified actor. */
function AccountContent({children}: {children: ReactNode}) {
  const {session} = useAuthState()
  const owner = useRef<string | undefined>(undefined)
  const subject = (session as Session | undefined)?.subject
  useLayoutEffect(() => {if (subject) owner.current = subject}, [subject])
  return <Fragment key={subject ?? owner.current}>{children}</Fragment>
}
