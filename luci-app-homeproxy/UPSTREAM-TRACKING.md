# HomeProxy 上游核对记录

## 审查基线

- 来源：https://github.com/VIKINGYFY/packages.git
- 审查提交：`10393a5`、`3535ade`；本地初始基线：`f769a63`
- 仅选择性核对，不以两棵树的差异认定上游新增或删除了功能。

## 节点标签

- `3bef08a` 将生成器的标签注册改为内联遍历。
- 原 `createNodeOutboundTags()` 已包含同样的注册逻辑；此次变更不是新增标签冲突修复。此前“吸收修复”的表述不准确。

## URL 参数解码

- 保留原订阅解析器；撤回未提交的额外 `urldecode(params.host/path)` 以及无关 AnyTLS 改动。
- 查询参数在 URL 解析阶段已经解码，再解码会把 `/api?token=a%2Fb` 错改为 `/api?token=a/b`。
- Trojan 密码原本已有解码，不需要重复移植。
- 新增 Host 与密码单次解码测试；保留 HTTP、HTTP Upgrade、WebSocket 路径回归测试。

## 说明、翻译和权限

- 当前树与上游相比，中文翻译差异主要为本地 Dashboard、订阅操作文案、资源回滚提示及 PO 折行。
- 保留本地翻译和与实际回滚行为匹配的提示，不吸收纯折行变化。
- 保留 `dashboard_manage` 写权限；上游 ACL 不包含本地独立管理接口，不能覆盖。
- 本轮未发现需要新增移植的说明、翻译或权限修复。

## 保留策略

- 保留生命周期管理、测试、端口与 UCI 错误处理。
- 保留 IPv6 关闭时的 IPv4-only DNS/TUN 和 HTTPS DNS query。
- 保留 Dashboard 独立管理，不整包导入上游静态资源。

## 本轮验证

- 应用 Python 测试：23 项通过，含订阅解析 8 项。
- `.github/tests`：6 项通过。
- 前端分享链接测试通过。
- 订阅测试执行生产解析函数，解码及平台依赖使用测试边界；不代表实机网络验收。
- 未执行固件/IPK 构建。
