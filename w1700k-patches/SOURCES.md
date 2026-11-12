# W1700K 补丁说明与来源

供 [w1700k-openwrt](https://github.com/yahuisme/w1700k-openwrt) 的 OpenWrt main 与 ImmortalWrt master 双系统构建使用。补丁与应用取自同一次 packages 克隆。

## 补丁清单

| 补丁 | 用途 | 来源与调整 |
| --- | --- | --- |
| `patches/002-*`、`tree/target/linux/airoha/patches-6.18/940-*` | CPUFreq 设备树资源与 CPU PLL 兼容回退 | [B]；保留官方频率与调频策略，不含超频 |
| `tree/target/linux/airoha/patches-6.18/745-*` | E2 PCS RX 校准 | [A]/[B]，作者 Gilly |
| `tree/target/linux/airoha/patches-6.18/746-*` | MDIO 扫描前解除 PHY 复位 | [A]/[B]，作者 Gilly |
| `tree/package/kernel/mt76/patches/911-*` | 功率变更时刷新固件功率限制 | 作者 Yanghan Ye；适配 OpenW1700k 的 `0011-refresh-power-limits-on-txpower-changes`，SKU 启用沿用官方 |
| `tree/package/kernel/mt76/patches/912-*` | 通过 MCU 获取客户端 airtime 与信号统计 | 作者 Joshua Klinesmith；适配当前消息分派并完善响应边界校验 |
| `tree/package/kernel/mt76/patches/913-*` | TX-free 消息边界与分片校验，截断后完成已有回收与队列唤醒 | 基于 [C]/[D]；保留异常告警，不增加超时 token 回收 |
| `patches/610-*` | CN/US 功率与频段定制 | 包含 [A] 的 US 高频段及 6 GHz 设置，两版最终 regdb 内容一致 |
| `tree/package/network/utils/iwinfo/patches/998-*` | 按目标 radio 选择接口与创建临时扫描接口 | 本项目扩展官方 multi-radio 实现，使用 UCI radio 索引及原生接口 radio mask |
| `tree/package/network/utils/iwinfo/patches/999-*` | 按当前频率展示功率列表 | [A]/[B]，作者 Yanghan Ye |
| `tree/package/system/procd/patches/001-*` | watchdog 默认超时不超过硬件上限 | 基于 [E]，作者 Vitaliy Sochnev；保留显式请求及官方失败读回 |
| `tree/package/network/services/hostapd/patches/mtk-0015-*` | 6 GHz DFS 辅助判断提前返回 | 作者 Peter Chiu；沿用 [F] 的单行频率判断，不改变 5 GHz DFS |
| `patches/920-*` | 非 MLO AP 按 BSS 设置功率 | 本项目实现，适用范围见下文 |
| `patches/998-*` | single-wiphy 多射频信道分析适配 | 作者 Gilly1970；本项目选择活动网卡并校验本机实际频段，保留停用 AP 时的邻居扫描 |

### 来源

- [A] [OpenWRT-fanboy/OpenW1700k · `bce05fa86b22`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/bce05fa86b222741d8afcef2e5468a9481679041)
- [B] [OpenWRT-fanboy/OpenW1700k · `972634e64d19`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/972634e64d19cba0095b662a0bfd9561ebef635c)
- [C] [OpenWRT-fanboy/OpenW1700k · `23df1d78c647`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/23df1d78c6476d4a301ecd56aab65f4c6be86542)
- [D] [OpenWRT-fanboy/OpenW1700k · `12650fa28dfe`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/12650fa28dfedccb20d726780c06c8fa45074b18)
- [E] [OpenWRT-fanboy/OpenW1700k · `3cb57ea0418d`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/3cb57ea0418daa5119853d736d4d95e63171a4ac)
- [F] [OpenWRT-fanboy/OpenW1700k · `d1efb9dcae6e`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/d1efb9dcae6e6a588d743db8e2dee390ce3f7fe9)

原作者信息保留在补丁头部。

## 应用方式

- `002`、`920`：在固件源码根目录应用。
- `610`：复制到 wireless-regdb 补丁目录，在官方 `500` 后应用；ImmortalWrt 仅移除被覆盖的 `600-custom-change-txpower-and-dfs.patch`。
- `998`：复制到 LuCI 的 luci-mod-status 补丁目录，由 LuCI 构建流程应用。
- `tree/`：按源码目录结构复制，由内核与软件包构建流程应用。

## 多射频扫描

后端 `iwinfo/998` 接续[官方 multi-radio 补丁](https://github.com/openwrt/openwrt/blob/dab12e766366dceb149e70aa1155005b6a571299/package/network/utils/iwinfo/patches/100-multi_radio.patch)，按 UCI `radio` 索引匹配接口，停用 AP 时沿用临时 STA 扫描并绑定目标 radio。LuCI `998` 按信道与实际 MHz 核对本机数据，避免跨频段的假本机标记；不关闭停用 AP 的邻居扫描。

## 非 MLO AP 功率

`920` 在 `bss_add` 后设置功率，功率变更沿用 hostapd 重启路径。失败时记录日志并通知，不向 netifd 返回同步成功确认。

仅适用于共享 PHY 上所有活动 radio 均为非 MLO AP 的配置。混用 MLO 或非 AP 时，全局 PHY 设置仍可能覆盖功率；不提供 MLO 按链路控制。

功率判断沿用官方实现，支持显式设置 `0 dBm`，未设置时使用自动功率。

## 维护

官方优先，保留必要修复与既定定制；官方吸收后验证移除。必要补丁缺失或应用失败即停止构建。

[迁移与 regdb 校验](tests/README.md)
