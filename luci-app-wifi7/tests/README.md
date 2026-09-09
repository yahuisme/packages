# 本地回归测试

测试使用隔离协议数据，不连接路由器、不修改宿主网络。Node.js 测试需要外部安装的 jsdom 和目标 LuCI 源码。

```sh
export NODE_PATH=/path/to/node_modules
export LUCI_RPC=/path/to/luci/modules/luci-base/htdocs/luci-static/resources/rpc.js
node tests/telemetry.test.js
node tests/lifecycle.test.js
node tests/mlo-runtime.cjs
node tests/mlo-editor.cjs
node tests/mlo-poll.cjs
node tests/mlo-integration.cjs
node tests/view.test.js
NATIVE_TEST=1 node tests/view.test.js
MLO_TEST=1 node tests/view.test.js
DENIED_TEST=1 node tests/view.test.js
node tests/regression.test.js
NATIVE_TEST=1 node tests/regression.test.js
MLO_TEST=1 node tests/regression.test.js
READONLY_TEST=1 node tests/regression.test.js
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
node tests/integration.cjs
python3 tests/catalog.test.py
python3 tests/probes.test.py
```

覆盖 RPC 解包、MLO 链路、信号未知、计数边界、CAC 与占用率、表单校验、无变更保存、失败重试、国家变更刷新、只读权限及客户端节点保留。

采集测试用临时命令替身验证固定脚本拒绝参数、固件文本长度和周期采集不读取内核日志。翻译测试验证全部 JS 字符串、菜单和权限描述的 PO/POT 一致性。

集成测试加载真实 LuCI `uci.js`、`rpc.js` 和 DOM 实现，仅以隔离 HTTP 数据替代路由器，覆盖 apply/confirm、数字错误码、失败后恢复旧值再提交等路径。预期权限失败用例可能输出 LuCI 的 RPCError 日志，以最终断言及退出码为准。

这些测试不替代固件构建、实机无线应用、客户端协商与真实性能测量。
