# TX-free 源码夹具

`mt7996/mac.c` 仅包含官方 `mt7996_mac_tx_free()` 原始函数，取自 openwrt/mt76 提交 `0936617dc529ff9da0385221d3fa6de732231177`。

- 原始文件 SHA-256：`afbb328d9711a5eb335c3f36230b25cbe26fb66154fe9738b157ccff23e9899f`
- 提取函数 SHA-256：`a22a9a73f3db00e933ee79041dbf41e9d1abe481e1d7c7babffe2ff0d0ec8fbf`
- 原文件许可：BSD-3-Clause-Clear；Copyright (C) 2022 MediaTek Inc.

测试在私有目录应用实际补丁，要求仅将描述符截断分支的 `return` 改为 `break`，保留告警、正常路径和全部收尾。属于源码契约验证，不编译或执行内核 C，不等于硬件测试。
