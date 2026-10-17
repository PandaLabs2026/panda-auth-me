import { ExternalLinkIcon, LanguagesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSession } from "@/lib/auth"
import { useI18n } from "@/lib/i18n"

/**
 * 顶栏右侧常驻件：语言切换 + 返回来源应用（会话下发 appHomeUrl，文案随租户语境可配）。
 * 语言切换为纯 SPA 状态（仿 panda-auth-admin）。
 */
export default function HeaderActions() {
  const { t, locale, setLocale } = useI18n()
  const { data: session } = useSession()
  return (
    <>
      {session?.appHomeUrl && (
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground">
          <a href={session.appHomeUrl}>
            <ExternalLinkIcon />
            {session.appHomeLabel ?? t("返回应用")}
          </a>
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
        aria-label={locale === "zh-CN" ? "切换语言" : "Switch language"}
        onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
      >
        <LanguagesIcon />
        {locale === "zh-CN" ? "EN" : "中文"}
      </Button>
    </>
  )
}
