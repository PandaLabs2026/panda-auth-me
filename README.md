# panda-auth-me

**PandaAuth by PandaLabs** · [English](README.en.md)

> 研发阶段，尚无正式受支持发行版；接入采用邀请或申请口径。已有实现不等于已完成发行验证。

## 职责与边界

PandaAuth 终端用户账户中心，由 .NET 10 BFF、OpenIddict.Client 7.7.0 与 React 19 前端组成。引用同级 [panda-auth-share](https://github.com/PandaLabs2026/panda-auth-share)，作为 Server 的第一方客户端 `me-web`，生产路径为 `/me`，监听 127.0.0.1:9007。

## 当前实现与限制

[后端](src/PandaAuth.Me/Program.cs)包含 OIDC challenge/回调、本地 Cookie、session、防伪退出及健康入口；[前端](frontend/src/pages/profile.tsx)有身份概览。登录记录、设备、授权管理、改密和 MFA 为占位或规划，不是已可用功能。

本地 [Auth 配置](src/PandaAuth.Me/appsettings.json)的默认回调已带 `/me/callback/login/{provider}` 所需的 `/me` 前缀（本地 `http://localhost:9007/me/callback/login/pandaauth`）；生产回调由 compose 注入，端到端登录闭环待生产回归证据。Cookie 始终要求 Secure。HTTP 启动与配置默认值不能作为经过验证的登录闭环。生产 compose 中的 Issuer、回调/登出组合也需要一致性验证；不宣称全局所有客户端已经同步登出。

[Dockerfile](Dockerfile)目前使用本仓上下文，但项目依赖同级 Share；这一构建缺口尚未修复，不能称为已可用自包含镜像构建。

## 前置条件与构建运行

需要 .NET SDK，版本选择见本仓 [global.json](global.json)（当前请求 10.0.112，允许 latestFeature roll-forward）。七仓按[工作区布局](https://github.com/PandaLabs2026/panda-auth/blob/main/WORKSPACE.md)同级克隆，跨仓链接需要对应访问权限。以下命令在本仓根目录执行；本轮仅静态核对命令，未执行构建或启动。

需要同级 Share、Node 24 与 npm。登录验证还需要可用 IDP、匹配的 me-web 注册与密钥、Issuer、回调/登出地址和本地 HTTPS。先处理上述阻断，不能通过弱化 Cookie 安全要求来把文档写成一键可用。

源码构建入口（不代表 OIDC 登录验证通过）：

```bash
dotnet build PandaAuth.Me.slnx
cd frontend
npm ci
npm run build
```

前端输出到 BFF `wwwroot/me`。后端入口是在本仓根目录执行 `dotnet run --project src/PandaAuth.Me`；当前开发监听 http://localhost:9007，健康路径 `/me/healthz`。前端在 `frontend` 执行 `npm run dev`，端口 5172，API 代理到 9007。完整本地运行步骤待回调/TLS/Issuer 配置验证后提供。

自助能力为 Phase 2 目标；当前登录闭环与构建问题分别跟踪在 G04/G09，管理员和跨客户端安全边界见 G06。

## Roadmap 与治理

实现目标见[能力矩阵](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/open-source/capabilities.md)与[发布门禁](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/open-source/release-readiness.md)。实际业务需求驱动路线图，社区请求按方向和维护成本评估，不承诺交付。[社区/商业边界](https://github.com/PandaLabs2026/panda-auth/blob/main/docs/open-source/strategy.md)表示能力归属，不代表商业模块已经交付。

- [安全政策](SECURITY.md)：选定私密报告渠道，启用状态未核验；不公开提交漏洞细节。
- [贡献指南](CONTRIBUTING.md)：本仓检查与统一贡献规则。
- [MIT License](LICENSE)：适用于自有代码和文档，具体范围见[许可说明](LICENSING.md)；第三方许可仍适用，品牌图片除外。
