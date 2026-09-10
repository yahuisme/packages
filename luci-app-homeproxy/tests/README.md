# Focused regression checks

User direct/proxy/custom text lists live in `/etc/homeproxy/diversion/{id}.txt`; public SRS and `.ver` snapshots remain in `/etc/homeproxy/resources/`. The upstream migration scans legacy files independently of UCI references, merges/deduplicates when both paths exist, and keeps old-only file bytes unchanged via rename. `test_list_migration.py` executes the complete migration and RPC with real ucode/fs in private fixtures (UCI/hostname validation boundaries stubbed), covering orphan preservation, repeated runs, short-write/read/rename/unlink failures and retry. The updater regression preserves both final-path lists and not-yet-migrated legacy lists through updates and rollback.

```sh
NODE_PATH="$(npm root -g)" LUCI_RESOURCE_DIR=/path/to/luci-base/htdocs/luci-static/resources node tests/test_status_dom.cjs
NODE_PATH="$(npm root -g)" LUCI_RESOURCE_DIR=/path/to/luci-base/htdocs/luci-static/resources node tests/test_connection_dom.cjs
UCODE_LIB_DIR=/root/.local/opt/homeproxy-ucode/lib/ucode python3 tests/test_resource_versions.py
UCODE_LIB_DIR=/root/.local/opt/homeproxy-ucode/lib/ucode python3 tests/test_list_migration.py
```

The DOM test executes upstream LuCI RPC and DOM with fixture transport. The updater test executes BusyBox ash, curl and ucode (fs/digest modules required), using local HTTP resources and harmless decoder/init stubs. On hosts with an out-of-tree digest module, set `UCODE_LIB_DIR` (wrapper expects `/usr/local/bin/ucode`). No proxy daemon is started.

The command above uses this host's persistent module installation; on another host, use its own compatible module directory, or omit `UCODE_LIB_DIR` if digest is installed in ucode's default search path. This host retains the upstream ucode source at `/root/.local/opt/homeproxy-ucode/src` (commit `64cf18aa55c67e73b9acd0262a44d50b41774ed8`), with build output and installed `lib/ucode/digest.so` under the same prefix. It does not depend on a temporary module directory. Build prerequisites are CMake, a C compiler, pkg-config, json-c development headers and libmd development headers (Debian: `cmake build-essential pkg-config libjson-c-dev libmd-dev`). To rebuild from that retained source:

```sh
cmake -S /root/.local/opt/homeproxy-ucode/src -B /root/.local/opt/homeproxy-ucode/build -DCMAKE_INSTALL_PREFIX=/root/.local/opt/homeproxy-ucode -DDIGEST_SUPPORT=ON -DDIGEST_SUPPORT_EXTENDED=ON
cmake --build /root/.local/opt/homeproxy-ucode/build --target digest_lib -j2
install -m 0755 /root/.local/opt/homeproxy-ucode/build/digest.so /root/.local/opt/homeproxy-ucode/lib/ucode/digest.so
```

Clean-environment verification, runnable from any working directory:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/ucode -L /root/.local/opt/homeproxy-ucode/lib/ucode -e 'import { sha1 } from "digest"; import { readfile } from "fs"; assert(sha1("abc") == "a9993e364706816aba3e25717850c26c9cd0d89d"); assert(length(readfile("/root/packages/luci-app-homeproxy/tests/test_resource_versions.py")) > 0); print("fs/digest OK\n");'
env -i PATH=/usr/local/bin:/usr/bin:/bin UCODE_LIB_DIR=/root/.local/opt/homeproxy-ucode/lib/ucode python3 /root/packages/luci-app-homeproxy/tests/test_resource_versions.py
```

Resource versions use `YYYYMMDDHHmmss COMMIT` in the existing `.ver` file so data and metadata stage/rollback together. The timestamp is the real UTC committer timestamp from the same GitHub response as the immutable commit, not the updater's local clock. RPC exposes the full 14-digit timestamp, without the commit. Legacy `YYYY-MM-DD` (with or without commit) remains date-only: missing hours/minutes/seconds are never invented. Legacy 14-digit versions remain unchanged; commit-only records display `-` until verified metadata is available. The packaged dashboard retains its original 14-digit legacy version because its bundled files differ from the upstream archive; do not attach an unverified commit. Rule-set Actions and runtime downloads retain pinned blob verification and decoder checks.
