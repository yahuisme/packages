"""Run the package init body with private procd/configuration boundaries."""
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


if __name__ == '__main__':
    unittest.main()
