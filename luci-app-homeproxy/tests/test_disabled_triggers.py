"""Native procd/jshn trigger serialization; no compilation or services."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import unittest

APP = Path(__file__).resolve().parents[1]


def function(source, name):
    start = source.index(name + '() {')
    return source[start:source.index('\n}', start) + 2] + '\n'


class DisabledTriggers(unittest.TestCase):
    def triggers(self, main='nil', server='0'):
        tree = Path(os.environ['OPENWRT_SOURCE'])
        procd = (tree / 'package/system/procd/files/procd.sh').read_text()
        jshn_bin = shutil.which('jshn')
        if jshn_bin is None:
            self.fail('Install native libubox jshn')
        jshn = os.environ.get('JSHN_SH') or str(
            Path(jshn_bin).resolve().parents[1] / 'share/libubox/jshn.sh')
        names = ['_procd_open_trigger', '_procd_close_trigger',
                 '_procd_add_array_data', '_procd_add_raw_trigger',
                 '_procd_add_reload_trigger', '_procd_add_config_trigger',
                 '_procd_add_timeout']
        code = '. ' + shlex.quote(jshn) + '\n'
        code += ''.join(function(procd, name) for name in names)
        code += '\n'.join(f'{name[1:]}() {{ {name} "$@"; }}' for name in names)
        code += '\n' + function((APP / 'root/etc/init.d/homeproxy').read_text(), 'service_triggers')
        code += '''
config_load() { [ "$1" = homeproxy ]; }
config_get() { [ "$2.$3" = config.main_node ] || exit 91; export "$1=${MAIN:-$4}"; }
config_get_bool() { [ "$2.$3" = server.enabled ] || exit 92; export "$1=${SERVER:-$4}"; }
CONF=homeproxy
PROCD_RELOAD_DELAY=1000
initscript=/etc/init.d/homeproxy
json_init
_procd_open_trigger
service_triggers
_procd_close_trigger
json_dump
'''
        out = subprocess.run(['busybox', 'ash', '-c', code],
                             env=dict(os.environ, MAIN=main, SERVER=server),
                             capture_output=True, text=True, check=True)
        self.assertEqual(out.stderr, '')
        return json.loads(out.stdout)['triggers']

    def test_disabled_keeps_apply_trigger_without_interface_wakeups(self):
        command = ['run_script', '/etc/init.d/homeproxy', 'reload']
        for main in ['nil', '']:
            with self.subTest(main=main):
                self.assertEqual(self.triggers(main), [
                    ['config.change', ['if', ['eq', 'package', 'homeproxy'], command], 1000]])

    def test_enabled_modes_keep_all_interface_and_apply_triggers(self):
        command = ['run_script', '/etc/init.d/homeproxy', 'reload']
        for main, server in [('node', '0'), ('urltest', '0'), ('nil', '1'), ('node', '1')]:
            with self.subTest(main=main, server=server):
                expected = [
                    ['config.change', ['if', ['eq', 'package', 'homeproxy'], command], 1000]]
                if main not in ('nil', ''):
                    expected.append(['config.change', ['if', ['eq', 'package', 'system'], command], 1000])
                expected.append(['interface.*', [command], 1000])
                self.assertEqual(self.triggers(main, server), expected)


if __name__ == '__main__':
    unittest.main()
