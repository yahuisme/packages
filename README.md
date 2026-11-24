# packages

面向 OpenWrt / ImmortalWrt 的源码 feed，不是路由器可直接添加的 APK 或 opkg 二进制软件源。

## 组件

| 软件包 | 版本 | 功能 |
| --- | --- | --- |
| `luci-app-airoha-npu` | `20261118-r1` | Airoha NPU 状态与 CPU 调频 |
| `luci-app-airoha-flowsense` | `20261122-r1` | Airoha 硬件加速设置与流量监控 |
| `luci-app-airoha-fancontrol` | `20261122-r1` | Airoha 温控与风扇调速 |
| `luci-app-wifi7` | `20261118-r1` | WiFi 7 射频、MLO 与客户端管理 |
| `luci-app-homeproxy` | `20261122-r1` | 基于 sing-box 的代理管理，独立维护 |
| `sing-box` | `1.14.4` | 跟随 SagerNet 官方稳定版 |

风扇控制与 FlowSense 限 Airoha 目标，风扇控制还需要 NCT7802 硬件。SoC 状态与调频依赖目标系统的 PPE、CPUFreq 接口；[WiFi 7](luci-app-wifi7/README.md) 面向 W1700K 的 MT7996，射频和 MLO 功能取决于驱动及用户态工具。

HomeProxy 不限 W1700K 或 MX4200，要求 sing-box 1.14.0 或更新版本及其余包依赖。建议使用此 feed 的完整 `sing-box`；`sing-box-tiny` 的功能随编译选项变化，不等同于完整版。

## 使用

在固件源码根目录的 `feeds.conf` 中保留已有 feeds（若文件不存在，先从 `feeds.conf.default` 复制），再添加：

```text
src-git mypackages https://github.com/yahuisme/packages.git;main
```

更新所有 feeds 以建立依赖索引，再将所需配方加入构建树。以 HomeProxy 为例：

```sh
./scripts/feeds update -a
./scripts/feeds install -p mypackages luci-app-homeproxy sing-box
make menuconfig
```

在 `menuconfig` 中选择所需软件包。若其他 feed 已引入同名配方，先确认当前来源；`-p mypackages` 只指定优先来源，不保证替换已安装的配方。

## 维护

- W1700K 固件补丁由 [w1700k-openwrt](https://github.com/yahuisme/w1700k-openwrt/blob/main/user/w1700k-patches/SOURCES.md) 维护。
- FlowSense 沿用配置名 `npu-monitor` 和探针服务名 `npu-jitter`，升级时保留。
- 测试依赖、运行命令与验证范围见 [测试说明](.github/scripts/TESTING.md)；专项说明位于各包的 `tests/`。
