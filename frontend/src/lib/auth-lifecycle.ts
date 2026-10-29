import { createAuthLifecycle } from "@/components/patterns/auth/lifecycle"
import { createAuthNavigation } from "@/components/patterns/auth/navigation"
export const meAuthLifecycle = createAuthLifecycle()
export const meAuthNavigation = createAuthNavigation({key: "panda.me.auth", loginPath: "/me/login", home: "/me/"})
let uncertain = false
let releaseUncertain: (() => void) | undefined
let subject: string | undefined
export function markOperationUncertain(owner = subject) {
  if (owner !== subject || uncertain) return
  uncertain = true
  releaseUncertain = meAuthLifecycle.protect("结果待核实的账户安全操作")
}

export const hasUncertainOperation = () => uncertain
/** Only a newly verified different subject retires the previous actor's presentation warning. */
export function bindMfaSubject(next: string | undefined) {
  if (!next) return
  if (subject && subject !== next) {
    uncertain = false
    releaseUncertain?.(); releaseUncertain = undefined
  }
  subject = next
}

export const currentMfaSubject = () => subject
