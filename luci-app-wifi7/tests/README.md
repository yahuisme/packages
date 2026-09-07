# 本地回归测试

测试数据为人工构造的协议夹具，不是实机抓取数据。

```sh
node tests/telemetry.test.js
```

页面测试需要 Node.js、外部安装的 `jsdom`，以及目标 LuCI 的原始 `rpc.js`。不把开发依赖安装到固件包中。

```sh
export LUCI_RPC=/path/to/luci/modules/luci-base/htdocs/luci-static/resources/rpc.js
# jsdom 安装在外部目录时通过 NODE_PATH 指向其 node_modules
node tests/view.test.js
NATIVE_TEST=1 node tests/view.test.js
MLO_TEST=1 node tests/view.test.js
DENIED_TEST=1 node tests/view.test.js
```

覆盖原生 RPC 解包和速率、MLO Link 7 的频率映射、逐天线 RSSI、CAC 状态、占用率刻度、权限错误、当前配置显示、表单标签与非法功率阻止提交。
