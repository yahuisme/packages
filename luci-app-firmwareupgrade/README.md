# luci-app-firmwareupgrade

在「系统 → 固件升级」手动检查 GitHub Releases，并确认升级。

## 筛选设置

- **GitHub 仓库**：`owner/repository`，只支持 GitHub。
- **Release 标签通配符**与**固件文件通配符**：必填，区分大小写；`*` 匹配任意文本，`?` 匹配单个字符。不支持正则表达式、字符组、路径、空白或多个规则。修改仓库会清空两项规则，须明确填写并保存后检查。
- **GitHub 下载代理**：选填，例如 `https://gh-proxy.com/`。留空直连；非空时将此前缀拼到原始 GitHub 镜像地址前。只代理镜像下载，Release 检查始终直连 GitHub API。建议 HTTPS；拒绝凭据、查询参数、控制字符和非 HTTP(S) 地址。GitHub Token 仅发送给 GitHub API，不发送给下载代理。
- **GitHub 访问令牌**：留空保存时保留已有令牌。

| 来源 | Release 标签规则 | 固件文件规则 |
| --- | --- | --- |
| `yahuisme/w1700k-openwrt` 标准 / OC | `W1700K-OpenWrt_*` / `W1700K-OpenWrt-OC_*` | `*gemtek_w1700k-ubi-squashfs-sysupgrade.itb` |
| `yahuisme/w1700k-immortalwrt` 标准 / OC | `W1700K-ImmortalWrt_*` / `W1700K-ImmortalWrt-OC_*` | 同上 |
| `w1700k/builds` 标准 / OC | `ubi2_*` / `ubi2-oc_*` | 同上 |
| `yahuisme/mx4200-immortalwrt` | `*` | `*linksys_mx4200v1-squashfs-sysupgrade.bin` 或 v2 |
| `VIKINGYFY/OpenWRT-CI` | `IPQ807X-WIFI-YES-*` 或 `IPQ807X-WIFI-NO-*` | `*linksys_mx4200v2-squashfs-sysupgrade-*.bin` |

旧配置未提供规则时，仅原有 yahuisme 仓库按设备、发行版和标准/OC 生成原默认值；保存后显式持久化。其他仓库不会继承或自动放宽规则。型号仅用于默认值，不再参与运行时资源评分或仓库专属筛选。未知设备可配置规则，最终兼容性仍由设备的 `sysupgrade -T` 判定。

## 发现与安全边界

统一读取 Releases 列表，最多 3 页、每页 20 条；完整扫描此窗口后按 `published_at` 选择最新包含合格镜像的稳定发布。短页代表列表结束；不是遇到第一个匹配就停止。窗口以外的发布不保证覆盖，每页网络超时 5 秒；路由器实际 RPC 总超时仍需验证。

排除草稿、预发布和 factory/initramfs/bootloader/kernel/rootfs；只接受 sysupgrade 文件及有效大小、GitHub 下载地址、`sha256:` digest。同一选中发布存在多个合格镜像时明确报错，请收紧规则，不按评分或顺序选择。

后端候选绑定原始 GitHub 来源、SHA256、大小、仓库、筛选规则和下载代理。保存设置会清除候选；直接修改配置后启动也重新比对。浏览器只能提交候选身份及保留配置选项，不能提交任意下载地址。下载后验证大小、SHA256，再执行 `sysupgrade -T`；任一失败不刷写。无定时自动刷写、格式转换或任意下载站支持。

## 验证范围

参见 `tests/README.md`。本地测试使用真实 BusyBox/UCI/jsonfilter，网络与刷写边界隔离；浏览器布局验证为离线 Aurora，不等于路由器实机验证。
