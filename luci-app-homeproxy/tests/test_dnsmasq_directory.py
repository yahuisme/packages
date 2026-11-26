"""Production DNSMasq conf-dir discovery in ash, mirroring the dnsmasq init."""
import os
from pathlib import Path
import subprocess
import unittest

APP = Path(__file__).resolve().parents[1]

# The init script runs under /etc/rc.common, which sources /lib/functions.sh, so
# config_load/config_foreach/config_get come from there. Reproduce their
# contract: config_load exposes anonymous sections under their generated
# "cfgXXXXXX" name, config_foreach filters by type and keeps uci order.
HARNESS = r'''
config_load() { :; }

config_foreach() {
	local fn="$1" want="$2" section
	for section in $SECTIONS; do
		eval "[ \"\$TYPE_$section\" = \"$want\" ] || continue"
		"$fn" "$section"
	done
}

config_get() { eval "$1=\"\${OPT_${2}_${3}}\""; }
'''


class DnsmasqDirectory(unittest.TestCase):
    def discover(self, sections, types=None, confdirs=None):
        source = (APP / 'root/etc/init.d/homeproxy').read_text()
        block = source[source.index('dnsmasq_conf_dir() {'):source.index('\nlog() {')]
        code = HARNESS + block + '\nprintf "%s\\n" "$DNSMASQ_DIR"\n'
        env = dict(os.environ, SECTIONS=' '.join(sections))
        for name, kind in (types or {}).items():
            env['TYPE_' + name] = kind
        for name, value in (confdirs or {}).items():
            env['OPT_%s_confdir' % name] = value
        result = subprocess.run(['busybox', 'ash', '-c', code], capture_output=True,
                                text=True, timeout=5, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return result.stdout.strip()

    def test_anonymous_instance_uses_generated_name(self):
        self.assertEqual(self.discover(['cfg01411c'], {'cfg01411c': 'dnsmasq'}),
                         '/tmp/dnsmasq.cfg01411c.d/dnsmasq-homeproxy.d')

    def test_first_instance_wins(self):
        self.assertEqual(
            self.discover(['cfg01411c', 'guest'],
                          {'cfg01411c': 'dnsmasq', 'guest': 'dnsmasq'},
                          {'guest': '/tmp/guest'}),
            '/tmp/dnsmasq.cfg01411c.d/dnsmasq-homeproxy.d')

    def test_named_instance_without_confdir(self):
        self.assertEqual(self.discover(['lan'], {'lan': 'dnsmasq'}),
                         '/tmp/dnsmasq.lan.d/dnsmasq-homeproxy.d')

    def test_configured_confdir_excludes_filters(self):
        for path in ('/srv/dns', '/srv/dns,.bak,.old', '/srv/dns=1 space'):
            with self.subTest(path=path):
                self.assertEqual(
                    self.discover(['cfg01411c'], {'cfg01411c': 'dnsmasq'},
                                  {'cfg01411c': path}),
                    path.split(',')[0] + '/dnsmasq-homeproxy.d')

    def test_unusable_confdir_falls_back_to_instance_default(self):
        for path in ('', ',.bak', 'dnsmasq.extra', 'dns', 'dns space'):
            with self.subTest(path=path):
                self.assertEqual(
                    self.discover(['cfg01411c'], {'cfg01411c': 'dnsmasq'},
                                  {'cfg01411c': path}),
                    '/tmp/dnsmasq.cfg01411c.d/dnsmasq-homeproxy.d')

    def test_other_sections_are_ignored(self):
        self.assertEqual(
            self.discover(['odhcpd', 'cfg01411c'],
                          {'odhcpd': 'odhcpd', 'cfg01411c': 'dnsmasq'},
                          {'odhcpd': '/tmp/odhcpd'}),
            '/tmp/dnsmasq.cfg01411c.d/dnsmasq-homeproxy.d')

    def test_missing_dnsmasq_section_uses_shared_directory(self):
        self.assertEqual(self.discover([]),
                         '/tmp/dnsmasq.d/dnsmasq-homeproxy.d')


if __name__ == '__main__':
    unittest.main()
