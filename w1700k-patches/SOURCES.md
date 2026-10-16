# W1700K 补丁说明与来源

供 [w1700k-openwrt](https://github.com/yahuisme/w1700k-openwrt) 与 [w1700k-immortalwrt](https://github.com/yahuisme/w1700k-immortalwrt) 共用，分别跟随官方 OpenWrt main 与 ImmortalWrt master。构建复用应用使用的 packages 克隆，补丁与应用使用同一提交。

`patches/` 在源码根目录应用；`tree/` 按源码目录结构复制，保留目标目录所有权，再由内核与软件包构建流程应用。两个发行版共用 `patches/610-w1700k-power-30.patch`，在官方 regdb `500` 后应用；ImmortalWrt 移除已由 `610` 覆盖的官方 `600`，其余补丁保留。

| 补丁 | 用途与来源 |
| --- | --- |
| `patches/002-*`、`tree/target/linux/airoha/patches-6.18/940-*` | CPUFreq 设备树资源与 CPU PLL 兼容回退，[B]；保留官方频率和调频策略 |
| `tree/target/linux/airoha/patches-6.18/745-*` | E2 PCS RX 校准，[A]/[B] |
| `tree/target/linux/airoha/patches-6.18/746-*` | MDIO 扫描前解除 PHY 复位，[A]/[B] |
| `tree/package/kernel/mt76/patches/911-*` | 功率变更时刷新固件限制，适配 OpenW1700k 的 `0011-refresh-power-limits-on-txpower-changes`；SKU 启用沿用官方 |
| `patches/610-*` | CN/US 功率与频段定制，包含 [A] 的 US 高频段及 6 GHz 设置；两版最终 regdb 内容一致 |
| `tree/package/network/utils/iwinfo/patches/999-*` | 按当前频率展示功率列表，[A]/[B] |
| `patches/920-*` | 本项目实现：非 MLO AP 按 BSS 设置功率 |
| `patches/998-*` | single-wiphy 多射频信道分析适配，作者 Gilly1970 |

- [A] [OpenWRT-fanboy/OpenW1700k `bce05fa86b22`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/bce05fa86b222741d8afcef2e5468a9481679041)
- [B] [OpenWRT-fanboy/OpenW1700k `972634e64d19`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/972634e64d19cba0095b662a0bfd9561ebef635c)

## 非 MLO AP 功率

`920` 在 `bss_add` 后设置功率，功率变更沿用 hostapd 重启路径；失败记录日志并通知，不代表 netifd 同步确认成功。

仅适用于共享 PHY 上所有活动 radio 均为非 MLO AP 的配置。混用 MLO 或非 AP 时，其他 radio 的全局 PHY 设置仍可能覆盖功率；不提供 MLO 按链路控制。

功率判断沿用官方实现；两版均支持显式设置 `0 dBm`，未设置时使用自动功率。

## 维护原则

官方优先，仅保留必要修复与既定定制，官方吸收后验证移除；必要补丁缺失或应用失败即停止构建。

[迁移校验](tests/README.md)
