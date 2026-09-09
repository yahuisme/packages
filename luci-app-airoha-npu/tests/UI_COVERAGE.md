# NPU UI 覆盖清单

## 最终覆盖与改动

- Status：四个摘要、CPU 频率图、SoC/NPU 详情；Settings：三个真实 LuCI 控件、未知流控只读、原生页脚保存/保存并应用/复位，以及无修改、成功、恢复无法验证三种原生 notification。
- 真实包内 PO 与上游中文 base.po 经 `po2lmo` 编译，加载 LMO 哈希索引到 `window.TR`，在 `cbi.js` 后使用原生 `_()`。发现 `Max limit: ` 尾空格被原生 lookup 规范化而漏译；同步源码/PO/POT 改为无尾空格 key，最终截图为“上限: 1200 MHz”。不是字符串替身翻译。
- 最终中英各 60 个组合：6 个独立页面状态 × 320/390/768/1024/1440px × 明暗主题，共 120 个真实 Aurora CSS/字体/侧栏模板 + LuCI DOM + Chromium 几何案例。无文档横向溢出，无 page/resource error；三个控件和页脚按钮有非零尺寸且在视口内；中文通知、关闭按钮正常换行。
- CPU 图高 200px、刻度 12px、细线 1.5px；绿色 `#22a06b` 阶梯与同色 0.10 透明面积，无渐变。填充位于网格下方，每段各自闭合到零基线；null/漏采样不跨段填充。普通点半径 1，孤立真实点半径 2。图表/详情标题统一 14px、500 字重；保持原页面结构。
- 已通过 vision 查看最终中文 390px 浅色、1440px 暗色阶梯图，以及 320px 失败通知/保存按钮：无明显错位或截断。未增加页面大标题或装饰。

## 采样与行为边界

用户后续明确授权 CPU 从 5 秒改为 3 秒；保留此前每秒检查 deadline 的调度抖动修复，CPU RPC 最快 3 秒一次，firewall/offload 最快 6 秒一次（没有跟随 CPU 提频），`getInfo` 仅加载时调用。真实 LuCI scheduler 夹具验证首轮加载加两次 CPU 刷新期间 getStatus 共 3 次、getFlowOffload 共 2 次。

审查后端 `get_status()`：只读若干 sysfs/debugfs 字段、在线 CPU 列表 awk 计数与 NPU 驱动 symlink glob；无 PPE 表扫描、UCI、固件 strings 或防火墙 reload。未改后端，未测真机 RPC 用时/CPU 开销。

正常有效读数之间按前值阶梯绘制；最新有效值最多向当前时间保持 3 秒，仅改路径不添加 samples。超过 3 秒停止延展；null、无效读数和间隔 >=4.5 秒断线、面积断开。CPU 回包立即采样/清空失败指标，不等待挂起的 flow；整组传输 settle 前仍不释放防重叠 guard，所以长期挂起 flow 可能阻止后续 CPU 请求，这是诚实缺口而非伪造连续。120 秒历史保留，3 秒夹具满窗最多 41 个真实读数；挂起期间照常过期至空，离开根节点/pagehide 清理计时器与 poll。

行为测试覆盖：真实 scheduler 提前 1ms、3s/6s RPC 次数、阶梯路径、无伪造样本、短暂保持及超时、RPC 失败未知、null/漏采样面积断段、流控失败不丢 CPU、挂起 transport 无重叠、120s 过期、detach/pagehide。设置使用真实 form/widget/footer click 执行保存，覆盖无修改、成功、恢复失败通知；原有完整 rollback/readback 行为回归保留。

## 复现与证据

```sh
cd /root/packages/luci-app-airoha-npu
export NODE_PATH=$(npm root -g)
export LUCI_RESOURCE_DIR=/tmp/mlo-luci/modules/luci-base/htdocs/luci-static/resources
export AURORA_DIR=/tmp/packages-fix-aurora
export PLAYWRIGHT_MODULE=/tmp/packages-browser-qa/node_modules/playwright
export NPU_ZH=1
mkdir -p /tmp/npu-zh-verified
NPU_DOM_EXPORT=/tmp/npu-zh-verified/npu.dom.html node tests/test_dom.js
NPU_SETTINGS_EXPORT=/tmp/npu-zh-verified/settings node tests/test_settings_form.js
NPU_LAYOUT_DIR=/tmp/npu-zh-verified node tests/test_chart_layout.js
node tests/test_settings.js
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
msgfmt --check -o /tmp/npu-zh-verified/catalog.mo po/zh_Hans/luci-app-airoha-npu.po
node --check htdocs/luci-static/resources/view/airoha_npu/status.js
sh -n root/usr/libexec/rpcd/luci.airoha_npu
git diff --check
```

英文同样运行，unset NPU_ZH，输出到 `/tmp/npu-en-verified`。两目录分别含 `layout-results.json`、源码/DOM/CSS/PO 哈希 `manifest.json`、60 张截图及行为日志。RPCError 日志属于故意注入失败，最终 PASS 才是结果。

边界：离线真实 DOM/CSS/原生翻译/浏览器几何和 jsdom 交互，不是部署到真机；浏览器导出不保留事件，实际保存 click 在真实 LuCI jsdom 中执行。下拉展开、复位/保存并应用执行、完整导航/浏览器 LuCI 生命周期未验证。Python 六项测试使用隔离 UCI/jsonfilter 夹具，不声称真实 OpenWrt 工具链/硬件验证。未提交、推送或构建，未修改其它包。
