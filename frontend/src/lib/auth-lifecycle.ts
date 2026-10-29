import { createAuthLifecycle } from "@/components/patterns/auth/lifecycle"
import { createAuthNavigation } from "@/components/patterns/auth/navigation"
export const meAuthLifecycle = createAuthLifecycle()
export const meAuthNavigation = createAuthNavigation({key: "panda.me.auth", loginPath: "/me/login", home: "/me/"})
let uncertain = false
export function markOperationUncertain() {
  if (uncertain) return
  uncertain = true
  meAuthLifecycle.protect("结果待核实的账户安全操作")
}
