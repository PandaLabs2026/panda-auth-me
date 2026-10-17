import { useCallback, useEffect, useState } from "react"
import QRCode from "qrcode"

import ConfirmAction from "@/components/patterns/ConfirmAction"
import PageHeader from "@/components/patterns/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { mfaApi, type MfaFactor, type MfaStatus } from "@/lib/mfa-api"
import { useI18n } from "@/lib/i18n"
import { credentialToJson, toAssertionOptions, toCreationOptions } from "@/lib/webauthn"

const passkeySupported = typeof window !== "undefined" && "PublicKeyCredential" in window

/**
 * 安全设置：普通用户自助管理 MFA（Passkey / TOTP / 恢复码）。
 * 直连同源调用 IDP 的 /account/mfa/user/*；认证依赖 IDP 登录 Cookie，
 * 401 时由 mfa-api 统一跳转 /me/login 重新走 OIDC 登录。
 * 危险操作（撤销因子/重生成恢复码）走模板 ConfirmAction（结果经全局 notify）；
 * step-up 流程的提示保持页内常驻（5 分钟窗口语境需要持续可见）。
 */
export default function SecurityPage() {
  const { t } = useI18n()

  function describeFactor(factor: MfaFactor): string {
    if (factor.type === "totp") return t("TOTP 验证器")
    return factor.friendlyName ?? t("Passkey")
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
  const [totpAssertCode, setTotpAssertCode] = useState("")

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

  async function enrollPasskey(): Promise<string> {
    const ceremony = await mfaApi.passkeyEnrollmentOptions()
    const credential = await navigator.credentials.create({
      publicKey: toCreationOptions(ceremony.publicKey),
    })
    if (!credential) throw new Error(t("未能创建 Passkey。"))
    const completed = await mfaApi.passkeyEnrollmentComplete(
      ceremony.ceremonyId,
      credentialToJson(credential as PublicKeyCredential),
    )
    return t("Passkey 已注册，当前共 {count} 个。", { count: completed.activePasskeyCount })
  }

  async function stepUpWithPasskey(): Promise<string> {
    const ceremony = await mfaApi.passkeyAssertionOptions()
    const credential = await navigator.credentials.get({
      publicKey: toAssertionOptions(ceremony.publicKey),
    })
    if (!credential) throw new Error(t("未能验证 Passkey。"))
    await mfaApi.passkeyAssertionComplete(ceremony.ceremonyId, credentialToJson(credential as PublicKeyCredential))
    return t("验证通过：5 分钟内可以继续敏感操作。")
  }

  async function stepUpWithTotp(): Promise<string> {
    await mfaApi.totpAssert(totpAssertCode)
    setTotpAssertCode("")
    return t("验证通过：5 分钟内可以继续敏感操作。")
  }

  function onAddPasskey() {
    if (!passkeySupported) {
      setError(t("此浏览器不支持 Passkey，请使用系统自带的验证器（如 Windows Hello）。"))
      return
    }
    void run("enroll-passkey", async () => {
      try {
        return await enrollPasskey()
      } catch (cause) {
        const message = (cause as Error).message
        // mfa-api 的 403 兜底文案随 locale 双语（"当前条件不满足" / "Preconditions not met"），两者都要命中引导分支。
        if (message.startsWith("当前条件不满足") || message.startsWith("Preconditions not met")) {
          throw new Error(
            status?.hasActiveFactor
              ? t("添加新 Passkey 前需要先验证一个已有因子（5 分钟窗口）：请用 Passkey 或 TOTP 完成验证。")
              : message,
            { cause },
          )
        }
        throw cause
      }
    })
  }

  function onStepUp() {
    void run("step-up", stepUpWithPasskey)
  }

  function onStepUpWithTotp() {
    void run("step-up-totp", stepUpWithTotp)
  }

  function onBeginTotp() {
    void run("totp-begin", async () => {
      const setup = await mfaApi.totpOptions()
      setTotpSetup(setup)
      setTotpCode("")
      // SVG 字符串输出（非 canvas）：与 jsdom 测试环境兼容，展示更清晰。
      try {
        setTotpQrSvg(await QRCode.toString(setup.provisioningUri, { type: "svg", margin: 1, width: 180 }))
      } catch {
        setTotpQrSvg(null)
      }
    })
  }

  function onConfirmTotp() {
    if (!totpSetup) return
    void run("totp-confirm", async () => {
      await mfaApi.totpConfirm(totpSetup.factorId, totpCode)
      setTotpSetup(null)
      setTotpQrSvg(null)
      setTotpCode("")
      return t("TOTP 备用验证已启用。")
    })
  }

  // 恢复码重生成与因子撤销:危险操作走 ConfirmAction,成功/失败反馈由组件归一到全局 notify。
  async function generateRecoveryCodes() {
    setRecoveryCodes(await mfaApi.recoveryCodes())
    await load()
  }

  async function revokeFactor(factor: MfaFactor) {
    await mfaApi.revokeFactor(factor.id)
    await load()
  }

  const hasTotp = factors.some((factor) => factor.type === "totp")
  const hasPasskey = factors.some((factor) => factor.type === "passkey")

  return (
    <div className="space-y-6">
      <PageHeader title={t("安全设置")} description={t("管理 Passkey、TOTP 与恢复码；敏感操作前需要完成一次因子验证。")} />

      {loading && <p role="status" className="text-muted-foreground">{t("加载中…")}</p>}
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
                  ? t("已启用：{passkeyCount} 个 Passkey、{totpCount} 个 TOTP、{recoveryCodeCount} 个未用恢复码", {
                      passkeyCount: status.activePasskeyCount,
                      totpCount: factors.filter((f) => f.type === "totp").length,
                      recoveryCodeCount: status.recoveryCodeCount,
                    })
                  : t("尚未启用。启用后可在敏感操作前要求第二重验证。")}
              </CardDescription>
            </CardHeader>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("Passkey")}</CardTitle>
                <CardDescription>
                  {passkeySupported
                    ? t("使用平台验证器（Windows Hello / 触控 ID），设备会要求生物识别或 PIN。")
                    : t("此浏览器不支持 Passkey，请使用系统自带浏览器的最新版本。")}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button size="sm" disabled={!passkeySupported || busy !== null} onClick={onAddPasskey}>
                  {busy === "enroll-passkey" ? t("注册中…") : t("添加 Passkey")}
                </Button>
                {status?.hasActiveFactor && hasPasskey && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!passkeySupported || busy !== null}
                    onClick={onStepUp}
                  >
                    {busy === "step-up" ? t("验证中…") : t("先验证已有因子")}
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("TOTP 备用验证")}</CardTitle>
                <CardDescription>
                  {hasTotp
                    ? t("已配置 TOTP 验证器。如需更换，请先在下方因子列表中撤销现有 TOTP。")
                    : t("使用认证器 App（如 Microsoft Authenticator）扫描或手动录入密钥。")}
                </CardDescription>
              </CardHeader>
              {hasTotp && (
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t("敏感操作前可用 TOTP 验证码完成验证（打开 5 分钟窗口）。")}
                  </p>
                  <div className="space-y-1">
                    <Label htmlFor="totp-assert-code">{t("输入认证器 6 位验证码")}</Label>
                    <Input
                      id="totp-assert-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={totpAssertCode}
                      onChange={(event) => setTotpAssertCode(event.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null || totpAssertCode.length !== 6}
                    onClick={onStepUpWithTotp}
                  >
                    {busy === "step-up-totp" ? t("验证中…") : t("验证 TOTP")}
                  </Button>
                </CardContent>
              )}
              {!hasTotp && (
                <CardContent className="space-y-3">
                  {!totpSetup ? (
                    <Button variant="outline" size="sm" disabled={busy !== null} onClick={onBeginTotp}>
                      {busy === "totp-begin" ? t("生成中…") : t("开始配置 TOTP")}
                    </Button>
                  ) : (
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
              )}
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
                <ConfirmAction
                  trigger={
                    <Button variant="outline" size="sm" disabled={busy !== null}>
                      {busy === "recovery" ? t("生成中…") : t("生成新恢复码")}
                    </Button>
                  }
                  title={t("生成新恢复码？")}
                  description={t("重新生成将使现有未使用的恢复码全部失效，且新码只在离开本页前显示一次。")}
                  confirmLabel={t("生成新恢复码")}
                  successMessage={t("新恢复码已生成，请立即保存。")}
                  onConfirm={generateRecoveryCodes}
                />
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
              <CardDescription>{t("撤销最后一个可用因子会被服务端拒绝。")}</CardDescription>
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
                        <ConfirmAction
                          trigger={
                            <Button variant="destructive" size="sm">
                              {t("撤销")}
                            </Button>
                          }
                          title={t("撤销「{name}」？", { name: describeFactor(factor) })}
                          description={t("撤销后无法恢复；如这是最后一个可用因子，两步验证将被关闭。")}
                          confirmLabel={t("撤销")}
                          successMessage={t("因子已撤销。")}
                          onConfirm={() => revokeFactor(factor)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
