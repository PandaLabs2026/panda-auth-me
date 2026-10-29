import { lazy, Suspense } from "react"
import { createBrowserRouter } from "react-router"
import { ExternalLinkIcon, LogOutIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react"
import AppLayout, { type NavItem } from "@/components/patterns/AppLayout"
import HeaderActions from "@/components/header-actions"
import { SessionGate } from "@/app/SessionGate"
import ForbiddenPage from "@/pages/ForbiddenPage"
import LoginPage from "@/pages/login"
import NotFoundPage from "@/pages/NotFoundPage"
import ServerErrorPage from "@/pages/ServerErrorPage"
import { useI18n } from "@/lib/i18n"
import { sessionApi, useLogout } from "@/lib/auth"
import { notify } from "@/lib/notify"

/**
 * 路由(模板 v0.5.0 形态):/login 为桥接页(立即整页跳 BFF /me/login 走 OIDC 挑战),
 * 其余挂在 AppLayout(侧栏+固定顶栏)与 RequireAuth 守卫之下;403/500/404 错误页入册。
 * 账户中心是阅读宽度应用:AppLayout 内容区应用级收窄 max-w-4xl(v0.4.3 旋钮)。
 */

const ProfilePage = lazy(() => import("@/pages/profile"))
const SecurityPage = lazy(() => import("@/pages/security"))

function PageFallback() {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-4 pt-2" role="status" aria-label={t("页面加载中")}>
      <div className="h-6 w-64 rounded bg-muted" />
      <div className="h-24 w-full rounded bg-muted" />
      <div className="h-24 w-full rounded bg-muted" />
    </div>
  )
}

const page = (node: React.ReactNode) => <Suspense fallback={<PageFallback />}>{node}</Suspense>

/** 布局组装(模板 AppLayout 之上的应用层):品牌/导航/顶栏常驻件/命令面板动作。 */
export function AppShell() {
  const { t } = useI18n()
  const logout = useLogout()
  const navItems: NavItem[] = [
    { to: "/", label: t("账户总览"), icon: UserRoundIcon, end: true },
    { to: "/security", label: t("安全设置"), icon: ShieldCheckIcon },
  ]
  return (
    <AppLayout
      navItems={navItems}
      title={t("账户中心")}
      brand={
        <img src="/me/pandaauth-logo-horizontal.png" alt="PandaAuth by PandaLabs" className="h-9 w-auto max-w-full object-contain object-left" />
      }
      contentClassName="max-w-4xl mx-auto"
      headerActions={<HeaderActions />}
      commandActions={[
        {
          id: "app-home",
          label: t("返回应用"),
          icon: ExternalLinkIcon,
          run: () => {
            // appHomeUrl 由会话下发,命令面板动作取运行时值。
            void sessionApi.me()
              .then((s) => s?.appHomeUrl && window.location.assign(s.appHomeUrl))
              .catch((error) => notify.failure(error, "暂时无法读取应用入口。"))
          },
        },
        {
          id: "logout",
          label: t("退出登录"),
          icon: LogOutIcon,
          shortcut: "⌘⇧Q",
          run: () => void logout.mutateAsync().catch((error) => notify.failure(error, "退出登录失败；当前会话未确认已注销。")),
        },
      ]}
    />
  )
}

export const router = createBrowserRouter(
  [
    {path: "/sign-in", element: <LoginPage />},
    {
      path: "/login",
      element: (
        <>
          <LoginPage />
        </>
      ),
    },
    {
      path: "/",
      element: (
        <>
          <SessionGate>
            <AppShell />
          </SessionGate>
        </>
      ),
      children: [
        { index: true, element: page(<ProfilePage />) },
        { path: "security", element: page(<SecurityPage />) },
        { path: "403", element: <ForbiddenPage /> },
        { path: "500", element: <ServerErrorPage /> },
      ],
    },
    { path: "*", element: <NotFoundPage /> },
  ],
  // 路由 basename 跟随 Vite base,但剥掉尾斜杠:vite base 为 /me/ 而裸路径 /me 入口
  // (无尾斜杠)在 RR8 下不匹配 basename 会渲染空树——规范化为 /me 后两种入口都命中。
  { basename: import.meta.env.BASE_URL.replace(/\/+$/, "") || "/" },
)
