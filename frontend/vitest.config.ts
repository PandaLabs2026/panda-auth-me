import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

const dirname = path.dirname(fileURLToPath(import.meta.url))

// 仅用于聚焦的前端组件测试（对齐 panda-auth-admin 的配置）；构建入口仍是 vite.config.ts。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
})
