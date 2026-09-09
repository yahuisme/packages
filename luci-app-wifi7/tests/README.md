# 本地回归测试

测试使用隔离协议数据，不连接路由器、不修改宿主网络。Node.js 测试需要外部安装的 jsdom 和目标 LuCI 源码。

```sh
export NODE_PATH=/path/to/node_modules
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
export LUCI_RPC="$LUCI_RESOURCE_DIR/rpc.js"
node tests/telemetry.test.js
node tests/lifecycle.test.js
node tests/mlo-runtime.cjs
node tests/mlo-editor.cjs
node tests/mlo-poll.cjs
node tests/mlo-integration.cjs
# 需要 gettext 的 msgfmt，以及 LuCI src/po2lmo（可用 PO2LMO 指定路径）
node tests/mlo-localization.cjs
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
node tests/lazy-regression.cjs
node tests/native-tabs.cjs
# 可选：TAB_OUT 导出四页真实 DOM，使用外部 Playwright 和原始 Aurora 文件测量
# TAB_OUT=/tmp/wifi7-tabs node tests/native-tabs.cjs
# TAB_OUT=/tmp/wifi7-tabs AURORA_HTDOCS=/path/to/aurora/htdocs \
# AURORA_HEADER=/path/to/aurora/ucode/template/themes/aurora/header.ut \
# AURORA_SHELL=/path/to/static-aurora-shell.html node tests/native-tabs-aurora.cjs
python3 tests/catalog.test.py
python3 tests/probes.test.py
python3 tests/test_summary_survey.py
node tests/survey-dom.cjs
```

覆盖 RPC 解包、MLO 链路、信号未知、计数边界、CAC 与占用率、表单校验、无变更保存、失败重试、国家变更刷新、只读权限及客户端节点保留。

采集测试用临时命令替身验证固定脚本拒绝参数、固件文本长度和周期采集不读取内核日志。翻译测试验证全部 JS 字符串、菜单和权限描述的 PO/POT 一致性。

集成测试保留真实顶层 `view` 自动构造/挂载生命周期，并以 `baseclass` 加载嵌入式 MLO，断言父页和四个页签未被覆盖；同时加载真实 LuCI `uci.js`、`rpc.js` 和 DOM 实现，仅以隔离 HTTP 数据替代路由器，覆盖 apply/confirm、数字错误码、失败后恢复旧值再提交等路径。预期权限失败用例可能输出 LuCI 的 RPCError 日志，以最终断言及退出码为准。

这些测试不替代固件构建、实机无线应用、客户端协商与真实性能测量。
