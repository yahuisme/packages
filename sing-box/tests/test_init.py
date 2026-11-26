"""Run the package init body with private procd/configuration boundaries."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

INIT = Path(__file__).resolve().parents[1] / 'files/sing-box.init'


class ServiceInit(unittest.TestCase):
    def run_init(self, *, enabled=True, mkdir_status=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trace = root / 'trace'
            # All side effects are functions; no services, ownership or real dirs.
            script = '''
                readlink() { return 1; }
                config_load() { :; }
                config_get_bool() {
                    case "$2:$3" in
                    main:enabled) eval "$1=$ENABLED" ;;
                    *) eval "$1=$4" ;;
                    esac
                }
                config_get() {
                    case "$3" in
                    user) eval "$1=root" ;;
                    conffile) eval "$1=/private/config.json" ;;
                    workdir) eval "$1=/private/work" ;;
                    *) eval "$1=''" ;;
                    esac
                }
                mkdir() { return "$MKDIR_STATUS"; }
                id() { printf 'root\\n'; }
                chown() { printf 'chown\\n' >> "$TRACE"; }
                procd_open_instance() { printf 'open %s\\n' "$*" >> "$TRACE"; }
                procd_set_param() { printf 'param %s\\n' "$*" >> "$TRACE"; }
                procd_close_instance() { printf 'close\\n' >> "$TRACE"; }
                . "$INIT"
                start_service
            '''
            result = subprocess.run(['sh', '-c', script], capture_output=True, text=True,
                env=dict(os.environ, TRACE=str(trace), INIT=str(INIT),
                         initscript='/etc/init.d/sing-box', ENABLED=str(int(enabled)),
                         MKDIR_STATUS=str(mkdir_status)))
            return result.returncode, trace.read_text() if trace.exists() else ''

    def test_workdir_failure_does_not_start_service(self):
        status, trace = self.run_init(mkdir_status=1)
        self.assertNotEqual(status, 0)
        self.assertEqual(trace, '')

    def test_disabled_service_has_no_side_effects(self):
        self.assertEqual(self.run_init(enabled=False), (0, ''))

    def test_valid_service_keeps_procd_contract(self):
        status, trace = self.run_init()
        self.assertEqual(status, 0)
        self.assertIn('open sing-box.main\n', trace)
        self.assertIn('param command /usr/bin/sing-box run -c /private/config.json -D /private/work\n', trace)
        self.assertIn('param file /private/config.json\n', trace)
        self.assertIn('param user root\n', trace)
        self.assertTrue(trace.endswith('close\n'))

    def render_procd(self, body, *, enabled='1'):
        procd = Path(os.environ['OPENWRT_SOURCE']) / 'package/system/procd/files/procd.sh'
        jshn = Path(os.environ['OPENWRT_TOOLS']) / 'share/libubox/jshn.sh'
        self.assertTrue(procd.is_file() and jshn.is_file(), 'pinned procd.sh and jshn.sh required')
        script = r'''
            readlink() { return 1; }
            config_load() { :; }
            config_get() {
                case "$3" in
                    ifaces) eval "$1='wan wan6'" ;;
                    *) eval "$1=\${4-}" ;;
                esac
            }
            config_get_bool() {
                case "$3" in
                    enabled) eval "$1=$ENABLED" ;;
                    *) eval "$1=$4" ;;
                esac
            }
            mkdir() { :; }
            id() { printf 'root\n'; }
            chown() { :; }
            . "$PROCD"
            . "$INIT"
            json_set_namespace procd
            json_init
        ''' + body + '\njson_dump\n'
        with tempfile.TemporaryDirectory() as directory:
            library = Path(directory) / 'usr/share/libubox'
            library.mkdir(parents=True)
            (library / 'jshn.sh').symlink_to(jshn)
            (Path(directory) / 'var/lock').mkdir(parents=True)
            result = subprocess.run(['busybox', 'ash', '-c', script], text=True, capture_output=True,
                                    env=dict(os.environ, ENABLED=enabled, INIT=str(INIT), PROCD=str(procd),
                                             IPKG_INSTROOT=directory, initscript='/etc/init.d/sing-box'))
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)

    def test_native_procd_uses_packaged_config_when_option_is_unset(self):
        instance = self.render_procd('start_service || exit $?')['sing-box.main']
        self.assertEqual(instance['command'], ['/usr/bin/sing-box', 'run', '-c', '/etc/sing-box/config.json',
                                               '-D', '/usr/share/sing-box'])
        self.assertEqual(instance['file'], ['/etc/sing-box/config.json'])
        self.assertEqual(instance['netdev'], ['wan', 'wan6'])
        self.assertEqual(instance['limits'], {'nofile': '1000000 1000000'})

    def test_interface_triggers_do_not_restart_on_down(self):
        def trigger(event, key, name, command):
            return [event, ['if', ['eq', key, name], ['run_script', '/etc/init.d/sing-box', command]], 1000]
        for enabled in ('0', '1'):
            with self.subTest(enabled=enabled):
                expected = [trigger('config.change', 'package', 'sing-box', 'reload')]
                if enabled == '1':
                    expected = [trigger('interface.update', 'interface', iface, 'restart') for iface in ('wan', 'wan6')] + expected
                data = self.render_procd('procd_open_trigger; service_triggers; procd_close_trigger', enabled=enabled)
                self.assertEqual(data['triggers'], expected)

    def test_both_variants_install_the_same_non_listening_default(self):
        recipes = ('include Makefile\n'
                   'install-fixture:\n'
                   '	$(call Package/$(PACKAGE)/install,$(DEST))\n')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'rules.mk').write_text('INSTALL_DIR:=install -d\nINSTALL_DATA:=install -m0644\n'
                                          'INSTALL_CONF:=install -m0600\nINSTALL_BIN:=install -m0755\n')
            (root / 'package.mk').touch()
            golang = root / 'feeds/packages/lang/golang'
            golang.mkdir(parents=True)
            (golang / 'golang-package.mk').write_text('''define GoPackage/Package/Install/Bin
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(TOPDIR)/fixture $(1)/usr/bin/sing-box
endef
''')
            (root / 'fixture').write_text('placeholder binary; no compilation\n')
            for name, variant in (('sing-box', 'full'), ('sing-box-tiny', 'tiny')):
                with self.subTest(package=name):
                    dest = root / name
                    result = subprocess.run(['make', '-s', '-C', str(INIT.parents[1]), '-f', '-', 'install-fixture',
                                             f'TOPDIR={root}', f'INCLUDE_DIR={root}', f'PACKAGE={name}',
                                             f'BUILD_VARIANT={variant}', f'DEST={dest}'],
                                            input=recipes, text=True, capture_output=True, timeout=10)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    expected = {'etc/sing-box/config.json': ('config.json', 0o644),
                                'etc/config/sing-box': ('sing-box.conf', 0o600),
                                'etc/init.d/sing-box': ('sing-box.init', 0o755)}
                    self.assertEqual({str(p.relative_to(dest)) for p in dest.rglob('*') if p.is_file()},
                                     {*expected, 'usr/bin/sing-box'})
                    for relative, (source, mode) in expected.items():
                        installed = dest / relative
                        self.assertEqual(installed.read_bytes(), (INIT.parent / source).read_bytes())
                        self.assertEqual(installed.stat().st_mode & 0o777, mode)
                    config = json.loads((dest / 'etc/sing-box/config.json').read_bytes())
                    self.assertFalse(config.get('inbounds'))

    def test_removed_embedded_tor_option_is_not_advertised(self):
        recipe = (INIT.parents[1] / 'Makefile').read_text()
        self.assertNotIn('SING_BOX_TINY_BUILD_EMBEDDED_TOR', recipe)
        self.assertNotIn('with_embedded_tor', recipe)


if __name__ == '__main__':
    unittest.main()
