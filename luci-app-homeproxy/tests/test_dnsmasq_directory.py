"""Production DNSMasq path discovery in ash with private generated config files."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]


class DnsmasqDirectory(unittest.TestCase):
    def discover(self, config, confdir=None):
        with tempfile.TemporaryDirectory(prefix='hp-dnsmasq-dir-') as directory:
            root = Path(directory)
            conf = root / 'dnsmasq.conf.fixture'
            if config is not None:
                conf.write_text(config.replace('@ROOT@', str(root)))
            source = (APP / 'root/etc/init.d/homeproxy').read_text()
            block = source[source.index('DNSMASQ_UCI_CONFIG='):source.index('\nlog() {')]
            block = block.replace('/tmp/etc/dnsmasq.conf.$DNSMASQ_UCI_CONFIG', str(conf))
            block = block.replace('/tmp/dnsmasq', str(root / 'fallback'))
            code = '''uci() {
 case "$2" in
 show) printf 'dhcp.fixture=dnsmasq\\n';;
 get) [ -n "$FIXTURE_CONFDIR" ] || return 1; printf '%s\\n' "$FIXTURE_CONFDIR";;
 *) return 98;;
 esac
}\n''' + block
            code += '\nprintf "%s\\n" "$DNSMASQ_DIR"\n'
            env = dict(os.environ, FIXTURE_CONFDIR=(confdir or '').replace('@ROOT@', str(root)))
            result = subprocess.run(['busybox', 'ash', '-c', code], capture_output=True,
                                    text=True, timeout=5, env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, '')
            return result.stdout.strip().replace(str(root), '@ROOT@')

    def test_confdir_excludes_dnsmasq_filename_filters(self):
        self.assertEqual(self.discover('conf-dir=@ROOT@/dns,.bak,.old\n'),
                         '@ROOT@/dns/dnsmasq-homeproxy.d')

    def test_missing_empty_or_absent_config_uses_default_directory(self):
        for config in (None, '', 'port=53\n', 'conf-dir=\n', 'conf-dir=,.bak\n'):
            with self.subTest(config=config):
                self.assertEqual(self.discover(config), '@ROOT@/fallback.fixture.d/dnsmasq-homeproxy.d')

    def test_missing_generated_config_uses_configured_directory(self):
        for config in (None, '', 'port=53\n'):
            with self.subTest(config=config):
                self.assertEqual(self.discover(config, '@ROOT@/custom,.bak'),
                                 '@ROOT@/custom/dnsmasq-homeproxy.d')

    def test_plain_confdir_and_path_with_equals(self):
        for path in ('dns', 'dns=fixture', 'dns space'):
            with self.subTest(path=path):
                self.assertEqual(self.discover('conf-dir=@ROOT@/' + path + '\n'),
                                 '@ROOT@/' + path + '/dnsmasq-homeproxy.d')


if __name__ == '__main__':
    unittest.main()
