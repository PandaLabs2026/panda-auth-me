import { Link } from "react-router"

import PageHeader from "@/components/patterns/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/auth"

/**
 * 账户中心主页：展示当前身份；安全设置直达；登录记录 / 设备管理 / 授权管理在 Phase 2 实装。
 * 壳（侧栏/顶栏/登出/返回应用）在模板 AppLayout,本页只管内容区。
 */
export default function ProfilePage() {
  const { t } = useI18n()
  const session = useSession()

  if (session.isPending) {
    return (
      <div role="status" aria-label={t("正在加载身份")} className="space-y-4">
        <div className="h-24 w-full rounded-lg bg-muted" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((card) => (
            <div key={card} className="h-28 w-full rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (session.error || !session.data) {
    return (
      <p role="alert" className="text-destructive">
        {t("会话服务异常，请刷新重试。")}
      </p>
    )
  }

  const s = session.data
  return (
    <div className="space-y-6">
      <PageHeader title={t("账户总览")} description={t("PandaAuth 账户的身份信息与自助入口。")} />
      <Card>
        <CardHeader>
          <CardTitle>{s.displayName}</CardTitle>
          <CardDescription>
            {s.email ?? t("未绑定邮箱")} · {s.roles && s.roles.length > 0 ? s.roles.join("、") : t("普通用户")}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("身份标识：")}<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.subject}</code>
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("安全设置")}</CardTitle>
            <CardDescription>{t("TOTP 与恢复码管理")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/security">{t("打开安全设置")}</Link>
            </Button>
          </CardContent>
        </Card>
        {["登录记录", "设备管理", "授权管理"].map((title) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="text-sm">{t(title)}</CardTitle>
              <CardDescription>{t("Phase 2 上线")}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  )
}
