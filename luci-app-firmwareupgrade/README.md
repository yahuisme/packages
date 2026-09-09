# luci-app-firmwareupgrade

从 GitHub Release 检查并升级适配当前设备的固件。

## 安全边界

- 仅为已识别的设备与变体选择 `sysupgrade` 镜像。
- 仅接受 GitHub Release 返回且带 64 位 SHA256 digest 的镜像。
- 后端保存已检查的候选镜像；启动升级时仅接收是否保留配置，浏览器不能传入下载链接、文件名或校验值。
- 下载后严格校验文件大小和 SHA256，再执行 `sysupgrade -T`。
- 任一下载、校验或预检失败均终止升级。

## 菜单

`系统 → 固件升级`
