"""Private ash coverage of the resolver instance and conf-dir actually selected."""
import os
from pathlib import Path
import subprocess
import unittest

APP = Path(__file__).resolve().parents[1]

HARNESS = r'''
config_load() { :; }
config_foreach() {
	local fn="$1" want="$2" section
	for section in $SECTIONS; do
		eval "[ \"\$TYPE_$section\" = \"$want\" ] || continue"
		"$fn" "$section"
	done
}
config_get() { eval "$1=\"\${OPT_${2}_${3}:-$4}\""; }
config_get_bool() { config_get "$@"; }
'''


class DnsmasqDirectory(unittest.TestCase):
    def discover(self, sections, options=None):
        source = (APP / 'root/etc/init.d/homeproxy').read_text()
        block = source[source.index('dnsmasq_select() {'):source.index('\nlog() {')]
        env = dict(os.environ, SECTIONS=' '.join(sections))
        for name, kind in sections.items():
            env['TYPE_' + name] = kind
        for section, values in (options or {}).items():
            for option, value in values.items():
                env[f'OPT_{section}_{option}'] = value
        result = subprocess.run(['busybox', 'ash', '-c', HARNESS + block +
                                 '\ndnsmasq_discover; printf "%s\\n%s\\n" "$DNSMASQ_DIR" "$DNSMASQ_INCLUDE"'],
                                capture_output=True, text=True, timeout=5, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return tuple(result.stdout.splitlines())

    def test_native_first_enabled_order_and_generated_name(self):
        sections = {'odhcpd': 'odhcpd', 'disabled': 'dnsmasq', 'lan': 'dnsmasq', 'cfg03411c': 'dnsmasq'}
        options = {'disabled': {'disabled': '1'}, 'lan': {'confdir': '/private/lan'}}
        self.assertEqual(self.discover(sections, options),
                         ('/private/lan/dnsmasq-homeproxy.d', '/private/lan/dnsmasq-homeproxy.conf'))
        options['lan']['disabled'] = '1'
        self.assertEqual(self.discover(sections, options),
                         ('/tmp/dnsmasq.cfg03411c.d/dnsmasq-homeproxy.d',
                          '/tmp/dnsmasq.cfg03411c.d/dnsmasq-homeproxy.conf'))

    def test_relative_or_non_dns_default_does_not_hijack_guest(self):
        for options in ({'confdir': 'dnsmasq.extra'}, {'confdir': ',.bak'}, {'port': '0'},
                        {'confdir': '/private/lan,*.hp,.hp'}):
            with self.subTest(options=options):
                self.assertEqual(self.discover({'lan': 'dnsmasq', 'guest': 'dnsmasq'}, {'lan': options}), ('', ''))
        self.assertEqual(self.discover({}), ('', ''))

    def test_required_and_excluded_suffixes_match_dnsmasq(self):
        for spec, suffix in [('/private/lan,.bak,.old', '.conf'), ('/private/lan,*.conf', '.conf'),
                             ('/private/lan,.conf,*.hp,*.dns', '.hp'), ('/private/lan,.conf', '')]:
            with self.subTest(spec=spec):
                self.assertEqual(self.discover({'lan': 'dnsmasq'}, {'lan': {'confdir': spec}}),
                                 ('/private/lan/dnsmasq-homeproxy.d', '/private/lan/dnsmasq-homeproxy' + suffix))

    def test_required_d_suffix_keeps_include_and_rules_directory_distinct(self):
        self.assertEqual(self.discover({'lan': 'dnsmasq'}, {'lan': {'confdir': '/private/lan,*.d'}}),
                         ('/private/lan/dnsmasq-homeproxy.d', '/private/lan/dnsmasq-homeproxy-include.d'))

    def test_shared_directory_is_not_used_if_guest_would_read_include(self):
        for guest, expected in [('/private/shared', ''), ('/private/shared,*.guest', '/private/shared/dnsmasq-homeproxy.conf')]:
            with self.subTest(guest=guest):
                actual = self.discover({'lan': 'dnsmasq', 'guest': 'dnsmasq'},
                                       {'lan': {'confdir': '/private/shared'}, 'guest': {'confdir': guest}})
                self.assertEqual(actual[1], expected)


if __name__ == '__main__':
    unittest.main()
