# packages

ImmortalWrt / OpenWrt 专属定制软件包源。

## 包含组件

| 组件 | 版本 | 说明 |
| :--- | :--- | :--- |
| `luci-app-airoha-npu` | `20260914-r3` | Airoha NPU 状态监控与 SOC 频率控制 |
| `luci-app-airoha-flowsense` | `20260914-r3` | Airoha 硬件流控监控 |
| `luci-app-airoha-fancontrol` | `20260914-r2` | Airoha 温控与风扇调速面板 |
| `luci-app-wifi7` | `20260914-r2` | WiFi 7 射频、MLO 与运行状态管理面板 |
| `luci-app-homeproxy` | `20260915-r1` | 独立维护 HomeProxy |
| `sing-box` | `1.14.0` | 跟随 SagerNet 官方最新正式版 |

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
