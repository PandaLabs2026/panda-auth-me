import { useEffect, useState } from "react"
import { useLocation, useSearchParams } from "react-router"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useI18n } from "@/lib/i18n"

/**
 * 登录桥接页:本应用不做凭据输入也不驻留品牌页——到达即整页跳 BFF 的 /me/login
 * (challenge 到同域 IDP,授权码 + PKCE)。回跳路径 /me/callback/login/pandaauth。
 * 带 returnUrl 到达(RequireAuth 守卫经 state.from,或 BFF 401 重定向)时透传,
 * 保持「会话过期 → 重登 → 回原页」的无缝体验。
 * 刻意不用 XHR:挑战是跨站重定向流,全页导航是唯一正确形态(admin 仓同款)。
 */
export default function LoginPage() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const stateFrom = (location.state as { from?: string } | null)?.from
  const returnUrl =
    searchParams.get("returnUrl") ?? (stateFrom && stateFrom.startsWith("/") ? stateFrom : "")
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    setLeaving(true)
    window.location.assign(
      returnUrl ? `/me/login?returnUrl=${encodeURIComponent(returnUrl)}` : "/me/login",
    )
  }, [returnUrl])

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg text-primary">{t("账户中心登录")}</CardTitle>
          <CardDescription>{t("正在前往统一身份认证…")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-1.5 w-full" aria-hidden="true" />
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            {leaving ? t("正在前往登录…") : t("请稍候。")}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
