# 迁移校验

`test_migration.py` 对照两个不可变的迁移前 Git 快照，检查完整补丁清单与文件字节；仅允许删除 `920` 原首个 txpower 判断 hunk。

- OpenWrt：[`b527db7ab1f918f0467056c50c332cafe31df7c8`](https://github.com/yahuisme/w1700k-openwrt/commit/b527db7ab1f918f0467056c50c332cafe31df7c8)
- ImmortalWrt：[`b61b737b26b06b1be1085f356c761cb516aa618e`](https://github.com/yahuisme/w1700k-immortalwrt/commit/b61b737b26b06b1be1085f356c761cb516aa618e)

从 packages 根目录运行：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 w1700k-patches/tests/test_migration.py
```

默认读取相邻的两个 W1700K Git 仓库；其他位置设置 `W1700K_OPENWRT_REPO`、`W1700K_IMMORTALWRT_REPO`，仓库须含对应快照。

本测试只验证迁移完整性，不应用补丁、不编译、不修改固件仓库。后续补丁维护需另行验证源码适用性及功能，不能以迁移校验代替。
