import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
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
    // vendor 分包:框架/组件库各自成 chunk(模板 v0.2 起的约定,vite 8 要求函数形式)。
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) return "react"
          if (id.includes("radix-ui") || id.includes("cmdk")) return "radix"
          if (id.includes("@tanstack")) return "tanstack"
          return undefined
        },
      },
    },
  },
  server: {
    port: 5172,
    // 代理清单 = **BFF 实际拥有的路由**（与 src/PandaAuth.Me/Program.cs 的 MapXxx 一一对应）：
    //   /me/api      会话查询、防伪令牌、登出
    //   /me/login    登录入口（challenge 到同域 IDP）
    //   /me/callback OIDC 回调（登录 / 登出）
    //   /me/healthz  探活
    // 为什么不图省事写成前缀 "/me"：Vite 的 proxy 中间件排在 base / indexHtml / transform **之前**，
    // 前缀写法会把 /me/、/me/@vite/client、/me/src/*.tsx、/me/assets/* 一并送去 BFF——
    // dev server 于是只剩「转发构建产物」这一件事，HMR、模块图、源码调试全部失效，
    // 而没有构建产物时干脆 404。少写 /me/login 的后果则是本地未登录访问该路径落到 Vite 的
    // SPA fallback，拿到 index.html 而非 challenge 重定向，表现为重定向循环。
    // 两侧都漏不得，故逐条列出：新增 BFF 路由时这里要同步。
    proxy: {
      "/me/api": "http://localhost:9007",
      // 安全设置页直连同源调用 IDP 的 /account/mfa/user/*；本地 IDP 在 9004，
      // dev 经此代理保持同源（Cookie 与 antiforgery 才能成立），生产由 Caddy 同域分流天然满足。
      "/account": "http://localhost:9004",
      "/me/login": "http://localhost:9007",
      "/me/callback": "http://localhost:9007",
      "/me/healthz": "http://localhost:9007",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    restoreMocks: true,
    pool: "threads",
  },
})
