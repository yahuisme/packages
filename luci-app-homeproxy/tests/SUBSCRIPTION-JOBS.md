# Subscription task permission boundary

Run from the repository root as root (the test drops to private UID/GID 65534):

```sh
. /opt/test-tools/env.sh
. /opt/test-tools/openwrt/packages-ci/env.sh
(
  ulimit -v 1048576
  HP_JOB_HOLD_SECONDS=21 PYTHONPATH=luci-app-homeproxy/tests \
    python3 -m unittest test_subscription_jobs -v
)
busybox ash -n luci-app-homeproxy/root/etc/homeproxy/scripts/update_subscriptions.sh
```

All fixtures use unique directories under `TMPDIR`. The test derives the control
path from its private `RUN_DIR`; it never writes the production `/var/run` paths.
It runs real BusyBox ash and file operations, native flock, native ucode/fs
permission validation, and `setpriv` UID/GID isolation. Only the slow subscription
ucode program is substituted. There is no compilation, browser, proxy, network,
UCI change or system-service action. The virtual-memory limit is 1 GiB per
process; the fixture uses only small files.

Task controls live in `${RUN_DIR}.subscriptions`, outside the recursively
service-owned runtime directory. Existing control directories must be non-link,
root-owned, exactly mode 0700, with a root-owned parent; unsafe paths fail closed
without changing their ownership or permissions. New files inherit umask 077.
Publication removes a stale staging entry before writing and atomically renames
onto the exact final path. This does not claim power-loss durability.

The ten tests cover:

- a real private UID planting `result.new` in the service-writable runtime
  directory, without changing an unrelated root-owned target;
- forged runtime success and lock replacement, denied writes to sibling controls;
- first-creation races rechecking a safe concurrently created directory;
- rejection of linked, foreign-owned, permissive and non-directory controls;
- stale private-stage symlinks, final file mode 0600 and exact worker exit codes;
- staging-cleanup and rename failures returning failure, never success;
- rejection of a direct worker lacking inherited fd 9;
- synchronous success/failure and a detached worker held beyond 20 seconds,
  preserving single-flight despite runtime lock replacement and forged results.

Before the fix, the UID symlink regression failed because the victim changed
from `unchanged\n` to `7\n`; runtime result forgery also produced false
`{"state":"done","code":0}`. These are host-isolated permission-boundary
reproductions, not a live router/native rpcd acceptance claim.
