# HomeProxy 独立维护

`luci-app-homeproxy/` 是唯一正式源码，不再自动镜像上游。上游仅作为修复参考，逐项评估、测试后手工吸收，不覆盖整包。

## 迁移基线与溯源

- packages 实机工作基线：`b82dd3209bd8d9e6d5d47dc6b0cd285a3874c81a`（恢复原上游连接探测）；包含 `c78187a6428ec1aaf9b57b083ccc8e82dfb3dd15` 的 IPv6 开关修复。
- 最后镜像提交：packages `a2f20573763a1df570c730eca1f9b076dc80314f`。
- 已核验 VIKINGYFY/packages `0d58e33f8f728dcd65c1f51210ff665f6ed931ed` 的 HomeProxy tree 与上述镜像一致：`2f4ab7fe7aff4b90319c08102fec1d8deb21a420`。
- 原 `runtime.patch` SHA256：`eeb0a588bfe48322438e88a6769f67d806a7cb578da0270f1f7e4d5a8124546f`。
- 原 `ui.patch` SHA256：`e263c5712b11c1a1107a66a69533a8cfe355fb0433aa0dd9db4d7a39bcf82f0d`。
- 两补丁先按原 `apply.sh` 应用，82 个文件逐字节及权限核对一致，再删除补丁；未重构探测、IPv6、DNS/TUN、UI 或翻译。迁移后唯一额外运行时变更是下述已批准资源版本/事务处理。
- 资源事务实现以历史 packages `e000a5c426f2b01d6d8d95894344883d50c53608` 为参考，保留当前 geosite `rule-set-unstable` 来源，改为全批失败关闭。资源改动与补丁吸收分开审核。未因源码吸收虚增包版本。

## 下游接入与部署顺序

按用户最终授权删除 `custom/homeproxy/` 整层。MX4200 的真实仓库为 `yahuisme/mx4200-immortalwrt`，基线 `eed4056aec14865a766f5cea9708da2e887b96dc`；原 `Scripts/Packages.sh` blob 为 `52492b3134672b69f333337fba7828954e2cfed1`。配套修改仅删除 apply 调用并让 HomeProxy 与 sing-box 都直接从 packages 复制，其他包流程不变。

发布时必须暂停 MX4200 构建，先发布 packages 独立源码，再紧接发布 MX4200 直接接入修改，确认双仓库配套后恢复构建；旧 MX4200 在入口删除后会失败，新 MX4200 在 packages 更新前会漏掉定制，因此不能单独部署任一半。本地此次不提交、不推送、不 dispatch、不构建。

## 资源与版本

每天香港时间 02:00（Actions UTC `0 18 * * *`，UTC 前一天 18:00）统一执行资源更新与 sing-box 正式版/兼容检查；此 workflow 不含其他包更新。资源直接来自：

| 资源 | 真实来源 |
| --- | --- |
| geoip_cn | SagerNet/sing-geoip `rule-set` / `geoip-cn.srs` |
| geosite_cn | SagerNet/sing-geosite `rule-set-unstable` / `geosite-cn.srs` |
| dashboard | SagerNet/sing-box-dashboard `gh-pages` |

仓库预置与路由器 `.ver` 均使用 `YYYYMMDDHHmmss COMMIT`，14 位时间取对应不可变提交的真实 UTC committer 时间；下载锁定同一 COMMIT，不用下载时刻或可变 URL 的查询参数冒充版本。RPC 仅把时间作为显示版本，commit 留在元数据中用于溯源。旧 8 位日期、日期字符串、14 位时间及带 commit 格式仍可读取；旧 hash-only 不伪造时间。状态页原生显示 RPC 的版本，无需 UI 重构。

Dashboard 当前无 release/latest，采用 `gh-pages` 提交时间与 commit，不编造 tag。若未来改用 release/tag，必须另存定位 tag，显示版本取该 release 的真实 UTC 发布时间；不能把 tag 当时间或静默改变来源。

Actions 校验 SRS 的 Git blob SHA1 并用真实 sing-box 解码；dashboard zip 的每个文件对照同一 commit 的 Git tree/blob，保留真实上游字节（包括模板字符串内的尾空格）。路由器对 SRS 同样验证 Git blob 和真实解码，dashboard 从 commit 锁定的 zip 下载并验证 index。两端全部下载成功才安装；资源/版本成对替换，安装失败回滚，恢复失败保留备份。路由器由更新脚本负责 reload/回滚，RPC 不重复 reload。此为正常进程失败恢复，不承诺断电崩溃一致性或完整异步服务健康确认。

## sing-box 升级门禁

只读 SagerNet 官方 `releases/latest`，拒绝 draft、prerelease 与非严格 `vX.Y.Z` tag。`.github/scripts/update-homeproxy.py` 的 `REVIEWED` 是人工兼容审查的精确版本白名单，目前 `1.14.0`。新正式版未审查时保留当前版本，资源仍独立更新。加入白名单前应检查当前 HomeProxy 全量生成配置、目标构建能力及实机回归；脚本还验证官方二进制 SHA256、源码 SHA256、SRS 解码与离线 `sing-box check`，不启动代理。离线 smoke test 不能代替全部协议、固件构建或设备验收。

## 本地验证

```sh
UCODE_LIB_DIR=/root/.local/opt/homeproxy-ucode/lib/ucode \
  python3 -m unittest discover -s .github/tests -v
python3 .github/scripts/update-homeproxy.py
```

第一条需真实 ucode/fs/digest、busybox；测试服务只监听 loopback，SRS/init 边界在故障测试中隔离。第二条需要 gh 只读 API 访问及 curl，会真实下载官方二进制与资源，仅修改当前仓库资源及通过门禁的 sing-box Makefile；临时二进制/配置退出后删除。持久验证依赖不清理。不要直接运行 workflow 的 Commit and Push 段；提交、推送、dispatch、构建均需另行授权。
