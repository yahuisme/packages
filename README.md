# packages

面向 OpenWrt / ImmortalWrt 的定制软件包源。

## 组件

| 软件包 | 功能 |
| --- | --- |
| `luci-app-airoha-npu` | Airoha NPU 状态与 CPU 调频 |
| `luci-app-airoha-flowsense` | Airoha 硬件加速设置与流量监控 |
| `luci-app-airoha-fancontrol` | Airoha 温控与风扇调速 |
| `luci-app-wifi7` | WiFi 7 射频、MLO 与客户端管理 |
| `luci-app-homeproxy` | 基于 sing-box 的代理管理，独立维护 |
| `sing-box` | 跟随 SagerNet 官方稳定版 |

硬件相关功能需对应设备与驱动支持。

## 使用

在固件源码根目录的 `feeds.conf` 或 `feeds.conf.default` 中添加：

```text
src-git mypackages https://github.com/yahuisme/packages.git;main
```

更新并安装 feed，再选择所需软件包：

```sh
./scripts/feeds update mypackages
./scripts/feeds install -a -p mypackages
make menuconfig
```

## 维护

- W1700K 共用补丁独立于 feed，应用方式与来源见 [补丁说明](w1700k-patches/SOURCES.md)。
- FlowSense 沿用配置名 `npu-monitor` 和探针服务名 `npu-jitter`，升级时保留。
- 测试依赖、运行命令与验证范围见 [测试说明](.github/scripts/TESTING.md)；专项说明位于各包的 `tests/`。
