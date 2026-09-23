import "./index.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import ProfilePage from "@/pages/profile"
import SecurityPage from "@/pages/security"

// 部署基路径 /me/（Caddy 将 /me/* 反代到本服务）。
const router = createBrowserRouter(
  [
    { path: "/", element: <ProfilePage /> },
    { path: "/security", element: <SecurityPage /> },
    { path: "*", element: <ProfilePage /> },
  ],
  {
    basename: "/me",
  },
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
