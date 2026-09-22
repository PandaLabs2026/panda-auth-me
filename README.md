# panda-auth-me

**PandaAuth by PandaLabs** · [English](README.en.md)

> 研发阶段，尚无正式受支持发行版；接入采用邀请或申请口径。已有实现不等于已完成发行验证。

## 职责与边界

PandaAuth 终端用户账户中心，由 .NET 10 BFF、OpenIddict.Client 7.7.0 与 React 19 前端组成。引用同级 [panda-auth-share](https://github.com/PandaLabs2026/panda-auth-share)，作为 Server 的第一方客户端 `me-web`，生产路径为 `/me`，监听 127.0.0.1:9007。

## 当前实现与限制

[后端](src/PandaAuth.Me/Program.cs)包含 OIDC challenge/回调、本地 Cookie、session、防伪退出及健康入口；[前端](frontend/src/pages/profile.tsx)有身份概览。登录记录、设备、授权管理、改密和 MFA 为占位或规划，不是已可用功能。

本地 [Auth 配置](src/PandaAuth.Me/appsettings.json)的默认回调已带 `/me/callback/login/{provider}` 所需的 `/me` 前缀（本地 `http://localhost:9007/me/callback/login/pandaauth`）；生产回调由 compose 注入（`Auth__Seed__Me__RedirectUris__*` / `__PostLogoutRedirectUris__*`），并由 Server 端 Seeder **upsert** 订正存量白名单。生产登录链路已验证到「IDP 渲染登录页」，并于 2026-09-17 通过脚本化 OIDC 全流程验证 userinfo、刷新、吊销和登出（回调带 `/me` 前缀、PKCE `S256`；篡改回调和登出后 refresh token 重放均有反向对照）。真实浏览器和本地 HTTPS 验收仍待补。Cookie 始终要求 Secure；不宣称全局所有客户端已经同步登出。

[Dockerfile](Dockerfile)以**工作区根目录**为构建上下文（项目依赖同级 Share，所以它不是「本仓上下文的自包含构建」；上下文过滤走同目录的 `Dockerfile.dockerignore`，本仓的 `.dockerignore` 对根上下文不生效）。运行阶段以非 root 的 `app` 用户（uid 1654）启动、带镜像级 `HEALTHCHECK`，并在镜像内预建、`chown` 了 DataProtection 密钥目录（该目录缺失或属 root 时应用会失败关闭）。该上下文已在生产构建出实际运行的 me 镜像。

## 前置条件与构建运行

需要 .NET SDK，版本选择见本仓 [global.json](global.json)（当前请求 10.0.112，允许 latestFeature roll-forward）。本仓可脱离私有元仓构建，但需将公开 Share 仓同级克隆。以下命令在本仓根目录执行；本轮仅静态核对命令，未执行构建或启动。

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
npm ci
npm run build
```

前端输出到 BFF `wwwroot/me`。后端入口是在本仓根目录执行 `dotnet run --project src/PandaAuth.Me`；当前开发监听 http://localhost:9007，健康路径 `/me/healthz`。前端在 `frontend` 执行 `npm run dev`，端口 5172；dev server 只把 BFF 实际拥有的路由（`/me/api`、`/me/login`、`/me/callback`、`/me/healthz`）代理到 9007，其余 `/me/*`（含 `@vite/client` 与源码）仍由 Vite 服务——代理整个 `/me` 前缀会把 HMR、模块图与源码调试一并打坏。完整本地运行步骤待回调/TLS/Issuer 配置验证后提供。

自助能力为 Phase 2 目标；当前登录闭环与构建/扫描门禁分别跟踪在 G04/G09，管理员和跨客户端安全边界见 G06。

## Roadmap 与治理

产品级路线图、发行门禁和社区/商业边界在正式公开发行前仍由维护者治理；本 README 只描述可独立复现的 Me 构建与运行边界。

- [安全政策](SECURITY.md)：选定私密报告渠道，启用状态未核验；不公开提交漏洞细节。
- [贡献指南](CONTRIBUTING.md)：本仓检查与统一贡献规则。
- [MIT License](LICENSE)：适用于自有代码和文档，具体范围见[许可说明](LICENSING.md)；第三方许可仍适用，品牌图片除外。
