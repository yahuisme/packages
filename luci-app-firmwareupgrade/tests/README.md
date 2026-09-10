# 固件升级回归测试

```sh
PYTHONDONTWRITEBYTECODE=1 UCI_BIN=/tmp/packages-fan-upgrade-audit/uci JSONFILTER_BIN=/tmp/packages-final-jsonfilter/jsonpath python3 -m unittest discover -s luci-app-firmwareupgrade/tests -v
NODE_PATH=/usr/local/lib/node_modules node luci-app-firmwareupgrade/tests/test_frontend.js
NODE_PATH=/usr/local/lib/node_modules LUCI_RESOURCE_DIR=/tmp/mlo-luci/modules/luci-base/htdocs/luci-static/resources node luci-app-firmwareupgrade/tests/test_rpc.js
NODE_PATH=/usr/local/lib/node_modules AURORA_CSS=/tmp/packages-fix-aurora/htdocs/luci-static/aurora/main.css node luci-app-firmwareupgrade/tests/test_layout.js
```

运行时使用真实 BusyBox ash、UCI、jsonfilter；临时副本仅改写绝对路径，curl/sysupgrade 为隔离边界，不进行真实刷写。通用规则覆盖分页（后页发布时间更新）、HTTP 中途失败、空镜像发布回退、歧义、未知设备、非法镜像、设置持久化、候选与规则/代理绑定；原有 SHA256、大小、预检、锁、握手、一次消费及 UCI 回滚测试保留。

正文 Tab 回归逐字节验证 JSON 输出 `\t` 并解析真实隔离 RPC 响应。前端 jsdom 执行实际视图回调，以延迟 Promise 覆盖检查/保存期间编辑、旧响应丢弃、重复及交叉请求串行、当前版本保存恢复；RPC 测试加载真实 LuCI 模块。布局测试使用实际视图生成的 DOM 与未改动 Aurora main.css，Chromium 测量 320/375/768/1024/1440 宽度、明暗属性共十种状态，断言页面/输入不溢出及输入高度 32px。结果与截图在 `/root/fwup-layout`，可用 `LAYOUT_OUT` 改写。此为离线简化页面外壳，未覆盖真实路由器菜单、网络、权限、完整主题切换脚本或刷写兼容性。依赖可持久安装 `npm install -g jsdom playwright` 与 `playwright install chromium`，无需每次安装。

## 真实 fixtures

已有 yahuisme 两个 W1700K Release 列表与解包版本文件沿用此前真实 API/镜像捕获，验证同名文件标准/OC 不串线。新增 `w1700k-builds-releases.json` 来自 2026-09-10 `/repos/w1700k/builds/releases?per_page=20`，仅保留 tag_name/published_at/draft/prerelease/assets 及资源 name/size/digest/browser_download_url；实际捕获三条发布，标准/OC 测试验证各自真实摘要。


代理实测：`https://gh-proxy.com/https://api.github.com/repos/w1700k/builds/releases?per_page=1` HTTP 200 有效 JSON；对捕获的 W1700K GitHub 原始镜像 URL 加此前缀、Range `0-31` 得到 HTTP 206 与 32 字节。未发送 Token，未下载完整固件。应用明确只让 worker 镜像下载使用代理，Release 检查仍直连 API。

ACL 已有 saveSettings 写权限与 firmwareupgrade UCI 权限覆盖新增字段；新增字段在 RPC list schema 中明确列出，无需扩张 ACL。未知板型规则不替代 sysupgrade -T 的最终判断。没有进行包构建或实机刷写。

`ones20250-ax6600-releases.json` 为 GitHub API 捕获的前四条发布的必要字段，包含 PURE/PLUS 及 factory/sysupgrade；验证两系列最新镜像及候选地址、大小、摘要。该精简样本不用于分页覆盖。

`external-release-subsets.json` 从本次真实 API 捕获的 `ZqinKing/wrt_release` 与 `breeze303/openwrt-ci` 列表精简，仅保留 MX4200v2、京东云 NOWIFI/WIFI 各一条发布及一个镜像的必要原始字段（2331 字节）；明确不是完整分页样本。分页回归独立合成 20 条发布 + `[]`（含 JSON 空白），验证保留前页候选；第一页空数组返回无匹配并清候选。非法 JSON、对象、尾随垃圾、非法空白及 HTTP 失败不得作为分页结束或保留候选。真实 jsonfilter 的 `@[*]` 对 `[]` 返回 1，不能单凭退出码将合法空页判为解析失败。
