# 回归测试

需要 Node.js、Python 3、jsdom 和 LuCI 源码。依赖安装在软件包外，测试不会打包到固件。

```sh
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
export NODE_PATH=/path/to/node_modules
node luci-app-mlo/tests/runtime.cjs
node luci-app-mlo/tests/editor.cjs
node luci-app-mlo/tests/poll.cjs
node luci-app-mlo/tests/integration.cjs
python3 luci-app-mlo/tests/test_catalog.py
node --check luci-app-mlo/htdocs/luci-static/resources/view/mlo.js
```

- `runtime.cjs`：使用真实 RPC 回包处理，验证错误、部分失败、自定义接口名和去重。
- `editor.cjs`：使用真实 GridSection 新增/取消方法，验证取消与失败清理、安全默认值、只读和配置保护。
- `poll.cjs`：验证首次单次请求、并发刷新合并、静态 DOM 保持和错误状态。
- `integration.cjs`：通过 `luci-dom.cjs` 加载完整 LuCI DOM、表单、校验和 UI 实现，测试真实控件的编辑、保存、取消、AP/STA 切换与 PMF。
- `test_catalog.py`：验证中文完整覆盖、POT/PO 一致、无废弃条目。

LuCI 源码必须可信。UCI 和 RPC 后端使用隔离数据，不连接路由器；这些测试不替代固件构建、实机配置应用或客户端 MLO 协商验证。
