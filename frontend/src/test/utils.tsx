import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router"
import { Toaster } from "@/components/ui/sonner"
import { testSession } from "./session"

/**
 * 页面级测试的统一 Provider 包裹：Query（会话预填，免去每测 stub /me/api/session）
 * + MemoryRouter + Toaster（写反馈经 notify，断言 toast 文案需要渲染出口）。
 * 需要 page 自行驱动会话加载的用例传 session="fetch"（不预填，由 fetch 桩应答）。
 */
export function Providers({
  children,
  initialEntries = ["/"],
  session = "prefill",
}: {
  children: React.ReactNode
  initialEntries?: string[]
  session?: "prefill" | "fetch"
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (session === "prefill") client.setQueryData(["session"], testSession)
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      <Toaster position="top-center" />
    </QueryClientProvider>
  )
}
