# packages

ImmortalWrt / OpenWrt 专属定制软件包源。

W1700K 共用补丁集中于 [`w1700k-patches`](w1700k-patches/SOURCES.md)，独立于软件包 feed，两个发行版使用同一套补丁。

## 包含组件

| 组件 | 说明 |
| :--- | :--- |
| `luci-app-airoha-npu` | Airoha NPU 状态监控与 SOC 频率控制 |
| `luci-app-airoha-flowsense` | Airoha 硬件流控监控 |
| `luci-app-airoha-fancontrol` | Airoha 温控与风扇调速面板 |
| `luci-app-wifi7` | WiFi 7 射频、MLO 与运行状态管理面板 |
| `luci-app-homeproxy` | 独立维护 HomeProxy |
| `sing-box` | 跟随 SagerNet 官方最新正式版 |

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

## 命名对照

`luci-app-airoha-flowsense` 因历史原因在多个层面使用了不同名字，改动时注意不要"顺手统一"（会破坏已装机用户的配置与保留文件）：

| 层面 | 名称 |
| :--- | :--- |
| 软件包 / 目录 | `luci-app-airoha-flowsense` |
| 菜单路径 | `admin/status/flowsense` |
| ubus 对象 | `luci.airoha_flowsense` |
| 视图目录 | `airoha_flowsense/` |
| 配置文件 | `/etc/config/npu-monitor`（conffiles 已保护） |
| 探针服务 | `/etc/init.d/npu-jitter` |
| 升级保留 | `/etc/flowsense/pending.json` + `/etc/sysctl.d/{12-apmode,14-vlan,15-pppoe}-offload.conf` |

## 视图约定

- 轮询页面只在 `document.visibilityState === 'hidden'` 时跳过采集，后台标签页不打扰路由器。
- 生命周期用**视图容器**级观察（`#view` 或视图的父节点），不要用 `document.body` + `subtree`：后者在页面每次自更新时都会回调。
- 轮询回调自带 `isConnected` 自清理，观察者只负责"立刻"停表；两者都保留。
- 状态类页面就地更新文本/属性，禁止每 tick `replaceChildren()` 重建（会丢焦点并触发重排）。

## 测试

各包 `tests/` 下的用例不需要路由器或真实无线硬件，只要 node（jsdom）与上游 LuCI 资源：

```bash
export NODE_PATH="$(npm root -g)"
export LUCI_RESOURCE_DIR=/path/to/luci/modules/luci-base/htdocs/luci-static/resources
./.github/scripts/run-tests.sh
```

脚本会明确打印 `SKIP` 及原因（需要真实 OpenWrt 树、主题布局夹具或 Playwright 的用例），
CI 在 `.github/workflows/tests.yaml` 中运行同一套。

