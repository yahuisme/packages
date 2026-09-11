# NPU UI 覆盖清单

## 当前界面与样式

- Status：原生页面标题/说明、四个摘要、CPU 频率图和 SoC/NPU 详情。Settings：原生页面标题/说明、三个真实 LuCI 控件、未知流控只读、原生页脚和无修改/成功/恢复无法验证通知。
- 状态 CSS 全部限定于 `.npu-dashboard`，包括逗号分组与 media 规则；style 随根节点移除。摘要外间距、详情面板外间距/桌面内边距及行间横向间距为 16px；详情行内边距、分组标题间距和手机面板内边距为 8px。详情网格按实际可用宽度自适应，避免 Aurora 平板侧栏下两列挤压完整状态。
- 保留摘要 96px 最小高度、8px 16px padding、4px gap、1.125em/600 中值的既定例外；保留 6px 圆角、1px 边框及图表坐标，不把这些非布局值机械改成 8 的倍数。标题与普通文本跟随主题，无独立 14px/500 标题规则。
- CPU 图高 200px、刻度 12px、线宽 1.5px；绿色 `#22a06b` 阶梯与同色 0.10 透明面积。null/漏采样分段，不跨段填充。字体/坐标/真实数据行为不因布局收敛改变。
- 中文使用真实包内 PO 与上游 base.po，经现有 `po2lmo` 编译为 LMO，加载哈希索引到 `window.TR`，在 `cbi.js` 后使用原生 `_()`，不是字符串替身翻译。

## 行为覆盖

- CPU 最快 3 秒请求一次；每秒检查 deadline，firewall/offload 最快 6 秒一次，`getInfo` 仅初始加载。CPU RPC 设置 `nobatch: true`，CPU 与 flow 使用独立 single-flight guard；poll 不返回 flow promise。真实 LuCI `poll.step()` 验证挂起 flow 时 CPU 仍连续采样、flow 不重复请求；挂起 CPU 本身不生成替代样本。
- 前值阶梯绘制仅表示有效读数之间的保持；最新有效值最多向当前时间保持 3 秒，不新增 samples。null、无效读数和间隔 >=4.5 秒断线/断面积；120 秒历史在请求挂起时仍过期。detach/pagehide 清理 poll、计时器和观察器。
- `test_dom.js` 使用真实 LuCI DOM/RPC/poll，覆盖提前 1ms 的 scheduler、3s/6s 次数、失败/未知、短暂保持、null/漏采样分段、独立挂起、过期和清理。故意注入 RPCError 是负例，不代表整套测试失败；以最终 PASS 和退出码为准。
- `test_settings_form.js` 使用真实 LuCI form/widget/footer Save click，覆盖初始三个值、未知流控只读、无修改不写、成功和失败通知。真实 `Map.reset()` 在成功/失败后保持最近确认基线，保留唯一局部 style；reset 后再 Save 不会撤销成功设置。`test_settings.js` 另覆盖完整 undo、读回验证与恢复失败区分（该测试使用轻量 form stub）。
- `test_chart_mount.js` 在 Chromium 执行实际状态视图 render/生命周期和 LuCI DOM，冻结 interval，覆盖首帧、重新进入、容器/视口 resize、无 ResizeObserver fallback、detach/pagehide。共 30 条测量记录，并非 30 个独立页面。

## Aurora 矩阵与复现

`test_chart_layout.js` 每种语言覆盖 6 个状态 × 5 个宽度（320/390/768/1024/1440）× 明暗主题，共 60 个组合：status、settings、settings-unknown、settings-saved、settings-noop、settings-failed。

验证实际 Aurora CSS/字体/侧栏模板和当前源码导出的 DOM；断言浏览器/资源无错误、无文档横向溢出、三个 **select 控件本身** 和原生页脚按钮有尺寸且在视口内、通知与关闭按钮容纳、图表刻度及线宽、局部 CSS 作用域与无关同名 sibling 不受影响、8pt 间距/摘要例外，以及 fixture 详情值没有省略截断。不是仅检查 `.cbi-value` 行高度。

```sh
cd /root/packages/luci-app-airoha-npu
export NODE_PATH=/usr/local/lib/node_modules
export LUCI_RESOURCE_DIR=/tmp/mlo-luci/modules/luci-base/htdocs/luci-static/resources
export AURORA_DIR=/tmp/packages-fix-aurora
# 如果 playwright 不在 NODE_PATH，设置 PLAYWRIGHT_MODULE 为其实际模块路径。
export NPU_ZH=1
export NPU_LAYOUT_DIR=/tmp/npu-zh-verified
mkdir -p "$NPU_LAYOUT_DIR"
NPU_DOM_EXPORT="$NPU_LAYOUT_DIR/npu.dom.html" node tests/test_dom.js
NPU_SETTINGS_EXPORT="$NPU_LAYOUT_DIR/settings" node tests/test_settings_form.js
node tests/test_chart_layout.js
# mount 专项为英文/浅色、隔离传输与定时器，不属于中文明暗矩阵。
unset NPU_ZH
node tests/test_settings.js
node tests/test_chart_mount.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
msgfmt --check -o /dev/null po/zh_Hans/luci-app-airoha-npu.po
git diff --check -- .
```

英文布局需在 unset NPU_ZH 后重新导出至不同目录，再运行 chart_layout。每目录的 `layout-results.json`、`manifest.json` 和截图绑定源码/DOM/CSS/PO；任何源代码修改后必须重新导出并重跑，不能沿用旧证据。最近一次最小样式修正的仓库外证据在 `/root/packages-fix-npu-evidence/`，运行记录见 `runs.json`，确切结果/边界见 `/root/packages-fix-npu-report.md`。

## 验证边界

离线真实 DOM/CSS/原生中文翻译/浏览器几何及 jsdom 保存/reset 交互，不是部署到真机。导出 HTML 不保留事件；浏览器布局矩阵不能代替真实 form 测试。浏览器原生下拉展开、Save & Apply/强制应用执行、Reset 页脚按钮 click、完整导航和设备写入未验证（`Map.reset()` 已实际执行，不再列为未测）。状态矩阵使用明确 fixture，并非硬件历史或所有未知/错误状态的独立截图；长任意固件路径仍使用已有省略策略。

后端测试使用临时 NPU_ROOT、UCI/jsonfilter 工具或 fixture、firewall reload stub；没有实际硬件读写/防火墙应用验证。未测真机 RPC 成本、驱动、加速流量、设备级并发/断电恢复。不提交、推送或构建。
