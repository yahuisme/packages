"""Exercise runner discovery, focused execution and failure propagation privately."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/run-tests.sh'


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        script = self.root / '.github/scripts/run-tests.sh'
        script.parent.mkdir(parents=True)
        shutil.copy2(SOURCE, script)
        self.script = script
        self.trace = self.root / 'trace'
        self.env = dict(os.environ, TRACE=str(self.trace), TMPDIR=self.temp.name,
                        LUCI_RESOURCE_DIR=self.temp.name, NODE_PATH=os.environ.get('NODE_PATH', ''))

    def fixture(self, name, fail=False):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("require('fs').appendFileSync(process.env.TRACE, " + repr(name + '\n') + ");\n" +
                        ('process.exit(7);\n' if fail else ''))
        return name

    def run_runner(self, *args):
        return subprocess.run(['sh', str(self.script), *args], env=self.env,
                              capture_output=True, text=True, timeout=10)

    def test_shared_suite_runs_once_and_lifecycle_entrypoints_are_discovered(self):
        names = [self.fixture(n) for n in (
            'tests/test_shared.cjs',
            'tests/helpers/test_page_lifecycle.cjs',
            'tests/helpers/test_connection_lifecycle.cjs')]
        result = self.run_runner()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        actual = self.trace.read_text().splitlines()
        self.assertCountEqual(actual, names)
        self.assertEqual(len(actual), len(set(actual)))

    def test_repository_python_suites_are_discovered_and_selectable(self):
        target = self.root / '.github/tests/test_transactions.py'
        target.parent.mkdir(parents=True)
        target.write_text('import unittest\nclass Transactions(unittest.TestCase):\n'
                          ' def test_failure(self): self.fail("transaction sentinel")\n')
        for args in [(), ('.github/tests/test_transactions.py',)]:
            with self.subTest(args=args):
                result = self.run_runner(*args)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('transaction sentinel', result.stdout)

    def test_sing_box_service_suite_is_discovered_and_selectable(self):
        target = self.root / 'sing-box/tests/test_init.py'
        target.parent.mkdir(parents=True)
        target.write_text('import unittest\nclass Init(unittest.TestCase):\n'
                          ' def test_failure(self): self.fail("init sentinel")\n')
        for args in [(), ('sing-box/tests/test_init.py',)]:
            with self.subTest(args=args):
                result = self.run_runner(*args)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('init sentinel', result.stdout)

    def test_documented_modes_are_discovered_deduplicated_and_aggregate_each_failure(self):
        suites = {
            'luci-app-airoha-flowsense/tests/test_view.js': ['default', 'ERROR_MESSAGES_TEST'],
            'luci-app-wifi7/tests/permissions-reentry.cjs': ['revoked', 'reentry', 'pending'],
            'luci-app-wifi7/tests/wireless-runtime.cjs': ['availability', 'cost'],
            'luci-app-wifi7/tests/known-defects.cjs': ['text', 'lifecycle', 'rpc'],
            'luci-app-wifi7/tests/render-reuse.cjs': ['radio', 'mlo-runtime', 'mlo-summary'],
            'luci-app-wifi7/tests/view.test.js': ['default', 'NATIVE_TEST', 'MLO_TEST', 'DENIED_TEST'],
            'luci-app-wifi7/tests/regression.test.js': ['default', 'NATIVE_TEST', 'MLO_TEST', 'READONLY_TEST', 'MISSING_MODE_TEST'],
        }
        for name, modes in suites.items():
            with self.subTest(suite=name):
                target = self.root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("const fs=require('fs');\n"
                                  "const keys=['ERROR_MESSAGES_TEST','NATIVE_TEST','MLO_TEST','DENIED_TEST','READONLY_TEST','MISSING_MODE_TEST'];\n"
                                  "const mode=keys.find(k=>process.env[k]==='1') || process.argv[2] || 'default';\n"
                                  "fs.appendFileSync(process.env.TRACE, mode+'\\n');\n"
                                  "if(mode===process.env.FAIL_MODE)process.exit(7);\n")
                try:
                    for selection in [(), (name, name)]:
                        for failure in [None, *modes]:
                            with self.subTest(selection=selection, failure=failure):
                                self.trace.unlink(missing_ok=True)
                                self.env.pop('FAIL_MODE', None)
                                if failure is not None:
                                    self.env['FAIL_MODE'] = failure
                                result = self.run_runner(*selection)
                                self.assertEqual(result.returncode == 0, failure is None,
                                                 result.stdout + result.stderr)
                                self.assertEqual(self.trace.read_text().splitlines(), modes,
                                                 result.stdout + result.stderr)
                                self.assertIn(('1 passed, 0 unverified, 0 failed' if failure is None else
                                               '0 passed, 0 unverified, 1 failed'), result.stdout)
                    # Ambient mode flags must not collapse the normal/other branches.
                    polluted = {key: '1' for key in ('ERROR_MESSAGES_TEST', 'NATIVE_TEST', 'MLO_TEST',
                                                     'DENIED_TEST', 'READONLY_TEST', 'MISSING_MODE_TEST')}
                    self.trace.unlink(missing_ok=True)
                    self.env.pop('FAIL_MODE', None)
                    self.env.update(polluted)
                    result = self.run_runner(name)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(self.trace.read_text().splitlines(), modes)
                finally:
                    target.unlink()
                    for key in ('FAIL_MODE', 'ERROR_MESSAGES_TEST', 'NATIVE_TEST', 'MLO_TEST',
                                'DENIED_TEST', 'READONLY_TEST', 'MISSING_MODE_TEST'):
                        self.env.pop(key, None)

    def test_only_exact_support_modules_are_excluded(self):
        helpers = [self.fixture(name, fail=True) for name in (
            'luci-app-wifi7/tests/harness.js',
            'luci-app-wifi7/tests/mlo-luci-dom.cjs',
            'luci-app-airoha-npu/tests/l10n.js',
            'luci-app-homeproxy/tests/client_generator_fixture.py',
            'luci-app-homeproxy/tests/dns_runtime_fixture.py',
            'luci-app-homeproxy/tests/ntp-bootstrap-runtime.py',
            'luci-app-homeproxy/tests/subscription_uci_fixture.py',
            'luci-app-homeproxy/tests/subscription_transaction_fixture.py')]
        target = self.fixture('luci-app-airoha-fancontrol/tests/harness.js')
        for selection in [(), (*helpers, target, target)]:
            self.trace.unlink(missing_ok=True)
            result = self.run_runner(*selection)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(self.trace.read_text().splitlines(), [target])

    def test_empty_inventory_is_rejected(self):
        result = self.run_runner()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('No runnable suites', result.stdout)

    def test_python_file_with_no_tests_is_rejected(self):
        target = self.root / 'luci-app-homeproxy/tests/test_empty.py'
        target.parent.mkdir(parents=True)
        target.write_text('# accidentally empty test module\n')
        result = self.run_runner(str(target.relative_to(self.root)))
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_explicit_selection_runs_only_requested_suite_once(self):
        target = self.fixture('tests/test_target.cjs')
        self.fixture('tests/test_unrelated.cjs', fail=True)
        result = self.run_runner(target, target)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.trace.read_text().splitlines(), [target])

    def test_python_unittest_without_main_is_executed(self):
        target = self.root / 'luci-app-homeproxy/tests/test_no_main.py'
        target.parent.mkdir(parents=True)
        target.write_text('import unittest\nclass Hidden(unittest.TestCase):\n'
                          ' def test_failure(self): self.fail("discovery sentinel")\n')
        result = self.run_runner(str(target.relative_to(self.root)))
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('discovery sentinel', result.stdout)

    def test_dotted_python_filename_executes_tests(self):
        target = self.root / 'luci-app-wifi7/tests/probes.test.py'
        target.parent.mkdir(parents=True)
        target.write_text('import unittest\nclass Probe(unittest.TestCase):\n'
                          ' def test_probe(self): self.assertTrue(True)\n')
        result = self.run_runner(str(target.relative_to(self.root)))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('1 passed', result.stdout)

    def test_failure_output_and_status_are_preserved(self):
        target = self.fixture('tests/test_failed.cjs', fail=True)
        result = self.run_runner(target)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('FAIL ' + target, result.stdout)

    def test_invalid_selection_fails_without_running_other_suites(self):
        self.fixture('tests/test_unrelated.cjs')
        result = self.run_runner('tests/missing.cjs')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.trace.exists())


if __name__ == '__main__':
    unittest.main()
