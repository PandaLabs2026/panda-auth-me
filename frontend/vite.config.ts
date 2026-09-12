import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// 对齐 panda-webapp 模式：构建产物直接落到 .NET BFF 的 wwwroot/admin。
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
    proxy: { "/me/api": "http://localhost:9007" },
  },
})
