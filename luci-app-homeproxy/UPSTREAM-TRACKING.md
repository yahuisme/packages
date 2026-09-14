# HomeProxy 上游吸收跟踪

## 2026-09-14

- 上游：`https://github.com/VIKINGYFY/packages.git`
- 上游基线：`FETCH_HEAD`，审查提交 `10393a5`、`3535ade`
- 本地基线：`f769a63`
- 处理方式：选择性移植，未整体同步

### 已吸收

- `generate_client.uc`
  - 使用 `createNodeLabelRegistry()` 与 `reserveUniqueLabel()` 生成节点 outbound 标签。
  - 避免节点标签与保留标签、其他节点标签发生冲突。

### 明确保留本地实现

- `lifecycle.js` 及现有 LuCI 生命周期修复
- 资源、Dashboard、reload、runtime-init、分享链接和订阅解析测试
- fail-closed 的随机端口、UCI 写入和提交错误处理
- IPv6 关闭时的 `ipv4_only` DNS 与 IPv4-only TUN
- HTTPS DNS URL query 保留逻辑
- Dashboard 独立管理及当前 ACL
- 本地证书/域名列表事务写入修复

### 未吸收原因

- 上游同步会删除测试和生命周期代码。
- 上游放宽错误处理，可能把端口或 UCI 写入失败报告为成功。
- 上游 IPv6/TUN 行为与本地已验证基线冲突。
- 上游 DNS query 处理会丢失 HTTPS DNS 参数。
- 上游大规模捆绑 Dashboard 静态资源，不符合当前独立管理策略。
- 上游订阅解析调整存在默认端口、密码校验和编码兼容性风险，未满足当前回归证据要求。

### 验证

- `git diff --check`：通过
- `.github/tests`：6/6 通过
- 未执行固件/IPK 构建
- 未 push、未触发构建
