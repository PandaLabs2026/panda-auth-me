# PandaAuth Me 回滚说明

## 适用范围

本文只覆盖 PandaAuth Me `me` 服务。发布入口和服务级失败回退规则见 [PandaAuth 部署手册](../../panda-auth/deploy/README.md)；已有密钥兼容说明见 [Me README](../README.md#production-state-keys-and-bridge-proxy)。

## 回滚边界

- 发布验证失败时，正式发布入口按服务粒度恢复 `me` 的 TAG、重建并探活；使用其回执确认结果。现行通用入口没有独立的人工 `--rollback` 参数，不要自行拼出命令或在生产 `.env` 中手改 pin。
- 对已成功发布的版本发起主动回退前，由 PandaAuth owning maintainer 确认兼容的目标镜像、客户端注册和发布方式。Me 镜像回退不恢复 IDP、Server 数据或数据库状态。
- 始终保留 Data Protection 目录及其中的 `client-keys.json`，并保持目录权限、属主和 Compose project 不变。不得为镜像回退删除或重建该目录/卷。
- 回到使用 ephemeral state keys 的旧镜像会使在途登录状态失效；用户需要重新发起登录。保留持久密钥可维持已有 key 验证能力，但不等于真实 IDP 登录链路已验收。

## 验收与证据

记录目标 Me 镜像 SHA、持久密钥目录是否保持、健康探活和登录状态影响；不要记录密钥内容、Token 或真实 env 值。
