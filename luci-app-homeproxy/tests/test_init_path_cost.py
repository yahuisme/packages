"""Full private cron output/state differential plus eliminated dirname calls."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]
INIT = APP / 'root/etc/init.d/homeproxy'


def legacy(source):
    return (source.replace('${CRON_FILE%/*}', '$(dirname "$CRON_FILE")')
            .replace('${CRON_LOCK%/*}', '$(dirname "$CRON_LOCK")'))


class InitPathCost(unittest.TestCase):
    def run_case(self, source, case):
        with tempfile.TemporaryDirectory(prefix='hp-cron-path-') as d:
            root = Path(d)
            table = root / 'cron space/root'
            table.parent.mkdir()
            table.write_text('7 3 * * * /unrelated\n')
            code = source[source.index('validate_cron_number()'):source.index('_homeproxy_start_service()')]
            preamble = r'''
CRON_FILE="$ROOT/cron space/root"
CRON_LOCK="$ROOT/lock space/root-crontab"
CRON_TAG='#homeproxy_autosetup'
HP_DIR='/etc/homeproxy'
log() { printf '%s\n' "$*" >> "$ROOT/log"; }
dirname() { printf 'dirname\n' >> "$ROOT/cost"; command dirname "$@"; }
lock() { [ "$CASE" != lock ] || return 1; [ "$CASE:$1" != unlock:-u ]; }
mkdir() { [ "$CASE" != mkdir ] || return 1; command mkdir "$@"; }
mktemp() { [ "$CASE" != mktemp ] || return 1; command mktemp "$@"; }
chmod() { [ "$CASE" != chmod ] || return 1; command chmod "$@"; }
mv() { [ "$CASE" != mv ] || return 1; command mv "$@"; }
'''
            commands = {
                'add': "configure_subscription_cron 1 '0 */6 * * *'",
                'noop': "configure_subscription_cron 0 ''",
                'first': 'rm "$CRON_FILE"; configure_subscription_cron 1 "0 */6 * * *"',
                'change': "configure_subscription_cron 1 '0 */6 * * *'; configure_subscription_cron 1 '15 */8 * * *'",
                'remove': "configure_subscription_cron 1 '0 */6 * * *'; configure_subscription_cron 0 ''",
                'invalid': "configure_subscription_cron 1 '60 * * * *'",
                'notice': 'mkdir "$ROOT/cron space/cron.update"; configure_subscription_cron 1 "0 */6 * * *"',
            }
            run = subprocess.run(['busybox', 'ash'], input=preamble + code + '\n' +
                                 commands.get(case, "configure_subscription_cron 1 '0 */6 * * *'"),
                                 env=dict(os.environ, ROOT=d, CASE=case), capture_output=True,
                                 text=True, timeout=10)
            files = {}
            for path in root.rglob('*'):
                if path.is_file() and path.name != 'cost':
                    files[str(path.relative_to(root))] = {'bytes': path.read_bytes().hex(),
                                                         'mode': path.stat().st_mode & 0o777}
            result = {'exit': run.returncode, 'stdout': run.stdout.replace(d, 'ROOT'),
                      'stderr': run.stderr.replace(d, 'ROOT'), 'files': files}
            cost = len((root / 'cost').read_text().splitlines()) if (root / 'cost').exists() else 0
            return result, cost

    def test_complete_cron_state_failure_parity_without_dirname(self):
        source = INIT.read_text()
        rows = []
        for case in ['add', 'noop', 'first', 'change', 'remove', 'invalid', 'notice',
                     'lock', 'unlock', 'mkdir', 'mktemp', 'chmod', 'mv']:
            with self.subTest(case=case):
                before, old_cost = self.run_case(legacy(source), case)
                after, new_cost = self.run_case(source, case)
                rows.append({'case': case, 'before': before, 'after': after,
                             'dirname_before': old_cost, 'dirname_after': new_cost})
                self.assertEqual(before, after)
                self.assertEqual(new_cost, 0, 'avoid external dirname for fixed absolute cron paths')
        evidence = os.environ.get('HP_P2_EVIDENCE')
        if evidence:
            root = Path(evidence)
            root.mkdir(parents=True, exist_ok=True)
            (root / 'init-path-comparison.json').write_text(json.dumps(rows, indent=2) + '\n')
            (root / 'init-source.sha256').write_text(hashlib.sha256(INIT.read_bytes()).hexdigest() + '\n')


if __name__ == '__main__':
    unittest.main()
