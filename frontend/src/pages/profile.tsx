import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type Session = {
  subject: string
  name: string | null
  email: string | null
  nickname: string | null
  roles: string[]
}

/**
 * 账户中心主页：展示当前身份；登录记录 / 设备管理 / 授权管理在 Phase 2 实装。
 */
export default function ProfilePage() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch("/me/api/session", { headers: { "X-Requested-With": "XMLHttpRequest" } })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/me/login")
          return null
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as Session
      })
      .then((data) => data && setSession(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  async function logout() {
    const response = await fetch("/me/api/antiforgery")
    const { token } = (await response.json()) as { token: string }
    await fetch("/me/api/logout", {
      method: "POST",
      headers: { "X-XSRF-Token": token, "X-Requested-With": "XMLHttpRequest" },
    })
    window.location.assign("/me/login")
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <span className="font-bold text-primary">🐼 PandaAuth 账户中心</span>
          {session && (
            <Button variant="outline" size="sm" onClick={logout}>
              退出登录
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {loading && <p className="text-muted-foreground">加载中…</p>}
        {error && <p className="text-destructive">会话服务异常，请刷新重试。</p>}
        {session && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{session.nickname ?? session.name ?? session.subject}</CardTitle>
                <CardDescription>
                  {session.email ?? "未绑定邮箱"} · {session.roles.length > 0 ? session.roles.join("、") : "普通用户"}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                身份标识：<code>{session.subject}</code>
              </CardContent>
            </Card>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {["登录记录", "设备管理", "授权管理"].map((title) => (
                <Card key={title}>
                  <CardHeader>
                    <CardTitle className="text-sm">{title}</CardTitle>
                    <CardDescription>Phase 2 上线</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
