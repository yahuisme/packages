# packages

ImmortalWrt / OpenWrt 专属定制软件包源。

## 包含组件

| 组件 | 说明 |
| :--- | :--- |
| `luci-app-homeproxy` | homeproxy 代理客户端（支持 sing-box >= 1.14.0） |
| `sing-box` | 通用代理平台，自动跟随官方正式版更新 |
| `luci-app-airoha-npu` | Airoha NPU 状态监控与 SOC 频率控制 |
| `luci-app-airoha-flowsense` | Airoha 硬件流控监控 |
| `luci-app-airoha-fancontrol` | Airoha 温控与风扇调速面板 |
| `luci-app-wifi7` | WiFi 7 射频、MLO 与运行状态管理面板 |

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
