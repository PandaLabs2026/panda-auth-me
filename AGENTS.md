# panda-auth-me 协作规则

## 职责与边界

本仓是 PandaAuth 终端用户账户中心，包含 .NET BFF 与 React 前端；生产路径 `/me`，作为 Server 注册的第一方客户端使用 OIDC。容器镜像默认监听 `127.0.0.1:9007`；生产监听以 `../panda-auth/deploy/README.md` 为准，当前登记为 `127.0.0.1:6002`。不得把容器默认端口当作生产端口。跨仓发布见 `../panda-auth/AGENTS.md`、`../panda-auth/WORKSPACE.md` 和 `../panda-auth/deploy/README.md`。

## 跨仓来源与安全

- OIDC callback、logout、Cookie、session 或 antiforgery 改动，必须同时核对 Server 注册白名单、`../panda-auth-share/` 契约与元仓 Caddy `/me` 路由；不能只改本仓配置。
- 浏览器不保存 Access/refresh token；Cookie 必须保持 Secure，写操作遵守 IDP antiforgery 契约，不以放宽边界换取本地可用。
- 前端生成物由 `frontend/vite.config.ts` 输出到 `src/PandaAuth.Me/wwwroot/me/`；禁止手工改写或提交构建残留。品牌资产按元仓管线处理。
- 不提交密码、Token、私钥、真实连接串、env 内容或真实生产回调配置。

## 验证

从本仓根目录运行：

```bash
dotnet build PandaAuth.Me.slnx
dotnet test tests/PandaAuth.Me.Tests/PandaAuth.Me.Tests.csproj
(cd frontend && npm ci && npm run build)
git diff --check
```

solution、测试项目及前端 `package.json` / `package-lock.json` 均存在。跨仓 ProjectReference 需要同级 `../panda-auth-share/`。本地 OIDC 流程另需可用 IDP 与本地 HTTPS，尚未完成登录闭环验证时不得据构建成功推断认证链路已验收。
