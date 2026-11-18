import { Link } from "react-router"
import { useContext } from "react"

import PageHeader from "@/components/patterns/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/auth"
import { ProfilePresentationContext } from "@/lib/profile-presentation"

/**
 * 账户中心主页展示当前身份及可用的自助入口。
 * 壳（侧栏/顶栏/登出/返回应用）在模板 AppLayout,本页只管内容区。
 */
export default function ProfilePage() {
  const { t } = useI18n()
  const session = useSession()
  const profile = useContext(ProfilePresentationContext)

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
          <img className="size-14 rounded-full object-cover" src={profile.avatarUrl ?? "/me/brand/default-avatar.svg"} alt={t("个人头像")} />
          <CardTitle>{profile.displayName || s.displayName || t("未设置名称")}</CardTitle>
          <CardDescription>
            {t("登录邮箱")} · <span>{s.email ?? t("邮箱暂不可用")}</span>
          </CardDescription>
        </CardHeader>
      </Card>
      {s.profileEditingEnabled && <Button asChild variant="outline"><Link to="/profile">{t("编辑个人资料")}</Link></Button>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("账号与安全")}</CardTitle>
            <CardDescription>{t("登录邮箱、密码、验证器和恢复码")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/security">{t("打开账号与安全")}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
