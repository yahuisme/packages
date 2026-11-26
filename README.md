# packages

OpenWrt / ImmortalWrt 软件包源码 feed，用于固件构建，不是路由器可直接添加的 APK 或 opkg 二进制软件源。

## 组件

| 软件包 | 版本 | 功能 |
| --- | --- | --- |
| `luci-app-airoha-npu` | `20261126-r1` | Airoha NPU 状态与 CPU 调频 |
| `luci-app-airoha-flowsense` | `20261126-r1` | Airoha 硬件加速设置与流量监控 |
| `luci-app-airoha-fancontrol` | `20261122-r1` | Airoha 温控与风扇调速 |
| `luci-app-wifi7` | `20261126-r1` | WiFi 7 射频、MLO 与客户端管理 |
| `luci-app-homeproxy` | `20261126-r2` | 基于 sing-box 的代理管理，独立维护 |
| `sing-box` | `1.14.4` | 跟随 SagerNet 官方稳定版 |

## 兼容性

- **HomeProxy**：只要目标固件满足软件包依赖，就可以从源码编译并使用，不限机型或固件仓库。需要 `sing-box` 1.14.0 或更新版本；推荐此 feed 的完整版，`sing-box-tiny` 的功能取决于编译选项。
- **Airoha 应用**：FlowSense 和风扇控制限 Airoha 目标，风扇控制另需 NCT7802；NPU 状态与 CPU 调频依赖目标系统提供相应的 PPE、CPUFreq 接口。
- **[WiFi 7](luci-app-wifi7/README.md)**：适配 W1700K 的 MT7996；射频和 MLO 功能取决于驱动与用户态工具。

## 使用

在固件源码根目录的 `feeds.conf` 末尾添加下列一行。若文件不存在，先复制 `feeds.conf.default` 为 `feeds.conf`。

```text
src-git mypackages https://github.com/yahuisme/packages.git;main
```

更新 feeds，再将需要的配方加入构建树。以 HomeProxy 为例：

```sh
./scripts/feeds update -a
./scripts/feeds install -p mypackages luci-app-homeproxy sing-box
make menuconfig
```

在 `menuconfig` 中选中所需软件包。若已有同名配方，先核对来源：`-p mypackages` 指定优先使用的 feed，不会自动替换已引入的配方。

## 维护

- FlowSense 沿用配置名 `npu-monitor` 和探针服务名 `npu-jitter`，升级时保留。
- 每天香港时间 02:00 检查 GeoIP、GeoSite 和官方稳定核心；核心升级须先通过 HomeProxy 原生兼容性测试，并同步配方与本页版本。Dashboard 仅手动更新。
- 测试依赖、运行命令与验证范围见 [测试说明](.github/scripts/TESTING.md)；专项说明位于各包的 `tests/`。
