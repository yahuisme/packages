# packages

ImmortalWrt / OpenWrt 专属定制软件包源。

## 包含组件

| 组件 | 说明 |
| :--- | :--- |
| `luci-app-airoha-npu` | Airoha NPU 状态监控与 SOC 频率控制 |
| `luci-app-airoha-flowsense` | Airoha 硬件流控监控 |
| `luci-app-airoha-fancontrol` | Airoha 温控与风扇调速面板 |
| `luci-app-wifi7` | WiFi 7 射频、MLO 与运行状态管理面板 |
| `luci-app-homeproxy` | 每日完整同步 VIKINGYFY/packages 的 HomeProxy |
| `sing-box` | 基于 VIKINGYFY/packages，仅跟随 SagerNet 官方正式版 |

HomeProxy 与 sing-box 每日香港时间 02:00 自动检查更新。HomeProxy 整目录同步上游，并同步执行 VIKINGYFY 原版资源更新脚本，自行下载更新 GeoIP、GeoSite 与仪表盘；sing-box 仅更新正式版版本号与源码校验值，不跟随测试版。

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
