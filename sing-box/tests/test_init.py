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

    def test_interface_triggers_do_not_restart_on_down(self):
        procd = Path(os.environ['OPENWRT_SOURCE']) / 'package/system/procd/files/procd.sh'
        jshn = Path(os.environ['OPENWRT_TOOLS']) / 'share/libubox/jshn.sh'
        self.assertTrue(procd.is_file() and jshn.is_file(), 'pinned procd.sh and jshn.sh required')
        script = '''
            readlink() { return 1; }
            config_load() { :; }
            config_get() { ifaces='wan wan6'; }
            config_get_bool() { enabled=$ENABLED; }
            . "$PROCD"
            . "$INIT"
            json_set_namespace procd
            json_init
            procd_open_trigger
            service_triggers
            procd_close_trigger
            json_dump
        '''
        with tempfile.TemporaryDirectory() as directory:
            library = Path(directory) / 'usr/share/libubox'
            library.mkdir(parents=True)
            (library / 'jshn.sh').symlink_to(jshn)
            (Path(directory) / 'var/lock').mkdir(parents=True)
            for enabled in ('0', '1'):
                result = subprocess.run(['busybox', 'ash', '-c', script], text=True, capture_output=True,
                                        env=dict(os.environ, ENABLED=enabled, INIT=str(INIT), PROCD=str(procd),
                                                 IPKG_INSTROOT=directory, initscript='/etc/init.d/sing-box'))
                self.assertEqual(result.returncode, 0, result.stderr)
                def trigger(event, key, name, command):
                    return [event, ['if', ['eq', key, name], ['run_script', '/etc/init.d/sing-box', command]], 1000]
                expected = [trigger('config.change', 'package', 'sing-box', 'reload')]
                if enabled == '1':
                    expected = [trigger('interface.update', 'interface', iface, 'restart') for iface in ('wan', 'wan6')] + expected
                self.assertEqual(json.loads(result.stdout)['triggers'], expected)

    def test_installed_default_does_not_activate_upstream_example_listener(self):
        package = INIT.parents[1]
        recipe = (package / 'Makefile').read_text()
        self.assertIn('./files/config.json $(1)/etc/sing-box/config.json', recipe)
        config = json.loads((INIT.parent / 'config.json').read_text())
        self.assertFalse(config.get('inbounds'))

    def test_removed_embedded_tor_option_is_not_advertised(self):
        recipe = (INIT.parents[1] / 'Makefile').read_text()
        self.assertNotIn('SING_BOX_TINY_BUILD_EMBEDDED_TOR', recipe)
        self.assertNotIn('with_embedded_tor', recipe)


if __name__ == '__main__':
    unittest.main()
