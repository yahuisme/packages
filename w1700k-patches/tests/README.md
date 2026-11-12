# 迁移校验

`test_migration.py` 对照两个不可变的迁移前 Git 快照，检查完整补丁清单与文件字节；允许删除 `920` 原首个 txpower 判断 hunk；通用 `610` 保留 OpenWrt 原始字节，两版最终 regdb 等价性由 `test_regdb.py` 验证。

- OpenWrt：[`b527db7ab1f918f0467056c50c332cafe31df7c8`](https://github.com/yahuisme/w1700k-openwrt/commit/b527db7ab1f918f0467056c50c332cafe31df7c8)
- ImmortalWrt：[`b61b737b26b06b1be1085f356c761cb516aa618e`](https://github.com/yahuisme/w1700k-immortalwrt/commit/b61b737b26b06b1be1085f356c761cb516aa618e)

从 packages 根目录运行：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 w1700k-patches/tests/test_migration.py
```

存在原固件仓库时读取其不可变快照；已退役仓库改用 packages 初始集中提交中保留的迁移字节。其他位置可设置 `W1700K_OPENWRT_REPO`、`W1700K_IMMORTALWRT_REPO`。

本测试只验证迁移完整性及明确允许的维护差异；`998` 本机频率校验差异保存在独立夹具中，不替换历史基线。测试不编译、不修改固件仓库，不能代替源码适用性和功能验收。

## mt76 专项校验

`913` TX-free 与 `914` RRO 修复是迁移后新增补丁，不纳入旧快照字节等价比较，由固定源码函数夹具验证。原 `912` MCU 统计改造及其专用测试、供体/协议夹具和归档已移除；保留官方统计路径：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s w1700k-patches/tests -p test_txfree_cleanup.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s w1700k-patches/tests -p test_rro_cleanup.py -v
```

`914` 另检查 RRO 拒绝数据与 skb 分配失败的缓冲区回收。测试应用实际补丁并检查源码契约，不编译或执行内核 C，不代替固件构建和实机验收。

两系统完整 mt76 源码应用顺序为各自官方前置补丁、`911`、`913`、`914`。在 mt76 `0936617dc529ff9da0385221d3fa6de732231177` 上逐个实际应用，要求 `--fuzz=0 --no-backup-if-mismatch`、无 reject/backup；合法行偏移不是依赖。删掉 `912` 后 `913` 原有 `next:` 上下文仍匹配，无需刷新。

## 多射频扫描校验

```bash
PYTHONDONTWRITEBYTECODE=1 python3 w1700k-patches/tests/test_iwinfo_scan.py -v
LUCI_CHANNEL_SOURCE=/path/to/luci/modules/luci-mod-status PYTHONDONTWRITEBYTECODE=1 python3 w1700k-patches/tests/test_channel_analysis.py -v
```

后端夹具固定 iwinfo `66bdd1a` 与两系统相同的官方 `100-multi_radio.patch`，验证完整补丁链和源码契约，不编译或执行 C。前端执行实际 LuCI 视图的加载、绘图及刷新，RPC 使用夹具数据。实际无线扫描仍需固件与设备验收。

## watchdog 与 6 GHz DFS 校验

```bash
PYTHONDONTWRITEBYTECODE=1 python3 w1700k-patches/tests/test_watchdog_timeout.py -v
PYTHONDONTWRITEBYTECODE=1 python3 w1700k-patches/tests/test_hostapd_dfs.py -v
```

watchdog 使用 `001-watchdog-reconcile-timeout.patch`，检查固定 procd 源码、调用顺序及 pending timer 源码契约；Python 数值 oracle 覆盖接受/拒绝 timeout、离线请求、停止/恢复和 last-confirmed 回退，不执行 C/ioctl 或真实 watchdog。默认 sysfs cap、解析测试和 500ms 扩展已移除；保留官方秒级 API，一秒 timeout 的次秒喂狗不在支持范围。hostapd 检查官方补丁前后源码，使用 JS 求值实际 C 布尔条件，不代表编译后的 hostapd 或射频测试。

## 通用 regdb 验证

`test_regdb.py` 使用校验和验证的源码归档，分别执行旧补丁链与新补丁链，要求完整 `db.txt` 逐字节一致。设置 `REGDB_ARCHIVE`、`REGDB_SOURCE_OPENWRT`、`REGDB_SOURCE_IMMORTALWRT` 后运行：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 w1700k-patches/tests/test_regdb.py
```

两个 source 变量指向未定制的官方源码，包含真实 regdb 配方和补丁。ImmortalWrt 新链只移除 `600-custom-change-txpower-and-dfs.patch`，不移除其他官方补丁。
