# OpenWrt / ImmortalWrt 软件包

OpenWrt / ImmortalWrt 固件构建用源码 feed，不提供二进制软件源。

## 组件

| 软件包 | 版本 | 功能 |
| --- | --- | --- |
| `luci-app-airoha-npu` | `20261127-r1` | Airoha NPU 状态与 CPU 调频 |
| `luci-app-airoha-flowsense` | `20261128-r1` | Airoha 硬件加速设置与流量监控 |
| `luci-app-airoha-fancontrol` | `20261127-r1` | Airoha 温控与风扇调速 |
| `luci-app-wifi7` | `20261128-r1` | WiFi 7 射频、MLO 与客户端管理 |
| `luci-app-homeproxy` | `20261128-r1` | 基于 sing-box 的代理管理 |
| `sing-box` | `1.14.6` | 跟随 SagerNet 官方稳定版 |

## 兼容性

- **HomeProxy** 可在满足依赖的固件上独立构建，需要 `sing-box` 1.14.0 或更新版本，推荐完整版。
- **Airoha**：FlowSense 和风扇控制限 Airoha 目标，风扇控制另需 NCT7802。NPU 状态和 CPU 调频分别依赖 PPE 和 CPUFreq 接口。
- **[WiFi 7](luci-app-wifi7/README.md)** 适配 W1700K 的 MT7996，功能取决于驱动和无线工具。

## 使用

在固件源码根目录的 `feeds.conf` 中添加（若文件不存在，先复制 `feeds.conf.default`）：

```text
src-git mypackages https://github.com/yahuisme/packages.git;main
```

更新 feeds、导入配方，再在 `menuconfig` 中选包。以 HomeProxy 为例：

```sh
./scripts/feeds update -a
./scripts/feeds install -p mypackages luci-app-homeproxy sing-box
make menuconfig
```

若已有同名配方，请核对来源；`-p mypackages` 不会替换已导入的配方。

单独使用 `sing-box` 时，先编辑 `/etc/sing-box/config.json` 再启用服务。默认配置不监听端口。

## 维护

每天香港时间 02:00 检查 GeoIP、GeoSite 和 sing-box 稳定版更新。Dashboard 仅手动更新。

[本地测试说明](.github/scripts/TESTING.md)
