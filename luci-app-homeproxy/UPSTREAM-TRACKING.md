# HomeProxy 上游核对记录

## 审查基线

- 来源：https://github.com/VIKINGYFY/packages.git
- 审查提交：`10393a5`、`3535ade`；本地初始基线：`f769a63`
- 仅选择性核对，不以两棵树的差异认定上游新增或删除了功能。

## 最新核对

- 核对时间：2026-09-14 22:21 HKT
- 上游提交：`1acb468`
- 本次核对未发现后续 HomeProxy 增量。

## 吸收更新

- `1acb468`：订阅更新移除当前普通主节点时，自动切换到首个可用节点；不存在可用节点时设为 `nil`。

## 忽略更新

- `10393a5`：说明、翻译与权限调整不直接同步。保留本地 Dashboard 独立管理、`dashboard_manage` 写权限，以及与实际事务回滚一致的中文文案。

## 自主修改

- 服务生命周期、端口初始化与 UCI 写入失败处理，并以回归测试约束失败恢复路径。
- IPv6 关闭时固定使用 IPv4-only DNS/TUN，保留 HTTPS DNS query。
- Dashboard 不随软件包预置；仅支持独立安装、更新与移除。
- 节点标签生成保持现有注册逻辑；`createNodeOutboundTags()` 原已覆盖相同能力，不将其误记为上游修复。
- URL 参数只解码一次，防止将 `/api?token=a%2Fb` 误改为 `/api?token=a/b`；覆盖 Host、密码及 HTTP、HTTP Upgrade、WebSocket 路径。
