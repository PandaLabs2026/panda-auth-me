import { useEffect, useRef, useState } from "react"
import { useLocation, useSearchParams } from "react-router"
import { Button } from "@/components/ui/button"
import AuthStatusPage from "@/components/patterns/auth/AuthStatusPage"
import { meAuthNavigation } from "@/lib/auth-lifecycle"

/** Presentation bridge only; the BFF validates the final business return target. */
export default function LoginPage() {
  const [params] = useSearchParams(), location = useLocation()
  const from = (location.state as {from?: unknown} | null)?.from
  const target = params.get("returnUrl") ?? (typeof from === "string" && from.startsWith("/")
    ? from.startsWith("/me/") ? from : "/me" + from : meAuthNavigation.home)
  const failed = params.has("error") || params.getAll("returnUrl").length > 1
  const [leaving, setLeaving] = useState(false), [blocked, setBlocked] = useState(failed)
  const attempted = useRef(false)
  useEffect(() => {
    if (attempted.current || failed) return
    attempted.current = true
    const started = meAuthNavigation.start(target)
    setLeaving(started); setBlocked(!started)
  }, [target, failed])
  return <AuthStatusPage brand={<img src="/me/pandaauth-logo-horizontal.png" alt="PandaAuth by PandaLabs" className="h-9 w-auto max-w-full object-contain"/>}
    title={blocked || failed ? "登录未完成" : "正在前往登录…"}
    description={blocked || failed ? "本次登录未完成，请明确选择后续操作。" : "正在前往统一身份认证，如未跳转请使用下方链接。"} busy={leaving}>
    <Button asChild><a href={meAuthNavigation.href(target)} onClick={event => {
      event.preventDefault(); setLeaving(meAuthNavigation.start(target, true))
    }}>继续登录</a></Button>
  </AuthStatusPage>
}
