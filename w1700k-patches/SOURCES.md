# W1700K 补丁来源

供 [w1700k-openwrt](https://github.com/yahuisme/w1700k-openwrt) 与 [w1700k-immortalwrt](https://github.com/yahuisme/w1700k-immortalwrt) 共用，分别跟随 [OpenWrt main](https://github.com/openwrt/openwrt) 与 [ImmortalWrt master](https://github.com/immortalwrt/immortalwrt)。本目录不是软件包，不包含应用脚本或 Makefile。

`patches/` 为源码根目录补丁；`tree/` 保留原源码目录结构，注入时保留目标目录所有权，内核与软件包补丁按各自构建顺序应用。`610` 必须选对应发行版，不能合并或同时应用。

| 文件（相对本目录） | 用途与来源 |
| --- | --- |
| `patches/002-w1700k-cpufreq-resources.patch` | CPUFreq 设备树资源，来源 [B] |
| `tree/target/linux/airoha/patches-6.18/940-*` | CPU PLL 兼容回退，来源 [B]；保留官方 attach_list、0–14 状态、500–1200 MHz 与调频策略 |
| `tree/target/linux/airoha/patches-6.18/745-*` | E2 PCS RX 校准，原 OpenWrt 来源 [A]、ImmortalWrt 来源 [B]，内容相同 |
| `tree/target/linux/airoha/patches-6.18/746-*` | MDIO 扫描前解除 PHY 复位，原 OpenWrt 来源 [A]、ImmortalWrt 来源 [B]，内容相同 |
| `tree/package/kernel/mt76/patches/911-*` | 功率变更时刷新固件限制，适配 OpenW1700k 的 `0011-refresh-power-limits-on-txpower-changes`；SKU 启用沿用官方实现 |
| `openwrt/610-w1700k-power-30.patch`、`immortalwrt/610-w1700k-power-30.patch` | OpenWrt：CN/US 功率及频段定制，合并本项目配置与 [A] 的 US 高频段、6 GHz 设置，在官方 regdb 500 后应用；ImmortalWrt：US 功率及频段定制，在官方 regdb 500/600 后应用，CN 与 US 低频段沿用官方 600。两份原始字节分别保留 |
| `tree/package/network/utils/iwinfo/patches/999-*` | 按当前频率展示功率列表，原 OpenWrt 来源 [A]、ImmortalWrt 来源 [B]，内容相同 |
| `patches/920-wifi-non-mlo-ap-txpower.patch` | 本项目非 MLO AP 按 BSS 设置功率；已按用户授权删除原首个 txpower 判断 hunk，其余字节不变 |
| `patches/998-single-wiphy.patch` | single-wiphy 多射频设备的 LuCI 信道分析适配，作者 Gilly1970 |

- [A] [OpenWRT-fanboy/OpenW1700k `bce05fa86b22`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/bce05fa86b222741d8afcef2e5468a9481679041)
- [B] [OpenWRT-fanboy/OpenW1700k `972634e64d19`](https://github.com/OpenWRT-fanboy/OpenW1700k/commit/972634e64d19cba0095b662a0bfd9561ebef635c)

## 非 MLO AP 功率

`920` 通过私有 hostapd 元数据在 `bss_add` 后设置功率，功率变更沿用重启路径；失败记录日志并通知，不等同于 netifd 确认成功。仅适用于共享 PHY 上所有活动 radio 均为非 MLO AP 的配置；混用 MLO 或非 AP 时，全局 PHY 设置仍可能覆盖功率，不提供 MLO 按链路控制。删除首 hunk 后沿用各发行版官方 txpower 判断；当前 ImmortalWrt 的 `0 dBm` 会按自动功率处理，此差异已获用户确认。

## 维护与迁移校验

- 官方为主，只保留必要兼容修复与既定参数定制；先核对来源和适用范围，官方吸收后验证并移除重复内容。必要补丁应用失败即停止构建。
- Realtek PHY、NAND、网络栈与卸载机制沿用官方；不恢复额外驱动增强或 vermagic 覆盖。保留既定中文 LuCI、Aurora、专属应用、WOL、ttyd、访问、无线与状态灯设置。
- 源码与隔离测试不代替实机射频验证；滚动更新继续检查兼容性。

迁移原始快照：OpenWrt [`b527db7ab1f918f0467056c50c332cafe31df7c8`](https://github.com/yahuisme/w1700k-openwrt/commit/b527db7ab1f918f0467056c50c332cafe31df7c8)、ImmortalWrt [`b61b737b26b06b1be1085f356c761cb516aa618e`](https://github.com/yahuisme/w1700k-immortalwrt/commit/b61b737b26b06b1be1085f356c761cb516aa618e)。`tests/test_migration.py` 对照这两个 Git 快照核验完整清单和每个补丁的原始字节，仅允许精确删除 `920` 首 hunk，不使用当前工作树作为预期值。

从 packages 根目录运行：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 w1700k-patches/tests/test_migration.py
```

默认读取相邻的两个 W1700K Git 仓库；其他位置设置 `W1700K_OPENWRT_REPO`、`W1700K_IMMORTALWRT_REPO`，仓库须含上述快照。此测试不应用补丁、不编译、不修改固件仓库。
