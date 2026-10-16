# /me 账户中心自助能力路线图

状态：识别稿（2026-10-16，用户反馈「缺少常规自助配置内容」后盘点）。下次进入 auth-me 开发时按此推进；逐项实施前在本文档打勾登记并按仓门禁走 PR/低风险通道。

## 现状盘点（2026-10-16）

已有：个人资料查看（name/nickname/email/roles 只读）+ 返回应用外链（AppHome*）；安全页 Passkey / TOTP / 恢复码 / 已注册因子 / 登出。
服务端已备而前端未暴露的表：`panda_external_identities`、`login_logs`、`panda_security_events`、`panda_email_verifications`。

## 差距清单（按价值排序）

### P1 · 高频自助（建议下个开发批先做）

| # | 能力 | 依赖与说明 |
|---|---|---|
| 1 | **昵称/显示名自助修改** | `panda_user_claims` 已有 nickname（session 已展示）。新增 `/me/api/profile` PUT；改名后各应用会话到下次刷新才更新（与 AppHome 契约同理，需在 UI 提示）。 |
| 2 | **邮箱变更（带验证）** | `panda_email_verifications` 表与服务端邮件链路已存在（注册/重置在用）。流程：申请变更 → 原邮箱+新邮箱双向确认 → 生效；Pending 期 UI 显示双邮箱状态。 |
| 3 | **登录历史 / 安全事件** | `login_logs`（含失败尝试，90 天保留）与 `panda_security_events` 已在写。只读列表 + 时间/IP/结果/UA 摘要；密级注意：只展示本人数据，IP 可考虑部分脱敏。 |
| 4 | **会话与设备管理** | me 已有 TokenRevocationClient（登出在用）。扩展：活跃会话列表（按 auth time/客户端/IP）+ 单会话吊销 + 全部吊销。需要 server 侧按 subject 枚举 reference token 的查询端点。 |

### P2 · 治理与合规（第二批）

| # | 能力 | 依赖与说明 |
|---|---|---|
| 5 | **外部身份绑定管理** | `panda_external_identities` 表已存在、server 有 `/account/external-identities`。列出已绑外部 IdP + 解绑（保底：至少保留一个可用登录方式，解绑前校验）。 |
| 6 | **已授权应用管理** | OpenIddict `Authorizations` 表。列出用户授权过的 OIDC 客户端（哪些应用能用我的账号）+ 撤销授权（联动吊销该应用令牌）。 |
| 7 | **个人数据导出** | 组合规需求：导出本人账号数据包（profile/登录历史/授权列表 JSON）。无删库风险，纯只读聚合。 |

### P3 · 远期 / 需产品裁定

| # | 能力 | 说明 |
|---|---|---|
| 8 | 头像 | IDP 目前无头像身份属性（hub NavUser 有 avatarUrl 位但无来源）。若立项：加 claim + 上传管线（大小/类型限制）+ 应用侧经 userinfo 取。**建议先裁定要不要头像作为身份属性**。 |
| 9 | 语言/时区偏好 | 存 IDP（claim）还是各应用自管，需先裁定归属（ADR-084 追记九的边界原则：身份属性进 IDP，应用偏好留应用）。 |
| 10 | 账号注销 | 高风险动作：级联数据处置策略（令牌/授权/审计保留）需法务与产品先定，再排期。 |

## 实施约定

- 全部走 me 现有模式：`/me/api/*` 端点 + antiforgery + 会话校验 + React 文本节点渲染（无 raw HTML）。
- 每项都先补 server 侧查询/变更端点（panda-auth-server 同批 PR），me 只做展示与编排。
- 敏感动作（吊销全部会话、解绑最后一个登录方式、撤销授权）一律二次确认（可复用模板 ConfirmAction 的交互语义）。
- 文案默认中文；`appHomeLabel` 式可配文案只用于部署语境差异，功能文案不配置化。
