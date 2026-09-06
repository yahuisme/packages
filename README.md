# packages

ImmortalWrt / OpenWrt 专属软件包源。

## 包含组件

- `luci-app-homeproxy`：现代化代理客户端（支持 sing-box >= 1.14.0）
- `sing-box`：通用代理平台，自动跟随官方正式版（Stable Release）更新

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
