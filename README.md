# Packages feed for ImmortalWrt / OpenWrt

Custom package feed for ImmortalWrt / OpenWrt builds.

## Included Packages

- `luci-app-homeproxy`: Modern proxy platform for ImmortalWrt/OpenWrt (supports sing-box >= 1.14.0)
- `sing-box`: Universal proxy platform, tracking official stable releases automatically

## Usage in OpenWrt / ImmortalWrt

Add to `feeds.conf` or `feeds.conf.default`:

```text
src-git mypackages https://github.com/yahuisme/packages.git;main
```

Update and install packages:

```bash
./scripts/feeds update mypackages
./scripts/feeds install -a -p mypackages
```
