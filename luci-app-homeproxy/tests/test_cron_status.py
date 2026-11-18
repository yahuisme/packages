"""Complete cron wrapper in native ash; private updater/service boundaries."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP=Path(__file__).resolve().parents[1]

class CronStatus(unittest.TestCase):
    def test_workers_own_activation_and_errors_propagate_independently(self):
        cases = [
            # name, resources, subscriptions (None = unconfigured), result
            ('updated-no-change', 0, 0, 0), ('updated-subscription-busy', 0, 2, 0),
            ('updated-no-url', 0, None, 0), ('resources-current', 3, 0, 0),
            ('both-busy', 2, 2, 0), ('resource-failure-stale-result', 1, 0, 1),
            ('resource-partial', 4, 0, 1), ('subscription-partial', 3, 3, 1),
            ('subscription-failure', 0, 1, 1), ('current-no-url', 3, None, 0),
        ]
        for name, resource, subscription, expected in cases:
            with self.subTest(case=name), tempfile.TemporaryDirectory(prefix='hp-cron-status-') as directory:
                root = Path(directory)
                scripts, run = root / 'scripts', root / 'run'
                scripts.mkdir()
                run.mkdir()
                # A prior successful resource result must never affect this invocation.
                (run / 'update_resources.result').write_text('status=0\ncore_updated=1\n')
                (scripts / 'update_resources.sh').write_text(
                    '#!/bin/sh\nprintf "resources:%s\\n" "$HOMEPROXY_UPDATE_PROXY" >> "$EVENTS"\n'
                    f'exit {resource}\n')
                (scripts / 'update_subscriptions.sh').write_text(
                    '#!/bin/sh\nprintf "subscription:%s\\n" "${HOMEPROXY_RESOURCES_UPDATED-unset}" >> "$EVENTS"\n'
                    f'exit {subscription or 0}\n')
                for script in scripts.iterdir():
                    script.chmod(0o755)
                code = (APP / 'root/etc/homeproxy/scripts/update_crond.sh').read_text()
                code = (code.replace('/etc/homeproxy/scripts', str(scripts))
                            .replace('/var/run/homeproxy', str(run))
                            .replace('/etc/init.d/homeproxy', 'homeproxy_init'))
                url = 'return 1' if subscription is None else 'printf https://fixture.invalid'
                pre = (
                    'uci(){ case "$*" in *update_via_proxy) printf 1;; *mixed_port) printf 5511;; '
                    f'*subscription_url) {url};; esac; }}\n'
                    'homeproxy_init(){ printf "unexpected-init:%s\\n" "$1" >> "$EVENTS"; }\n')
                env = dict(os.environ, EVENTS=str(root / 'events'))
                env.pop('HOMEPROXY_RESOURCES_UPDATED', None)
                result = subprocess.run(['busybox', 'ash', '-c', pre + code], env=env,
                                        capture_output=True, text=True)
                events = ['resources:http://127.0.0.1:5511']
                if subscription is not None:
                    events.append('subscription:unset')
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertEqual((root / 'events').read_text().splitlines(), events)

if __name__=='__main__':unittest.main()
