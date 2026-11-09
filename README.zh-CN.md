# panda-auth-me

**PandaAuth by PandaLabs** · [English](README.md)

**官方主页 [pandalabs.cc](https://pandalabs.cc/products/panda-auth/)** · 中文官网 [pandalabs.cn](https://pandalabs.cn/products/panda-auth/) · [PandaLabs 产品矩阵](https://pandalabs.cc/products/)

> PandaAuth 套件当前为 **Community Preview 0.2.0-preview.1**：已部署生产、面向早期社区试用；稳定版 Community Release 1.0.0 尚未发布。接入采用邀请或申请口径。

## 职责与边界

PandaAuth 终端用户账户中心，由 .NET 10 BFF、OpenIddict.Client 7.7.0 与 React 19 前端组成。引用同级 [panda-auth-share](https://github.com/PandaLabs2026/panda-auth-share)，作为 Server 的第一方客户端 `me-web`，生产路径为 `/me`，监听 127.0.0.1:9007。

前端基于 [panda-webapp-template](https://github.com/PandaLabs2026/panda-webapp-template)（v0.5.2 首采，2026-10-16）：模板正典件（`ui/`、`patterns/`、`lib/i18n|notify`、`hooks/`、`typeset.css`）零改动拷贝，应用渲染在模板 AppLayout 内（侧栏导航 账户总览/安全设置、NavUser 承载 BFF 登出、命令面板、`SessionGate` 组合正典 `auth/AuthBoundary`、403/500/404 错误页、阅读宽度 `contentClassName`）。应用身份留在令牌层（PandaAuth 钢蓝主题、`index.html` 默认浅色）与两个 API 面：`/me/api/*`（会话/防伪/登出，`X-XSRF-Token`）在 `lib/auth.ts`，IDP `/account/mfa/user/*` 同源直连客户端在 `lib/mfa-api.ts`（`RequestVerificationToken`）。敏感 MFA 操作由 `security.tsx` 自建确认对话框 + 全局 notify；step-up 提示保持页内常驻（5 分钟窗口语境需持续可见）。本应用**就是** IDP `/me` 账户入口契约的本体，自身会话的 `accountEntryUrl` 恒空。

模板对齐（v0.6.20，`c8e265e10ada01808837ab503f4ce5d070fa5e43`）：经模板官方管线应用两个登记同步项——`auth-ui-source.json`（auth-experience，自 v0.6.18 起）与 `app-shell-ui-source.json`（app-shell：AppLayout/NavUser/sidebar/DataTable/MetricCard/PageHeader/ErrorBoundary/DataState/CommandPalette 字节正典，并新增 ContextPanel+guard，含 220px 桌面宽度与 2px 菜单间距）。AppLayout 为字节正典：品牌走 `brand` 插槽、侧栏分组标题走原生 `navigationLabel` 契约、模板版本页脚保持关闭（showcase 专用 opt-in）。BFF 登出失败提示移入应用自有 `useLogout`（`lib/auth.ts`），正典裸 `logout.mutate()` 调用保留失败反馈。个人资料与 MFA/安全流程沿用既有页面与授权交互；不含合适的独立对象详情工作流。

## 当前实现与限制

[后端](src/PandaAuth.Me/Program.cs)包含 OIDC challenge/回调、本地 Cookie、session、防伪退出及健康入口；[前端](frontend/src/pages/profile.tsx)有身份概览，[安全设置页](frontend/src/pages/security.tsx)可自助管理 TOTP/恢复码（直连同源调用 IDP 的 `/account/mfa/user/*`，写操作经 IDP antiforgery 令牌；Passkey 已随 AUTH-DELIVERY-002 退役——特敏感操作须单次 TOTP+密码操作授权，存量 Passkey 行可撤销）。登录记录、设备、授权管理和改密仍为占位或规划。

本地 [Auth 配置](src/PandaAuth.Me/appsettings.json)的默认回调已带 `/me/callback/login/{provider}` 所需的 `/me` 前缀（本地 `http://localhost:9007/me/callback/login/pandaauth`）；生产回调由 compose 注入（`Auth__Seed__Me__RedirectUris__*` / `__PostLogoutRedirectUris__*`），并由 Server 端 Seeder **upsert** 订正存量白名单。生产登录链路已验证到「IDP 渲染登录页」，并于 2026-09-17 通过脚本化 OIDC 全流程验证 userinfo、刷新、吊销和登出（回调带 `/me` 前缀、PKCE `S256`；篡改回调和登出后 refresh token 重放均有反向对照）。真实浏览器和本地 HTTPS 验收仍待补。Cookie 始终要求 Secure；不宣称全局所有客户端已经同步登出。

[Dockerfile](Dockerfile)以**工作区根目录**为构建上下文（项目依赖同级 Share，所以它不是「本仓上下文的自包含构建」；上下文过滤走同目录的 `Dockerfile.dockerignore`，本仓的 `.dockerignore` 对根上下文不生效）。运行阶段以非 root 的 `app` 用户（uid 1654）启动、带镜像级 `HEALTHCHECK`，并在镜像内预建、`chown` 了 DataProtection 密钥目录（该目录缺失或属 root 时应用会失败关闭）。该上下文已在生产构建出实际运行的 me 镜像。

## 私有资料编辑（显式开启）

`/me/profile` 通过 `/me/api/profile` 编辑当前用户的名称、简介、头像和独立验证的联系邮箱。写操作使用 BFF 防伪令牌及 Server revision；版本冲突保留草稿，由用户重新读取后确认。登录邮箱、凭据、角色、组织受众和公开资料各有独立拥有方。

Me 的 `Profile:Enabled` 默认关闭。开启后展示入口，并在新的登录中请求委托 `profile.read`/`profile.write`；须先准备 Server schema、私有资料 API 及明确的 Me 客户端登记。t0000/Fleet 发布与验收准备以[拥有方资料契约](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/contracts/self-profile-v1.md)及 [Auth #322](https://github.com/PandaLabs2026/panda-auth/issues/322) 为准。源码测试及合成浏览器夹具不授予生产启用权限。

## 前置条件与构建运行

需要 .NET SDK，版本选择见本仓 [global.json](global.json)（当前请求 10.0.112，允许 latestFeature roll-forward）。本仓可脱离私有元仓构建，但需将公开 Share 仓同级克隆。以下命令在本仓根目录执行。

```bash
git clone https://github.com/PandaLabs2026/panda-auth-me.git
git clone https://github.com/PandaLabs2026/panda-auth-share.git
cd panda-auth-me
```

需要同级 Share、Node 24 与 npm。登录验证还需要可用 IDP、匹配的 me-web 注册与密钥、Issuer、回调/登出地址和本地 HTTPS。先处理上述阻断，不能通过弱化 Cookie 安全要求来把文档写成一键可用。

源码构建入口（不代表 OIDC 登录验证通过）：

```bash
dotnet build PandaAuth.Me.slnx
cd frontend
npm run deps:ci
npm run build
```

前端输出到 BFF `wwwroot/me`。后端入口是在本仓根目录执行 `dotnet run --project src/PandaAuth.Me`；当前开发监听 http://localhost:9007，健康路径 `/me/healthz`。前端在 `frontend` 执行 `npm run dev`，端口 5172；dev server 只把 BFF 实际拥有的路由（`/me/api`、`/me/login`、`/me/callback`、`/me/healthz`）代理到 9007，其余 `/me/*`（含 `@vite/client` 与源码）仍由 Vite 服务——代理整个 `/me` 前缀会把 HMR、模块图与源码调试一并打坏。完整本地运行步骤待回调/TLS/Issuer 配置验证后提供。

个人资料与 MFA 因子自助管理（TOTP、恢复码；Passkey 已于 2026-10 退役，存量行可撤销）已实现；管理员和跨客户端安全边界由 Server 侧强制执行。

## Roadmap 与治理

产品级路线图、发行门禁和社区/商业边界在正式公开发行前仍由维护者治理；本 README 只描述可独立复现的 Me 构建与运行边界。

- [安全政策](SECURITY.md)：选定私密报告渠道，启用状态未核验；不公开提交漏洞细节。
- [贡献指南](CONTRIBUTING.md)：本仓检查与统一贡献规则。
- [MIT License](LICENSE)：适用于自有代码和文档，具体范围见[许可说明](LICENSING.md)；第三方许可仍适用，品牌图片除外。
