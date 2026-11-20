import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react"
import { useBlocker } from "react-router"
import ContextPanel from "@/components/patterns/ContextPanel"
import { useBrowserUnloadGuard, usePanelCloseGuard } from "@/components/patterns/context-panel-guard"
import { useAuthLeaveGuard } from "@/components/patterns/auth/context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { markOperationUncertain, meAuthLifecycle, meAuthNavigation } from "@/lib/auth-lifecycle"
import { fetchWithTimeout } from "@/lib/fetch-with-timeout"
import { useI18n } from "@/lib/i18n"

const startPath = "/account/change-email"
const confirmPath = "/account/confirm-email-change"
const securityPath = "/me/security"
const jsonHeaders = { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
const requestOptions = { credentials: "same-origin", cache: "no-store", redirect: "error" } as const
const messages: Record<string, string> = {
  email_unconfirmed: "请先确认当前邮箱。",
  password_invalid: "当前密码不正确。",
  email_unavailable: "无法变更邮箱，请检查目标地址。",
  token_invalid: "验证令牌错误、已使用或已过期。",
}

export default function LoginEmailPanel({ subject, trigger, onClose }: {
  subject: string
  trigger: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const { t } = useI18n()
  const [step, setStep] = useState<"email" | "verify" | "done" | "reauthenticate">("email")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [token, setToken] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const request = useRef<AbortController | null>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const tokenInput = useRef<HTMLInputElement>(null)
  const relogin = useRef<HTMLButtonElement>(null)
  const formId = "change-login-email"
  const dirty = step === "verify" || Boolean(email || password || token)

  const blocker = useBlocker(dirty || saving)
  const guard = usePanelCloseGuard({
    dirty, saving,
    onClose: () => {
      if (blocker.state === "blocked") blocker.proceed()
      onClose()
    },
    onContinue: () => { if (blocker.state === "blocked") blocker.reset() },
    onReject: () => { if (blocker.state === "blocked") blocker.reset() },
  })
  const { requestClose } = guard
  useEffect(() => {
    if (blocker.state === "blocked") requestClose("route-change")
  }, [blocker.state, requestClose])
  useBrowserUnloadGuard(dirty || saving)
  useAuthLeaveGuard(dirty || saving, "未完成的登录邮箱变更")

  useEffect(() => {
    if (step === "email") emailInput.current?.focus()
    if (step === "verify") tokenInput.current?.focus()
    if (step === "done" || step === "reauthenticate") relogin.current?.focus()
  }, [step])

  useEffect(() => {
    const retire = () => { request.current?.abort(); request.current = null }
    const off = meAuthLifecycle.subscribe(() => {
      if (!meAuthLifecycle.paused()) return
      retire()
      onClose()
    })
    return () => { retire(); off() }
  }, [onClose])

  function requireLogin(message: string) {
    setEmail(""); setPassword(""); setToken("")
    setError(message)
    setStep("reauthenticate")
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current || meAuthLifecycle.paused() || (step !== "email" && step !== "verify")) return
    const controller = new AbortController()
    const current = () => request.current === controller && !meAuthLifecycle.paused()
    request.current = controller
    const init = { ...requestOptions, signal: controller.signal }
    let posted = false
    setSaving(true); setError("")
    try {
      const csrf = await fetchWithTimeout(startPath, { ...init, headers: jsonHeaders }, async response => {
        if (response.status === 401 || response.status === 403) return null
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
          throw new Error("登录邮箱编辑暂不可用，请稍后重试。")
        const result: { token?: unknown } = await response.json()
        if (typeof result.token !== "string" || !result.token) throw new Error("登录邮箱编辑暂不可用，请稍后重试。")
        return result.token
      })
      if (!current()) return
      if (!csrf) {
        requireLogin("登录状态已变化，请重新登录后继续。")
        return
      }
      const body = new URLSearchParams({ NewEmail: email.trim() })
      if (step === "email") body.set("CurrentPassword", password)
      else body.set("Token", token.trim())
      setPassword("")
      posted = true
      await fetchWithTimeout(step === "email" ? startPath : confirmPath, {
        ...init, method: "POST", body,
        headers: { ...jsonHeaders, RequestVerificationToken: csrf, "X-Panda-Account-Subject": subject },
      }, async response => {
        if (!current()) return
        if (response.status === 204) {
          if (step === "email") setStep("verify")
          else { setEmail(""); setToken(""); setStep("done") }
          return
        }
        if (response.status === 401 || response.status === 403 || response.status === 409) {
          requireLogin("登录状态已变化，请重新登录后继续。")
          return
        }
        if (response.status === 400) {
          const result: { error?: unknown } | null = await response.json().catch(() => null)
          const code = result?.error
          if (current()) setError(typeof code === "string" && Object.hasOwn(messages, code)
            ? messages[code] : "请求未获接受，请检查输入后重试。")
          return
        }
        if (response.status === 429) {
          setError("操作过于频繁，请稍后重试")
          return
        }
        throw new Error("登录邮箱编辑暂不可用，请稍后重试。")
      })
    } catch {
      if (posted) markOperationUncertain(subject)
      if (!current()) return
      if (posted) requireLogin("操作结果待核实，请重新登录后查看当前登录邮箱。")
      else setError("登录邮箱编辑暂不可用，请稍后重试。")
    } finally {
      if (current()) {
        request.current = null
        setSaving(false)
      }
    }
  }

  return <ContextPanel open guard={guard} title={t("更换登录邮箱")}
    description={t("验证当前密码和新登录邮箱。")}
    mode="edit" status={saving ? "saving" : error ? "error" : "ready"} returnFocusRef={trigger}
    footer={step === "done" || step === "reauthenticate" ?
      <Button ref={relogin} onClick={() => meAuthNavigation.start(securityPath, true)}>{t("重新登录")}</Button> :
      <>
        <Button type="button" variant="outline" disabled={saving} onClick={() => guard.requestClose()}>{t("取消")}</Button>
        <Button type="submit" form={formId} disabled={saving}>
          {t(step === "email" ? "发送验证邮件" : "确认更换")}
        </Button>
      </>}>
    {step === "done" && <p role="status">{t("登录邮箱已更换。请重新登录。")}</p>}
    {(step === "email" || step === "verify") && <form id={formId} onSubmit={submit} className="grid gap-4">
      {step === "email" ? <>
        <div className="grid gap-2">
          <Label htmlFor="new-login-email">{t("新登录邮箱")}</Label>
          <Input ref={emailInput} id="new-login-email" type="email" autoComplete="email" required maxLength={256} value={email}
            disabled={saving} onChange={event => setEmail(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="change-email-password">{t("当前密码")}</Label>
          <Input id="change-email-password" type="password" autoComplete="current-password" required value={password}
            disabled={saving} onChange={event => setPassword(event.target.value)} />
        </div>
      </> : <>
        <p className="break-all text-sm">{t("请输入发往 {email} 的验证令牌。", { email: email.trim() })}</p>
        <div className="grid gap-2">
          <Label htmlFor="login-email-token">{t("验证令牌")}</Label>
          <Input ref={tokenInput} id="login-email-token" autoComplete="one-time-code" required value={token}
            disabled={saving} onChange={event => setToken(event.target.value)} />
        </div>
        <Button type="button" variant="link" className="justify-self-start px-0" disabled={saving}
          onClick={() => { setToken(""); setError(""); setStep("email") }}>{t("返回邮箱和密码")}</Button>
      </>}
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{t(error)}</p>}
  </ContextPanel>
}
