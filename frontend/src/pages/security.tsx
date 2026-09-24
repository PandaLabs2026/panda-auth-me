import { useCallback, useEffect, useState } from "react"
import QRCode from "qrcode"

import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { mfaApi, type MfaFactor, type MfaStatus } from "@/lib/mfa-api"
import { credentialToJson, toAssertionOptions, toCreationOptions } from "@/lib/webauthn"

const passkeySupported = typeof window !== "undefined" && "PublicKeyCredential" in window

function describeFactor(factor: MfaFactor): string {
  if (factor.type === "totp") return "TOTP 验证器"
  return factor.friendlyName ?? "Passkey"
}

/**
 * 安全设置：普通用户自助管理 MFA（Passkey / TOTP / 恢复码）。
 * 直连同源调用 IDP 的 /account/mfa/user/*；认证依赖 IDP 登录 Cookie，
 * 401 时由 mfa-api 统一跳转 /me/login 重新走 OIDC 登录。
 */
export default function SecurityPage() {
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
    if (!credential) throw new Error("未能创建 Passkey。")
    const completed = await mfaApi.passkeyEnrollmentComplete(
      ceremony.ceremonyId,
      credentialToJson(credential as PublicKeyCredential),
    )
    return `Passkey 已注册，当前共 ${completed.activePasskeyCount} 个。`
  }

  async function stepUpWithPasskey(): Promise<string> {
    const ceremony = await mfaApi.passkeyAssertionOptions()
    const credential = await navigator.credentials.get({
      publicKey: toAssertionOptions(ceremony.publicKey),
    })
    if (!credential) throw new Error("未能验证 Passkey。")
    await mfaApi.passkeyAssertionComplete(ceremony.ceremonyId, credentialToJson(credential as PublicKeyCredential))
    return "验证通过：5 分钟内可以继续敏感操作。"
  }

  function onAddPasskey() {
    if (!passkeySupported) {
      setError("此浏览器不支持 Passkey，请使用系统自带的验证器（如 Windows Hello）。")
      return
    }
    void run("enroll-passkey", async () => {
      try {
        return await enrollPasskey()
      } catch (cause) {
        const message = (cause as Error).message
        if (message.startsWith("当前条件不满足")) {
          throw new Error(
            status?.hasActiveFactor
              ? "添加新 Passkey 前需要先验证一个已有因子（5 分钟窗口），请点击「先验证已有因子」。"
              : message,
          )
        }
        throw cause
      }
    })
  }

  function onStepUp() {
    if (!passkeySupported) {
      setError("此浏览器不支持 Passkey，请使用系统自带的验证器（如 Windows Hello）。")
      return
    }
    void run("step-up", stepUpWithPasskey)
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
      return "TOTP 备用验证已启用。"
    })
  }

  function onGenerateRecoveryCodes() {
    if (!window.confirm("重新生成将使现有未使用的恢复码全部失效，继续？")) return
    void run("recovery", async () => {
      setRecoveryCodes(await mfaApi.recoveryCodes())
    })
  }

  function onRevoke(factor: MfaFactor) {
    if (!window.confirm(`撤销「${describeFactor(factor)}」？撤销后无法恢复。`)) return
    void run(`revoke-${factor.id}`, async () => {
      await mfaApi.revokeFactor(factor.id)
      return "因子已撤销。"
    })
  }

  const hasTotp = factors.some((factor) => factor.type === "totp")

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2 font-bold text-primary">
            <img src="/me/apple-touch-icon.png" alt="" className="h-6 w-6 rounded-md" />
            安全设置
          </span>
          <a href="/me" className={buttonVariants({ variant: "outline", size: "sm" })}>
            返回账户中心
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {loading && <p className="text-muted-foreground">加载中…</p>}
        {!loading && (
          <>
            {error && (
              <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="mb-4 rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-primary">
                {notice}
              </p>
            )}
            {status?.requiresReconfiguration && (
              <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                账号带有旧版两步验证标记但没有可用因子：下次登录会进入重新配置流程，请按页面指引重新设置。
              </p>
            )}

            <Card>
              <CardHeader>
                <CardTitle>多因素验证</CardTitle>
                <CardDescription>
                  {status?.hasActiveFactor
                    ? `已启用：${status.activePasskeyCount} 个 Passkey、${factors.filter((f) => f.type === "totp").length} 个 TOTP、${status.recoveryCodeCount} 个未用恢复码`
                    : "尚未启用。启用后可在敏感操作前要求第二重验证。"}
                </CardDescription>
              </CardHeader>
            </Card>

            <div className="mt-4 grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Passkey</CardTitle>
                  <CardDescription>
                    {passkeySupported
                      ? "使用平台验证器（Windows Hello / 触控 ID），设备会要求生物识别或 PIN。"
                      : "此浏览器不支持 Passkey，请使用系统自带浏览器的最新版本。"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button size="sm" disabled={!passkeySupported || busy !== null} onClick={onAddPasskey}>
                    {busy === "enroll-passkey" ? "注册中…" : "添加 Passkey"}
                  </Button>
                  {status?.hasActiveFactor && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!passkeySupported || busy !== null}
                      onClick={onStepUp}
                    >
                      {busy === "step-up" ? "验证中…" : "先验证已有因子"}
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">TOTP 备用验证</CardTitle>
                  <CardDescription>
                    {hasTotp
                      ? "已配置 TOTP 验证器。如需更换，请先在下方因子列表中撤销现有 TOTP。"
                      : "使用认证器 App（如 Microsoft Authenticator）扫描或手动录入密钥。"}
                  </CardDescription>
                </CardHeader>
                {!hasTotp && (
                  <CardContent className="space-y-3">
                    {!totpSetup ? (
                      <Button variant="outline" size="sm" disabled={busy !== null} onClick={onBeginTotp}>
                        {busy === "totp-begin" ? "生成中…" : "开始配置 TOTP"}
                      </Button>
                    ) : (
                      <>
                        {totpQrSvg && (
                          <div className="text-sm">
                            <p className="mb-1 text-muted-foreground">用认证器 App 扫码录入：</p>
                            <div
                              className="inline-block rounded-md bg-white p-2 [&>svg]:block [&>svg]:h-44 [&>svg]:w-44"
                              // 内容为本地生成的 SVG 二维码（来源：本页 provisioningUri），无不可信输入
                              dangerouslySetInnerHTML={{ __html: totpQrSvg }}
                            />
                          </div>
                        )}
                        <div className="text-sm">
                          <p className="mb-1 text-muted-foreground">或手动添加密钥：</p>
                          <code className="break-all rounded bg-muted px-2 py-1">{totpSetup.secret}</code>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="totp-code">输入认证器 6 位验证码以确认</Label>
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
                          {busy === "totp-confirm" ? "确认中…" : "确认 TOTP"}
                        </Button>
                      </>
                    )}
                  </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">恢复码</CardTitle>
                  <CardDescription>
                    {status
                      ? `剩余 ${status.recoveryCodeCount} 个未使用。丢失所有验证器时，可用恢复码登录并完成验证。`
                      : "丢失所有验证器时的一次性备用凭据。"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={onGenerateRecoveryCodes}>
                    {busy === "recovery" ? "生成中…" : "生成新恢复码"}
                  </Button>
                  {recoveryCodes && (
                    <div className="rounded-md border p-3">
                      <p className="mb-2 text-sm text-destructive">请立即保存，离开本页后不再显示：</p>
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
                  <CardTitle className="text-sm">已注册的验证因子</CardTitle>
                  <CardDescription>撤销最后一个可用因子会被服务端拒绝。</CardDescription>
                </CardHeader>
                <CardContent>
                  {factors.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无已确认的验证因子。</p>
                  ) : (
                    <ul className="divide-y">
                      {factors.map((factor) => (
                        <li key={factor.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <div>
                            <p>{describeFactor(factor)}</p>
                            <p className="text-xs text-muted-foreground">
                              添加于 {new Date(factor.createdAt).toLocaleString()}
                              {factor.lastUsedAt && ` · 最近使用 ${new Date(factor.lastUsedAt).toLocaleString()}`}
                            </p>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => onRevoke(factor)}
                          >
                            {busy === `revoke-${factor.id}` ? "撤销中…" : "撤销"}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
