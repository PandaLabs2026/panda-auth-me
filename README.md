# panda-auth-me

PandaAuth 账户中心（用户自助中心）——`https://auth.pandalabs.cn/me`，终端用户管理个人身份的自助门户，Phase 2 实装完整能力。

## 定位

- 消费者：**终端用户**（区别于管理员用的 webadmin）
- 登录：第一方 OIDC 客户端 `me-web`（机密 + PKCE，由 panda-auth-server Seeder 预置）——用户看到的是 PandaAuth 统一登录页，Cookie 同域单点通行
- 技术形态与 panda-auth-webadmin 同款：.NET BFF + React SPA

| 组成 | 技术栈 | 说明 |
|---|---|---|
| `src/PandaAuth.Me` | .NET 10 BFF + OpenIddict.Client | 会话 Cookie、OIDC 回调、`/me/api/session`、RP 发起单点登出 |
| `frontend/` | React 19 + Vite 7 + TS strict + Tailwind 4 + shadcn/ui | 账户中心 SPA；产物输出到 BFF `wwwroot/me` |

## 页面现状（骨架）

- `/me/` 身份概览（昵称/邮箱/角色）+ Phase 2 占位卡片：登录记录、设备管理、授权管理
- 未登录自动跳转 IDP 统一登录页；退出发起 end-session 全局单点登出

## 快速开始

```bash
dotnet run --project src/PandaAuth.Me             # http://localhost:9007（需 IDP 在 9004 运行）
cd frontend && npm install && npm run dev         # http://localhost:5172（API 代理 9007）
npm run build                                     # 产物落 BFF wwwroot/me
```

## Roadmap（Phase 2）

登录记录查询、设备/会话管理（含远程登出）、第三方授权管理、密码修改（触发全端令牌吊销）、MFA 绑定。
