import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import QRCode from "qrcode"

import { useAuthLeaveGuard } from "@/components/patterns/auth/context"
import { hasUncertainOperation, meAuthLifecycle, meAuthNavigation } from "@/lib/auth-lifecycle"
import PageHeader from "@/components/patterns/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { GrantRequiredError, MfaRequestError, StaleMfaResponseError, mfaApi, type MfaFactor, type MfaStatus } from "@/lib/mfa-api"
import { useI18n } from "@/lib/i18n"

/**
 * 安全设置：普通用户自助管理 MFA（TOTP / 恢复码）。Passkey 已退役且表已删除
 * （AUTH-DELIVERY-002 删表批）；更换 TOTP / 重生成恢复码须先完成单次操作授权——
 * TOTP 码 + 当前密码。授权对话框由服务端
 * 403 mfaGrantRequired 信号驱动，签发参数回显自服务端响应，两端口径不漂移。
 */
export default function SecurityPage() {
  const { t } = useI18n()

  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [factors, setFactors] = useState<MfaFactor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [totpSetup, setTotpSetup] = useState<{ factorId: string; secret: string; provisioningUri: string } | null>(null)
  const [totpQrSvg, setTotpQrSvg] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState("")

  // 操作授权对话框状态：由服务端 GrantRequiredError 驱动，retry 携带授权头重放原操作。
  const [pendingGrant, setPendingGrant] = useState<{
    operation: string
    targetId: string
    parameters: Record<string, string | null> | null
    passwordRequired: boolean
    retry: (grantId: string) => Promise<string | void>
  } | null>(null)
  const [grantCode, setGrantCode] = useState("")
  const [grantPassword, setGrantPassword] = useState("")
  const [grantError, setGrantError] = useState<string | null>(null)
  const [reauthenticationNeeded, setReauthenticationNeeded] = useState(false)
  const lifetime = useRef({mounted: false, load: 0, qr: 0}).current, operation = useRef(false)
  const paused = useSyncExternalStore(meAuthLifecycle.subscribe, meAuthLifecycle.paused)
  const uncertain = useSyncExternalStore(meAuthLifecycle.subscribe, hasUncertainOperation)
  useAuthLeaveGuard(Boolean(busy || totpSetup || recoveryCodes || totpCode || pendingGrant || grantCode || grantPassword), "未完成的MFA操作或未保存的敏感内容")
  const current = useCallback((epoch: number) => lifetime.mounted && !meAuthLifecycle.paused() && meAuthLifecycle.epoch() === epoch, [lifetime])
  const reportError = useCallback((cause: unknown, epoch: number) => {
    if (!lifetime.mounted) return
    if (cause instanceof MfaRequestError && cause.status === 401) {
      setReauthenticationNeeded(true); setError(cause.message)
    } else setError(current(epoch) && cause instanceof Error ? cause.message : new StaleMfaResponseError().message)
  }, [current, lifetime])
  function beginOperation(key: string) {
    if (operation.current || meAuthLifecycle.paused() || hasUncertainOperation() || reauthenticationNeeded) return undefined
    operation.current = true; setBusy(key); setError(null); setNotice(null)
    return meAuthLifecycle.epoch()
  }
  function finishOperation() {operation.current = false; if (lifetime.mounted) setBusy(null)}

  const load = useCallback(async () => {
    if (meAuthLifecycle.paused()) return
    const epoch = meAuthLifecycle.epoch(), generation = ++lifetime.load
    try {
      // A 401 pauses admission and cancels sibling reads. Preserve the verified
      // identity failure even if that sibling cancellation rejects first.
      const results = await Promise.allSettled([mfaApi.status(), mfaApi.factors()])
      const failures = results.filter(result => result.status === "rejected")
      const identityFailure = failures.find(result => result.reason instanceof MfaRequestError && result.reason.status === 401)
      if (identityFailure) throw identityFailure.reason
      if (failures.length) throw failures[0].reason
      const [statusResult, factorsResult] = results
      if (statusResult.status !== "fulfilled" || factorsResult.status !== "fulfilled") return
      const nextStatus = statusResult.value, nextFactors = factorsResult.value
      if (!current(epoch) || generation !== lifetime.load) throw new StaleMfaResponseError()
      setStatus(nextStatus); setFactors(nextFactors); setReauthenticationNeeded(false); setError(null)
    } catch (cause) {
      if (generation === lifetime.load) reportError(cause, epoch)
    } finally {
      if (lifetime.mounted && generation === lifetime.load) setLoading(false)
    }
  }, [current, reportError, lifetime])

  useEffect(() => {
    lifetime.mounted = true; void load()
    return () => {lifetime.mounted = false; lifetime.load++; lifetime.qr++}
  }, [load, lifetime])

  async function run(key: string, action: () => Promise<string | void>) {
    const epoch = beginOperation(key); if (epoch === undefined) return
    try {
      const message = await action()
      if (!current(epoch)) throw new StaleMfaResponseError()
      if (typeof message === "string") setNotice(message)
      await load()
    } catch (cause) {reportError(cause, epoch)}
    finally {finishOperation()}
  }

  /** A confirmed operation-grant response is retained for explicit verification, never automatically replayed after reauthentication. */
  async function guarded(key: string, attempt: () => Promise<string | void>, retry: (grantId: string) => Promise<string | void>) {
    const epoch = beginOperation(key); if (epoch === undefined) return
    try {
      let message: string | void
      try {message = await attempt()}
      catch (cause) {
        if (!(cause instanceof GrantRequiredError)) throw cause
        if (!current(epoch)) throw new StaleMfaResponseError()
        setGrantCode(""); setGrantPassword(""); setGrantError(null)
        setPendingGrant({operation: cause.operation, targetId: cause.targetId, parameters: cause.parameters, passwordRequired: cause.passwordRequired, retry})
        return
      }
      if (!current(epoch)) throw new StaleMfaResponseError()
      if (typeof message === "string") setNotice(message)
      await load()
    } catch (cause) {reportError(cause, epoch)}
    finally {finishOperation()}
  }

  async function submitGrant() {
    const grant = pendingGrant
    if (!grant) return
    const epoch = beginOperation("grant"); if (epoch === undefined) return
    setGrantError(null)
    try {
      const {grantId} = await mfaApi.requestGrant(grant.operation, grant.targetId, grant.parameters, grantCode,
        grant.passwordRequired ? grantPassword : undefined)
      if (!current(epoch)) throw new StaleMfaResponseError()
      const message = await grant.retry(grantId)
      if (!current(epoch)) throw new StaleMfaResponseError()
      setPendingGrant(null); setGrantCode(""); setGrantPassword("")
      if (typeof message === "string") setNotice(message)
      await load()
    } catch (cause) {
      if (lifetime.mounted) {
        setGrantError(current(epoch) && cause instanceof Error ? cause.message : new StaleMfaResponseError().message)
        if (cause instanceof MfaRequestError && cause.status === 401) reportError(cause, epoch)
      }
    } finally {finishOperation()}
  }

  function closeGrant() {
    if (operation.current) return
    setPendingGrant(null); setGrantCode(""); setGrantPassword(""); setGrantError(null)
  }

  function beginTotpSetup(setup: {factorId: string; secret: string; provisioningUri: string}) {
    const epoch = meAuthLifecycle.epoch(), generation = ++lifetime.qr
    setTotpSetup(setup); setTotpCode("")
    void QRCode.toString(setup.provisioningUri, {type: "svg", margin: 1, width: 180}).then(svg => {
      if (current(epoch) && generation === lifetime.qr) setTotpQrSvg(svg)
    }).catch(() => {if (current(epoch) && generation === lifetime.qr) setTotpQrSvg(null)})
  }

  function onBeginTotp() {
    void guarded("totp-begin", async () => {
      const epoch = meAuthLifecycle.epoch(), setup = await mfaApi.totpOptions()
      if (!current(epoch)) throw new StaleMfaResponseError()
      beginTotpSetup(setup)
    }, async grantId => {
      const epoch = meAuthLifecycle.epoch(), setup = await mfaApi.totpOptions(grantId)
      if (!current(epoch)) throw new StaleMfaResponseError()
      beginTotpSetup(setup)
    })
  }

  function onConfirmTotp() {
    if (!totpSetup) return
    void run("totp-confirm", async () => {
      const epoch = meAuthLifecycle.epoch()
      await mfaApi.totpConfirm(totpSetup.factorId, totpCode)
      if (!current(epoch)) throw new StaleMfaResponseError()
      setTotpSetup(null)
      setTotpQrSvg(null)
      setTotpCode("")
      return t("TOTP 已启用。")
    })
  }

  async function generateRecoveryCodes(grantId?: string) {
    const epoch = meAuthLifecycle.epoch(), codes = await mfaApi.recoveryCodes(grantId)
    if (!current(epoch)) throw new StaleMfaResponseError()
    setRecoveryCodes(codes)
    await load()
  }

  // 删表批后因子只剩 TOTP；轮换机制下唯一 TOTP 是稳态（服务端护栏兜底）。
  const hasTotp = factors.length > 0

  function grantDialogTitle(): string {
    if (!pendingGrant) return ""
    if (pendingGrant.operation === "self.totp-enroll") return t("更换 TOTP")
    if (pendingGrant.operation === "self.revoke-factor") return t("撤销 TOTP")
    return t("生成新恢复码")
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("安全设置")}
        description={t("管理 TOTP 验证器与恢复码；敏感操作需要验证码和当前密码。")}
      />

      {loading && (
        <p role="status" className="text-muted-foreground">{t("加载中…")}</p>
      )}
      {!loading && (
        <>
          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-primary">
              {notice}
            </p>
          )}
          {uncertain && <p role="alert" className="text-destructive">{t("操作结果待核实。请先重新读取安全设置并核实结果，不要重复提交原操作。")}</p>}
          {(error || uncertain) && <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={paused || busy !== null} onClick={() => void load()}>{t("重新读取安全设置")}</Button>
            {(reauthenticationNeeded || uncertain) && <Button asChild variant="outline"><a href={meAuthNavigation.href("/me/security")} onClick={event => {
              event.preventDefault()
              if (meAuthLifecycle.reasons().length && !window.confirm(t("重新认证将离开当前页面。请先保留必要内容并核实待定操作结果；确认离开？"))) return
              meAuthNavigation.start("/me/security", true)
            }}>{t("重新认证")}</a></Button>}
          </div>}
          {status?.requiresReconfiguration && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {t("账号带有旧版两步验证标记但没有可用因子：下次登录会进入重新配置流程，请按页面指引重新设置。")}
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t("多因素验证")}</CardTitle>
              <CardDescription>
                {status?.hasActiveFactor
                  ? t("已启用：{totpCount} 个 TOTP、{recoveryCodeCount} 个未用恢复码", {
                      totpCount: factors.filter((factor) => factor.type === 'totp').length,
                      recoveryCodeCount: status.recoveryCodeCount,
                    })
                  : status ? t("尚未启用。启用后可在敏感操作前要求第二重验证。") : t("尚未读取安全状态。")}
              </CardDescription>
            </CardHeader>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("TOTP 验证器")}</CardTitle>
                <CardDescription>
                  {hasTotp
                    ? t("已配置 TOTP 验证器。更换需验证当前验证码与登录密码；旧验证器在新验证器确认前保持可用。")
                    : t("使用认证器 App（如 Microsoft Authenticator）扫描或手动录入密钥。")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!totpSetup && (
                  <Button variant="outline" size="sm" disabled={busy !== null || paused || uncertain || reauthenticationNeeded} onClick={onBeginTotp}>
                    {busy === "totp-begin"
                      ? t("生成中…")
                      : hasTotp
                        ? t("更换 TOTP")
                        : t("开始配置 TOTP")}
                  </Button>
                )}
                {totpSetup && (
                  <>
                    {totpQrSvg && (
                      <div className="text-sm">
                        <p className="mb-1 text-muted-foreground">{t("用认证器 App 扫码录入：")}</p>
                        <div
                          className="inline-block rounded-md bg-white p-2 [&>svg]:block [&>svg]:h-44 [&>svg]:w-44"
                          // 内容为本地生成的 SVG 二维码（来源：本页 provisioningUri），无不可信输入
                          dangerouslySetInnerHTML={{ __html: totpQrSvg }}
                        />
                      </div>
                    )}
                    <div className="text-sm">
                      <p className="mb-1 text-muted-foreground">{t("或手动添加密钥：")}</p>
                      <code className="break-all rounded bg-muted px-2 py-1">{totpSetup.secret}</code>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="totp-code">{t("输入认证器 6 位验证码以确认")}</Label>
                      <Input
                        id="totp-code"
                        disabled={busy !== null || paused}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={totpCode}
                        onChange={(event) => setTotpCode(event.target.value)}
                      />
                    </div>
                    <Button size="sm" disabled={busy !== null || paused || uncertain || reauthenticationNeeded || totpCode.length !== 6} onClick={onConfirmTotp}>
                      {busy === "totp-confirm" ? t("确认中…") : t("确认 TOTP")}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("恢复码")}</CardTitle>
                <CardDescription>
                  {status
                    ? t("剩余 {count} 个未使用。丢失所有验证器时，可用恢复码登录并完成验证。", { count: status.recoveryCodeCount })
                    : t("丢失所有验证器时的一次性备用凭据。")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null || paused || uncertain || reauthenticationNeeded}
                  onClick={() =>
                    void guarded(
                      "recovery",
                      () => generateRecoveryCodes(),
                      (grantId) => generateRecoveryCodes(grantId),
                    )
                  }
                >
                  {busy === "recovery" ? t("生成中…") : t("生成新恢复码")}
                </Button>
                {recoveryCodes && (
                  <div className="rounded-md border p-3">
                    <p className="mb-2 text-sm text-destructive">{t("请立即保存，离开本页后不再显示：")}</p>
                    <div className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
                      {recoveryCodes.map((code) => (
                        <span key={code}>{code}</span>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("已注册的验证因子")}</CardTitle>
                <CardDescription>
                  {t("撤销 TOTP 需验证当前验证码与登录密码；最后一个 TOTP 不可撤销（请使用「更换 TOTP」）。")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {factors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("暂无已确认的验证因子。")}</p>
                ) : (
                  <ul className="divide-y">
                    {factors.map((factor) => (
                      <li key={factor.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div>
                          <p>{t("TOTP 验证器")}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("添加于 {date}", { date: new Date(factor.createdAt).toLocaleString() })}
                            {factor.lastUsedAt && ` · ${t("最近使用 {date}", { date: new Date(factor.lastUsedAt).toLocaleString() })}`}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">{t("更换请使用「更换 TOTP」")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Dialog open={pendingGrant !== null && !paused && !reauthenticationNeeded} onOpenChange={(open) => !open && closeGrant()}>
            {!paused && !reauthenticationNeeded && <DialogContent onCloseAutoFocus={event => {
              if (meAuthLifecycle.paused()) event.preventDefault()
            }}>
              <DialogHeader>
                <DialogTitle>{grantDialogTitle()}</DialogTitle>
                <DialogDescription>
                  {pendingGrant?.passwordRequired
                    ? t("该操作需要验证当前认证器验证码与登录密码，授权仅本次有效。")
                    : t("该操作需要验证当前认证器验证码，授权仅本次有效。")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="grant-totp-code">{t("输入认证器 6 位验证码")}</Label>
                  <Input
                    id="grant-totp-code"
                    disabled={busy !== null || paused}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={grantCode}
                    onChange={(event) => setGrantCode(event.target.value)}
                  />
                </div>
                {pendingGrant?.passwordRequired && (
                  <div className="space-y-1">
                    <Label htmlFor="grant-password">{t("当前密码")}</Label>
                    <Input
                      id="grant-password"
                      disabled={busy !== null || paused}
                      type="password"
                      autoComplete="current-password"
                      value={grantPassword}
                      onChange={(event) => setGrantPassword(event.target.value)}
                    />
                  </div>
                )}
                {grantError && <p role="alert" className="text-sm text-destructive">{grantError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" disabled={busy !== null || paused} onClick={closeGrant}>
                  {t("取消")}
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null || paused || uncertain || reauthenticationNeeded || grantCode.length !== 6 || (pendingGrant?.passwordRequired === true && grantPassword.length === 0)}
                  onClick={() => void submitGrant()}
                >
                  {t("验证并继续")}
                </Button>
              </DialogFooter>
            </DialogContent>}
          </Dialog>
        </>
      )}
    </div>
  )
}
