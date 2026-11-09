"""Actual rpcd Save/Apply/confirm/rollback/Revert in a private offline rootfs.

Setup-test-tools.py supplies the checksum-verified OpenWrt rootfs. No service or
UCI command is ever executed on the host. No core or init system is started.
"""
import json
import os
from pathlib import Path

import subprocess
import tarfile
import tempfile
import unittest


class DomainSessionRPC(unittest.TestCase):
    def test_native_sessions_apply_rollback_revert(self):
        archive = Path(os.environ.get('OPENWRT_ROOTFS',
                       str(Path(os.environ.get('OPENWRT_TOOLS', '/nonexistent')) / 'rootfs.tar.gz')))
        if os.geteuid() != 0 or not archive.is_file():
            self.skipTest('private rpcd namespace requires root and setup-test-tools rootfs')
        with tempfile.TemporaryDirectory(prefix='hp-domain-rpc-') as directory:
            root = Path(directory)
            with tarfile.open(archive) as tar:
                tar.extractall(root, filter='fully_trusted')
            for name in ('dev', 'tmp', 'var/run/ubus', 'etc/homeproxy/diversion'):
                (root / name).mkdir(parents=True, exist_ok=True)
            for name, minor in [('null', 3), ('random', 8), ('urandom', 9)]:
                path = root / ('dev/' + name)
                if not path.exists():
                    os.mknod(path, 0o20666, os.makedev(1, minor))
            # UCI is in rpcd itself; do not load unrelated executable plugins.
            for path in (root / 'usr/lib/rpcd').glob('*.so'):
                path.unlink()
            (root / 'etc/config/homeproxy').write_text("config homeproxy 'diversion'\n option direct_list 'old.example'\n")
            legacy = root / 'etc/homeproxy/diversion/direct.txt'
            legacy.write_text('legacy.example\n')
            (root / 'probe.sh').write_text(r'''#!/bin/sh
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
ubusd -s /var/run/ubus/ubus.sock & us=$!
sleep 1
rpcd -s /var/run/ubus/ubus.sock & rp=$!
trap 'kill "$rp" "$us"; wait' EXIT
sleep 1
session() {
 sid=$(ubus call session create '{}' | jsonfilter -e '@.ubus_rpc_session')
 ubus call session grant "{\"ubus_rpc_session\":\"$sid\",\"scope\":\"uci\",\"objects\":[[\"homeproxy\",\"read\"],[\"homeproxy\",\"write\"]]}" >/dev/null
 printf '%s' "$sid"
}
a=$(session); b=$(session)
setlist() { ubus call uci set "{\"ubus_rpc_session\":\"$1\",\"config\":\"homeproxy\",\"section\":\"diversion\",\"values\":{\"direct_list\":\"$2\"}}"; }
getlist() { ubus call uci get "{\"ubus_rpc_session\":\"$1\",\"config\":\"homeproxy\",\"section\":\"diversion\",\"option\":\"direct_list\"}" | jsonfilter -e '@.value'; }
record() { printf '%s=%s\n' "$1" "$(getlist "$2")" >> /tmp/result; }
setlist "$a" new.example
record staged-a "$a"; record staged-b "$b"
printf 'committed-save=%s\n' "$(uci -q get homeproxy.diversion.direct_list)" >> /tmp/result
# Another live session stages independently, without stealing a's bytes.
setlist "$b" other.example
record concurrent-a "$a"; record concurrent-b "$b"
ubus call uci revert "{\"ubus_rpc_session\":\"$b\",\"config\":\"homeproxy\"}"
# Permission failure must leave a's draft and committed bytes unchanged.
if ubus call uci apply "{\"ubus_rpc_session\":\"00000000000000000000000000000000\",\"rollback\":true,\"timeout\":2}" >/dev/null 2>&1; then exit 81; fi
record denied-a "$a"
ubus call uci apply "{\"ubus_rpc_session\":\"$a\",\"rollback\":true,\"timeout\":2}"
printf 'during-apply=%s\n' "$(uci -q get homeproxy.diversion.direct_list)" >> /tmp/result
# A second session must not take over the first one's rollback-protected Apply.
if ubus call uci apply "{\"ubus_rpc_session\":\"$b\",\"rollback\":true,\"timeout\":2}" >/dev/null 2>&1; then exit 82; fi
sleep 3
printf 'rolled-back=%s\n' "$(uci -q get homeproxy.diversion.direct_list)" >> /tmp/result
record restored-draft "$a"
ubus call uci revert "{\"ubus_rpc_session\":\"$a\",\"config\":\"homeproxy\"}"
record reverted "$a"
setlist "$a" confirmed.example
ubus call uci apply "{\"ubus_rpc_session\":\"$a\",\"rollback\":true,\"timeout\":2}"
ubus call uci confirm "{\"ubus_rpc_session\":\"$a\"}"
sleep 3
printf 'confirmed=%s\n' "$(uci -q get homeproxy.diversion.direct_list)" >> /tmp/result
record visible-b "$b"
# JSON escaped newlines must survive native rpcd/libuci export and reload.
setlist "$a" 'line-one.example\nline-two.example\n'
ubus call uci apply "{\"ubus_rpc_session\":\"$a\",\"rollback\":true,\"timeout\":2}"
ubus call uci confirm "{\"ubus_rpc_session\":\"$a\"}"
ubus call uci get "{\"ubus_rpc_session\":\"$b\",\"config\":\"homeproxy\",\"section\":\"diversion\",\"option\":\"direct_list\"}" > /tmp/multiline.json
uci export homeproxy > /tmp/export
mkdir /tmp/import
uci -c /tmp/import import homeproxy < /tmp/export
uci -c /tmp/import commit homeproxy
uci -c /tmp/import get homeproxy.diversion.direct_list > /tmp/imported
''')
            run = subprocess.run(['unshare', '--mount', '--net', '--pid', '--fork', '--kill-child',
                                  'chroot', str(root), '/bin/sh', '/probe.sh'],
                                 capture_output=True, text=True, timeout=25)
            self.assertEqual(run.returncode, 0, run.stderr + run.stdout)
            self.assertEqual(run.stderr, '')
            self.assertEqual(dict(line.split('=', 1) for line in (root / 'tmp/result').read_text().splitlines()), {
                'staged-a': 'new.example', 'staged-b': 'old.example', 'committed-save': 'old.example',
                'concurrent-a': 'new.example', 'concurrent-b': 'other.example', 'denied-a': 'new.example',
                'during-apply': 'new.example', 'rolled-back': 'old.example', 'restored-draft': 'new.example',
                'reverted': 'old.example', 'confirmed': 'confirmed.example', 'visible-b': 'confirmed.example'})
            self.assertEqual(legacy.read_text(), 'legacy.example\n')
            self.assertEqual(json.loads((root / 'tmp/multiline.json').read_text())['value'],
                             'line-one.example\nline-two.example\n')
            self.assertEqual((root / 'tmp/imported').read_text(),
                             'line-one.example\nline-two.example\n\n')


if __name__ == '__main__':
    unittest.main()
