import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import ProfilePage from "@/pages/profile"

// 部署基路径 /me/（Caddy 将 /me/* 反代到本服务）。
const router = createBrowserRouter([{ path: "*", element: <ProfilePage /> }], {
  basename: "/me",
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
