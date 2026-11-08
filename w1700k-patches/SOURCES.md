# W1700K 补丁说明与来源

供 [w1700k-openwrt](https://github.com/yahuisme/w1700k-openwrt) 与 [w1700k-immortalwrt](https://github.com/yahuisme/w1700k-immortalwrt) 共用，分别跟随官方 OpenWrt main 与 ImmortalWrt master。补丁与应用取自同一次 packages 克隆。

## 补丁清单

| 补丁 | 用途 | 来源与调整 |
| --- | --- | --- |
| `patches/002-*`、`tree/target/linux/airoha/patches-6.18/940-*` | CPUFreq 设备树资源与 CPU PLL 兼容回退 | [B]；保留官方频率与调频策略，不含超频 |
| `tree/target/linux/airoha/patches-6.18/745-*` | E2 PCS RX 校准 | [A]/[B]，作者 Gilly |
| `tree/target/linux/airoha/patches-6.18/746-*` | MDIO 扫描前解除 PHY 复位 | [A]/[B]，作者 Gilly |
| `tree/package/kernel/mt76/patches/911-*` | 功率变更时刷新固件功率限制 | 作者 Yanghan Ye；适配 OpenW1700k 的 `0011-refresh-power-limits-on-txpower-changes`，SKU 启用沿用官方 |
| `patches/610-*` | CN/US 功率与频段定制 | 包含 [A] 的 US 高频段及 6 GHz 设置，两版最终 regdb 内容一致 |
| `tree/package/network/utils/iwinfo/patches/999-*` | 按当前频率展示功率列表 | [A]/[B]，作者 Yanghan Ye |
| `patches/920-*` | 非 MLO AP 按 BSS 设置功率 | 本项目实现，适用范围见下文 |
| `patches/998-*` | single-wiphy 多射频信道分析适配 | 作者 Gilly1970；本项目改为选择活动网卡，跳过禁用接口与 LuCI 逻辑标识 |

### 来源

- [A] [OpenWRT-fanboy/OpenW1700k · `bce05fa86b22`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/bce05fa86b222741d8afcef2e5468a9481679041)
- [B] [OpenWRT-fanboy/OpenW1700k · `972634e64d19`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/972634e64d19cba0095b662a0bfd9561ebef635c)

原作者信息保留在补丁头部。

## 应用方式

- `002`、`920`：在固件源码根目录应用。
- `610`：复制到 wireless-regdb 补丁目录，在官方 `500` 后应用；ImmortalWrt 仅移除被覆盖的 `600-custom-change-txpower-and-dfs.patch`。
- `998`：复制到 LuCI 的 luci-mod-status 补丁目录，由 LuCI 构建流程应用。
- `tree/`：按源码目录结构复制，由内核与软件包构建流程应用。

## 非 MLO AP 功率

`920` 在 `bss_add` 后设置功率，功率变更沿用 hostapd 重启路径。失败时记录日志并通知，不向 netifd 返回同步成功确认。

仅适用于共享 PHY 上所有活动 radio 均为非 MLO AP 的配置。混用 MLO 或非 AP 时，全局 PHY 设置仍可能覆盖功率；不提供 MLO 按链路控制。

功率判断沿用官方实现，支持显式设置 `0 dBm`，未设置时使用自动功率。

## 维护

官方优先，保留必要修复与既定定制；官方吸收后验证移除。必要补丁缺失或应用失败即停止构建。

[迁移与 regdb 校验](tests/README.md)
