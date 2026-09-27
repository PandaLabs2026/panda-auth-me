# panda-auth-me 协作规则

PandaAuth 终端用户账户中心，生产路径 `/me`，BFF 监听 127.0.0.1:9007；作为 Server 注册的第一方客户端使用 OIDC。跨仓发布以 `../panda-auth/AGENTS.md`、`WORKSPACE.md` 和 `deploy/README.md` 为准。

- OIDC callback、logout、Cookie、session 和 antiforgery 改动必须同时核对 Server 注册白名单与 Caddy `/me` 路由；不能只改本仓配置。
- 浏览器不保存 Access/refresh token；Cookie 必须保持 Secure，写操作遵守 IDP antiforgery 契约，不以放宽安全边界换取本地可用。
- 共享端点/Claim 使用同级 `../panda-auth-share/`；不提交密码、Token、私钥、env 内容或真实生产回调配置。
- 验证：`dotnet build PandaAuth.Me.slnx`、`dotnet test tests/PandaAuth.Me.Tests/PandaAuth.Me.Tests.csproj`（如存在）、`(cd frontend && npm ci && npm run build)` 和 `git diff --check`。
