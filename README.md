# packages

ImmortalWrt / OpenWrt 专属定制软件包源。

## 包含组件

| 组件 | 说明 |
| :--- | :--- |
| `luci-app-airoha-npu` | Airoha NPU 状态监控与 SOC 频率控制 |
| `luci-app-airoha-flowsense` | Airoha 硬件流控监控 |
| `luci-app-airoha-fancontrol` | Airoha 温控与风扇调速面板 |
| `luci-app-wifi7` | WiFi 7 射频、MLO 与运行状态管理面板 |
| `luci-app-homeproxy` | 独立维护 HomeProxy；每日直接更新 SagerNet 公共资源 |
| `sing-box` | 仅跟随 SagerNet 官方正式版，升级须通过 HomeProxy 兼容门禁 |

维护基线、资源来源/UTC 14 位版本、升级政策和双仓库部署顺序见 [HomeProxy 维护说明](docs/homeproxy-maintenance.md)。

## 使用方法

在固件源码根目录的 `feeds.conf` 或 `feeds.conf.default` 中添加：

```text
src-git mypackages https://github.com/yahuisme/packages.git;main
```

更新并安装软件包：

```bash
./scripts/feeds update mypackages
./scripts/feeds install -a -p mypackages
```
