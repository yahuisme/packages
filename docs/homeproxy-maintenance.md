# HomeProxy 维护记录

## 来源

- 实机稳定基线：[b82dd32](https://github.com/yahuisme/packages/commit/b82dd3209bd8d9e6d5d47dc6b0cd285a3874c81a)，包含 IPv6 开关修复及上游连接测试逻辑。
- 最后上游镜像：[a2f2057](https://github.com/yahuisme/packages/commit/a2f20573763a1df570c730eca1f9b076dc80314f)，对应 VIKINGYFY/packages `0d58e33f8f728dcd65c1f51210ff665f6ed931ed` 的 HomeProxy 内容。
- 独立维护迁移：[141b76e](https://github.com/yahuisme/packages/commit/141b76e)。原 runtime/UI 补丁吸收进源码，删除补丁层；MX4200 配套接入：[600806e](https://github.com/yahuisme/mx4200-immortalwrt/commit/600806e)。

## 维护规则

- 不再自动覆盖 HomeProxy 源码；按需移植安全、故障及兼容修复，提交中记录来源。
- 每日香港时间 02:00 更新资源并检查 sing-box 官方稳定版；新核心版本通过兼容审查后加入 `update-homeproxy.py` 的 `REVIEWED` 白名单。
- GeoIP：`SagerNet/sing-geoip` 的 `rule-set`；GeoSite：`SagerNet/sing-geosite` 的 `rule-set-unstable`。
- Dashboard：`SagerNet/sing-box-dashboard` 的 `gh-pages`，不内置、不参与默认更新，仅在资源管理中手动下载、更新或移除。
- 内置与在线资源统一使用 `YYYYMMDDHHmmss COMMIT`，时间取来源提交的 UTC 时间；下载锁定该提交，校验后安装，失败保留或恢复旧资源。
- 资源自动提交：`chore: update resources <14位版本>`；sing-box：`chore: update sing-box <版本>`。
