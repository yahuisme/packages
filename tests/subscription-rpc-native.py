"""Native OpenWrt ash/rpcd/file/ubus regression in a private chroot+net/PID namespace.

Run explicitly as root with OPENWRT_ROOTFS pointing at the checksum-verified
rootfs.tar.gz from .github/scripts/setup-test-tools.py. No compilation/network.
Only the subscription downloader is a held local command fixture.
"""
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SubscriptionRPC(unittest.TestCase):
    def test_native_start_busy_and_completion(self):
        archive = Path(os.environ['OPENWRT_ROOTFS'])
        self.assertEqual(os.geteuid(), 0, 'private chroot requires root')
        with tempfile.TemporaryDirectory(prefix='hp-rpc-') as directory:
            root = Path(directory)
            with tarfile.open(archive) as tar:
                tar.extractall(root, filter='fully_trusted')
            for directory in ['dev', 'tmp', 'var/run/ubus', 'etc/homeproxy/scripts']:
                (root / directory).mkdir(parents=True, exist_ok=True)
            for name, minor in [('null', 3), ('random', 8), ('urandom', 9)]:
                os.mknod(root / ('dev/' + name), 0o20666, os.makedev(1, minor))
            for plugin in (root / 'usr/lib/rpcd').glob('*.so'):
                if plugin.name != 'file.so':
                    plugin.unlink()
            script = root / 'etc/homeproxy/scripts/update_subscriptions.sh'
            script.write_bytes((ROOT / 'luci-app-homeproxy/root/etc/homeproxy/scripts/update_subscriptions.sh').read_bytes())
            script.chmod(0o755)
            downloader = root / 'usr/bin/ucode'
            downloader.write_text('#!/bin/sh\nprintf x >> /tmp/executions\nwhile [ ! -f /tmp/release ]; do sleep 1; done\nexit "$(cat /tmp/release)"\n')
            downloader.chmod(0o755)
            (root / 'probe.sh').write_text('''#!/bin/sh
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
mkdir -p /var/run/ubus
ubusd -s /var/run/ubus/ubus.sock &
us=$!
sleep 1
rpcd -s /var/run/ubus/ubus.sock &
rp=$!
trap 'kill "$rp" "$us"; wait' EXIT
sleep 1
call() {
 ubus -t 3 call file exec "{\\"command\\":\\"/etc/homeproxy/scripts/update_subscriptions.sh\\",\\"params\\":[\\"$1\\"]}" > /tmp/reply
 rc=$?
 printf '%s\\n' "$rc" >> /tmp/rpc-codes
 cat /tmp/reply >> /tmp/responses
 [ "$rc" = 0 ]
}
call --status || exit 1
for status in 0 7; do
 rm -f /tmp/release
 call --start || exit 1
 call --status || exit 1
 call --start || exit 1
 printf '%s\\n' "$status" > /tmp/release
 sleep 2
 call --status || exit 1
done
''')
            result = subprocess.run(['unshare', '--net', '--pid', '--fork', '--kill-child',
                                     'chroot', str(root), '/bin/sh', '/probe.sh'],
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, '')
            decoder = json.JSONDecoder()
            raw = (root / 'tmp/responses').read_text()
            replies = []
            while raw.strip():
                reply, end = decoder.raw_decode(raw.lstrip())
                self.assertEqual(reply['code'], 0, reply)
                replies.append(json.loads(reply['stdout']))
                raw = raw.lstrip()[end:]
            self.assertEqual(replies, [{'state': 'idle'}] + [item for code in [0, 7] for item in [
                {'state': 'running'}, {'state': 'running'}, {'state': 'running'},
                {'state': 'done', 'code': code}]])
            self.assertEqual((root / 'tmp/executions').read_text(), 'xx')
            self.assertEqual((root / 'tmp/rpc-codes').read_text().splitlines(), ['0'] * 9)


if __name__ == '__main__':
    unittest.main()
