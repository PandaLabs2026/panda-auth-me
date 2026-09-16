import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// 对齐 panda-webapp 模式：构建产物直接落到 .NET BFF 的 wwwroot/me。
export default defineConfig({
  base: "/me/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(dirname, "./src") },
  },
  build: {
    outDir: "../src/PandaAuth.Me/wwwroot/me",
    emptyOutDir: true,
  },
  server: {
    port: 5172,
    // 代理整个 /me 前缀（而不只是 /me/api）：/me/login 由 BFF 提供，
    // 若把它留给 Vite 的 SPA fallback，本地未登录访问 /me/login 拿到的是 index.html 而不是
    // challenge 重定向——页面永远登不上，表现为重定向循环。代理边界因此取前缀。
    proxy: { "/me": "http://localhost:9007" },
  },
})
