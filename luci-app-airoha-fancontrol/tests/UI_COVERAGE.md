# Fancontrol 中文 Aurora UI 覆盖

## 实测范围

`test_ui_coverage.js` 使用真实 LuCI DOM、UCI、form、validation、ui 模块；读取 LuCI base 与应用中文 PO，在 cbi.js 加载后建立原生 gettext 哈希表并逐条断言翻译。状态 RPC/UCI 仅使用明确的离线 fixture，不连接设备。

11 个阶段 × 6 宽度（320 / 390 / 768 / 1024 / 1440 / 1920）× 明暗主题 = **132 项**。

| 页面/阶段 | 实际覆盖 |
|---|---|
| 设置：自动/静音 | 原生模式与预设 select，依赖控件隐藏 |
| 设置：自动/平衡 | 同上 |
| 设置：自动/性能 | 同上 |
| 设置：自动/自定义 | 十个原生输入、第五 PWM 禁用、预览重算 |
| 设置：手动 | PWM 输入、自动预设/曲线隐藏 |
| 手动无效保存弹窗 | 999 输入，经真实 `Map.save()` 拒绝，原生中文保存错误弹窗 |
| 自定义无效保存弹窗 | 非递增温度，经真实 `Map.save()` 拒绝，中文错误与曲线提示 |
| 状态：自动 | 四摘要卡、七个温度值 |
| 状态：手动 | 硬件模式与配置相符 |
| 状态：不一致 | 完整中文“配置模式与硬件状态不一致” |
| 状态：不可用 | 缺失值显示破折号/读取失败，不编造零值 |

应用没有内部 Tab 或自定义新增/编辑弹窗；两个入口是独立状态和设置页面。错误由真实 LuCI 表单验证产生；本应用 Map 以 silent 模式调用原生 save，再用原生 ui.showModal 展示同一错误内容并传入专属 fan-settings-modal 类，不伪造验证或全局修改 UI。

### 保存错误弹窗回归

- 在修改生产代码前，新增几何断言真实失败：768px 下 modal left=-128、right=896、width=1024，document 并不溢出。
- 专项 16 项：两类错误 × 390/768/1024/1440 × 明暗，真实 272px 平板 sidebar；检查弹窗、正文、关闭按钮矩形均在视口，保存 modal-geometry.json 与截图。
- 另 8 项比较无关原生 modal 开启/移除应用 CSS 前后的矩形、字号、字体、padding、max-width，完全相同。
- test_settings_form.js 用真实 LuCI 验证两类错误、关闭/重开、Escape、silent 不替换无关弹窗、有效保存及 callback 转发，无全局 showModal/Map.save 修改。
- 状态页布局间距归整到 8pt，保留 96px 摘要最小高、8/16px padding、4px 行 gap；全部状态 CSS 限于 .fan-dashboard，图表尺寸/颜色/字号不改。48 项状态侧栏回归还检查真实 padding、温度标签和值分离、文字不裁切及 track 间距。

## 主题与视觉结果

- 使用 `/tmp/packages-fix-aurora` 的未修改 main.css、字体及 header.ut 非空白页主题脚本。
- 明暗模式在相反系统偏好下仍正确；另验证 device 模式随系统改变，断言计算背景色实际变化。
- 中文手机、平板、桌面截图实查：无缺字/标签控件重叠；桌面字段与预览双列、窄屏预览上置保持；保留原生控件与原有字段顺序。
- 控件测得通常 **34px 外高**（主题 32px 内容加边框），手机关闭按钮 38px。未为了精确 32px 覆盖全局主题。
- 摘要卡间距为 8px；图表文字 12px、线宽 1.5px，非缩放放大；保留原页留白及克制字号层次，未重做页面。
- 复现并修复：768/1024 中文状态卡把重要模式不一致说明省略。现在允许换行，全部矩阵中无省略/水平溢出。
- 修复 Aurora 缺少 `--cbi-*` token 时退回亮色边框/低对比灰字：优先兼容已有 cbi token，再取 Aurora hairline/text-muted。没有更改风扇业务、RPC、UCI 或预设。

## 证据

- `/tmp/fan-ui-coverage/results.json`：逐阶段宽度/主题/控件数量/高度/卡片几何/溢出及错误记录。
- `/tmp/fan-ui-coverage/sources.json`：应用源文件和 Aurora CSS SHA-256。
- `/tmp/fan-ui-coverage/*.html`：真实模块导出的阶段 DOM。
- `/tmp/fan-ui-coverage/{stage}-{390,768,1440}-{light,dark}.png`：66 张完整页面截图。
- 代表：`status-mismatch-768-dark.png`、`settings-custom-390-dark.png`、`settings-custom-1440-light.png`、`manual-invalid-modal-390-light.png`。
- 复用曲线专项：`/tmp/fan-curve-results.json`、`/tmp/fan-curve-shots/`；12 个宽度/主题项通过，含动态有效/无效恢复、ResizeObserver 清理。

## 复现

```sh
NODE_PATH=/usr/local/lib/node_modules:/tmp/packages-browser-qa/node_modules \
LUCI_RESOURCE_DIR=/tmp/mlo-luci/modules/luci-base/htdocs/luci-static/resources \
AURORA_DIR=/tmp/packages-fix-aurora node tests/test_ui_coverage.js
```

另外通过 `test_settings_form.js`、`test_status_dom.js`、`test_frontend.js`、`msgfmt --check`、`git diff --check`。Python unittest 17 项中 14 通过、3 real-tool 项跳过。

## 明确边界

这是离线浏览器验证，不是路由器实测。真实 Aurora CSS/字体/主题脚本配简化静态外壳：桌面预留侧栏宽度，但未启动路由菜单、页脚全局保存/应用工具条、UCI 自定义主题 token 或登录会话。设备原生下拉系统面板、实际保存应用/回滚倒计时、权限错误、RPC 断线、风扇硬件响应未在此矩阵执行。中文 catalog 使用原生 cbi 哈希查找，不把 PO 注入当作固件 LMO 部署验证。未 commit、push 或构建固件；其它包未改动。
