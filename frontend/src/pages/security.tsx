import { useCallback, useEffect, useState } from "react"
import QRCode from "qrcode"

import ConfirmAction from "@/components/patterns/ConfirmAction"
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
import { GrantRequiredError, mfaApi, type MfaFactor, type MfaStatus } from "@/lib/mfa-api"
import { useI18n } from "@/lib/i18n"

/**
 * 安全设置：普通用户自助管理 MFA（TOTP / 恢复码）。Passkey 已退役（AUTH-DELIVERY-002）：
 * 存量 passkey 行仅展示与撤销（迁移动作，无需授权）；特敏感操作（更换 TOTP / 撤销 TOTP /
 * 重生成恢复码）须先完成单次操作授权——TOTP 码 + 当前密码。授权对话框由服务端
 * 403 mfaGrantRequired 信号驱动，签发参数回显自服务端响应，两端口径不漂移。
 */
export default function SecurityPage() {
  const { t } = useI18n()

  function describeFactor(factor: MfaFactor): string {
    if (factor.type === "totp") return t("TOTP 验证器")
    return factor.friendlyName
      ? t("已退役 Passkey：{name}", { name: factor.friendlyName })
      : t("已退役 Passkey")
  }

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

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextFactors] = await Promise.all([mfaApi.status(), mfaApi.factors()])
      setStatus(nextStatus)
      setFactors(nextFactors)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [])

  useEffect(() => {
    void load().finally(() => setLoading(false))
  }, [load])

  async function run(key: string, action: () => Promise<string | void>) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const message = await action()
      if (typeof message === "string") setNotice(message)
      await load()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** 特敏感操作统一入口：先裸试，命中 403 授权标记则弹授权对话框，验证后带授权重放。 */
  async function guarded(
    key: string,
    attempt: () => Promise<string | void>,
    retry: (grantId: string) => Promise<string | void>,
  ) {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      let message: string | void
      try {
        message = await attempt()
      } catch (cause) {
        if (cause instanceof GrantRequiredError) {
          setGrantCode("")
          setGrantPassword("")
          setGrantError(null)
          setPendingGrant({
            operation: cause.operation,
            targetId: cause.targetId,
            parameters: cause.parameters,
            passwordRequired: cause.passwordRequired,
            retry,
          })
          return
        }
        throw cause
      }
      if (typeof message === "string") setNotice(message)
      await load()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function submitGrant() {
    if (!pendingGrant) return
    setGrantError(null)
    try {
      const { grantId } = await mfaApi.requestGrant(
        pendingGrant.operation,
        pendingGrant.targetId,
        pendingGrant.parameters,
        grantCode,
        pendingGrant.passwordRequired ? grantPassword : undefined,
      )
      const retry = pendingGrant.retry
      const message = await retry(grantId)
      setPendingGrant(null)
      if (typeof message === "string") setNotice(message)
      await load()
    } catch (cause) {
      setGrantError((cause as Error).message)
    }
  }

  function beginTotpSetup(setup: { factorId: string; secret: string; provisioningUri: string }) {
    setTotpSetup(setup)
    setTotpCode("")
    void (async () => {
      try {
        setTotpQrSvg(await QRCode.toString(setup.provisioningUri, { type: "svg", margin: 1, width: 180 }))
      } catch {
        setTotpQrSvg(null)
      }
    })()
  }

  function onBeginTotp() {
    // 首次绑定（无可验证因子）不需要授权；更换（已有 TOTP）由服务端 403 引导进授权对话框。
    setBusy("totp-begin")
    setError(null)
    setNotice(null)
    void (async () => {
      try {
        beginTotpSetup(await mfaApi.totpOptions())
      } catch (cause) {
        if (cause instanceof GrantRequiredError) {
          setGrantCode("")
          setGrantPassword("")
          setGrantError(null)
          setPendingGrant({
            operation: cause.operation,
            targetId: cause.targetId,
            parameters: cause.parameters,
            passwordRequired: cause.passwordRequired,
            retry: async (grantId) => {
              beginTotpSetup(await mfaApi.totpOptions(grantId))
            },
          })
          return
        }
        setError((cause as Error).message)
      } finally {
        setBusy(null)
      }
    })()
  }

  function onConfirmTotp() {
    if (!totpSetup) return
    void run("totp-confirm", async () => {
      await mfaApi.totpConfirm(totpSetup.factorId, totpCode)
      setTotpSetup(null)
      setTotpQrSvg(null)
      setTotpCode("")
      return t("TOTP 已启用。")
    })
  }

  async function generateRecoveryCodes(grantId?: string) {
    const codes = await mfaApi.recoveryCodes(grantId)
    setRecoveryCodes(codes)
    await load()
  }

  const hasTotp = factors.some((factor) => factor.type === "totp")
  const totpCount = factors.filter((factor) => factor.type === "totp").length

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
                      totpCount,
                      recoveryCodeCount: status.recoveryCodeCount,
                    })
                  : t("尚未启用。启用后可在敏感操作前要求第二重验证。")}
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
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={onBeginTotp}>
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
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={totpCode}
                        onChange={(event) => setTotpCode(event.target.value)}
                      />
                    </div>
                    <Button size="sm" disabled={busy !== null || totpCode.length !== 6} onClick={onConfirmTotp}>
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
                  disabled={busy !== null}
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
                          <p>{describeFactor(factor)}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("添加于 {date}", { date: new Date(factor.createdAt).toLocaleString() })}
                            {factor.lastUsedAt && ` · ${t("最近使用 {date}", { date: new Date(factor.lastUsedAt).toLocaleString() })}`}
                          </p>
                        </div>
                        {factor.type === "passkey" ? (
                          <ConfirmAction
                            trigger={
                              <Button variant="destructive" size="sm">
                                {t("撤销")}
                              </Button>
                            }
                            title={t("撤销「{name}」？", { name: describeFactor(factor) })}
                            description={t("退役 Passkey 已不可用于验证；撤销仅清除存量记录。")}
                            confirmLabel={t("撤销")}
                            successMessage={t("因子已撤销。")}
                            onConfirm={async () => {
                              await mfaApi.revokeFactor(factor.id)
                            }}
                          />
                        ) : totpCount > 1 ? (
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() =>
                              void guarded(
                                `revoke-${factor.id}`,
                                () => mfaApi.revokeFactor(factor.id).then(() => undefined),
                                (grantId) => mfaApi.revokeFactor(factor.id, grantId).then(() => t("因子已撤销。")),
                              )
                            }
                          >
                            {busy === `revoke-${factor.id}` ? t("撤销中…") : t("撤销")}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("更换请使用「更换 TOTP」")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Dialog open={pendingGrant !== null} onOpenChange={(open) => !open && setPendingGrant(null)}>
            <DialogContent>
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
                <Button variant="outline" size="sm" onClick={() => setPendingGrant(null)}>
                  {t("取消")}
                </Button>
                <Button
                  size="sm"
                  disabled={grantCode.length !== 6 || (pendingGrant?.passwordRequired === true && grantPassword.length === 0)}
                  onClick={() => void submitGrant()}
                >
                  {t("验证并继续")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
