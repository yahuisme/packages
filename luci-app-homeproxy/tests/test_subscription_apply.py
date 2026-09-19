"""Real subscription main/exit -> native ash reload, private platform boundaries.

UCI/download are fixtures (not router libuci); runtime assertions reuse the
production init/rc.common/procd regression. No host init or daemon is invoked.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import test_reload as runtime
import test_subscription_reconcile as reconcile
from test_subscription_parsing import BASE


class SubscriptionApply(unittest.TestCase):
    def run_subscription(self, root, command, *, changed=True, commit=True,
                         running=True, resources=False, payload=reconcile.GOOD,
                         env=None):
        """Reuse the real-parser/main fixture, replacing only its apply stub."""
        production = (BASE / 'update_subscriptions.uc').read_text()
        name = 'reload_service' if 'function reload_service' in production else 'restart_service'
        helper = production[production.index('function ' + name):production.index('function has_value')]
        real_run = subprocess.run
        captured = []

        def run(args, **kwargs):
            if args[0] != 'ucode':
                return real_run(args, **kwargs)
            source = Path(args[-1]).read_text()
            source = source.replace('resources_updated=false', 'resources_updated=' + json.dumps(resources))
            source = source.replace('function log(...args) {}', "function log(...args) { warn(join(' ', args) + '\\n'); }")
            source = source.replace('function restart_service(){return true;}\nfunction apply_updated_resources(){return true;}', '')
            source = source.replace('function reload_service(){return true;}\nfunction apply_updated_resources(){return true;}', '')
            source = source.replace('function main()', helper + '\nfunction main()')
            source = 'const service_running=' + json.dumps(running) + ';\n' + source
            source = source.replace('changes:()=>({changed:true})', 'changes:()=>(' + ('{changed:true}' if changed else '{}') + ')')
            source = source.replace('commits++;return true;', "commits++;warn('COMMIT\\n');return " + json.dumps(commit) + ';')
            # Keep the production catch/exit path; print fixture state only when
            # the updater actually reaches normal completion.
            source = source[:source.index('main(); print(')] + production[production.index('if (!isEmpty(subscription_urls))'):]
            source = source.replace('/etc/init.d/homeproxy', command)
            script = root / 'subscription.uc'
            script.write_text(source)
            result = real_run(args[:-1] + [str(script)], env=env, capture_output=True, text=True)
            captured.append(result)
            # Reconcile's wrapper only decodes JSON; our caller checks real status.
            return subprocess.CompletedProcess(args, 0, '{}', '')

        with patch.object(reconcile.subprocess, 'run', run):
            reconcile.SubscriptionReconcile().run_main(payload)
        return captured[0]

    def test_subscription_failure_retains_runtime(self):
        real_run = subprocess.run
        for fault in ['runtime-init', 'cleanup', 'generate', 'generate-server', 'check',
                      'install', 'firewall-pre', 'fw4', 'dns-prepare', 'dns', 'ubus', '']:
            with self.subTest(fault=fault):
                def run(args, **kwargs):
                    if args[:2] != ['busybox', 'ash']:
                        return real_run(args, **kwargs)
                    script = Path(args[2])
                    root = script.parent
                    code = script.read_text()
                    code = code.replace('reload\nexit $?\n', runtime.fn(runtime.RC, 'start', '\t') +
                                        runtime.fn(runtime.RC, 'restart') + '"$1"\nexit $?\n')
                    script.write_text(code)
                    result = self.run_subscription(root, 'busybox ash ' + str(script), env=kwargs['env'])
                    self.assertIn('COMMIT\n', result.stderr)
                    if fault:
                        self.assertEqual(result.returncode, 1, result.stderr)
                        self.assertIn('Failed to reload HomeProxy', result.stderr)
                        self.assertNotIn('Successfully updated subscriptions.', result.stderr)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertIn('Successfully updated subscriptions.', result.stderr)
                    return subprocess.CompletedProcess(args, result.returncode, result.stdout, '')
                with patch.object(runtime.subprocess, 'run', run):
                    # Checks byte equality, preparation inodes, client/server logs,
                    # no kill, return status, submission count and watched files.
                    runtime.Reload().run_case(fault, 'both')

    def test_resources_fallback_reports_failure_without_commit(self):
        for payload in [reconcile.GOOD, 'invalid subscription']:
            with self.subTest(payload=payload), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                command = root / 'service'
                command.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "' + str(root / 'calls') + '"\nexit 1\n')
                command.chmod(0o755)
                result = self.run_subscription(root, str(command), changed=False,
                                               resources=True, payload=payload)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertNotIn('COMMIT\n', result.stderr)
                self.assertIn('Failed to reload HomeProxy', result.stderr)
                self.assertNotIn('Successfully updated subscriptions.', result.stderr)
                self.assertEqual((root / 'calls').read_text().splitlines(), ['reload'])

    def test_commit_noop_stopped_and_resources_contract(self):
        cases = [
            # changed, commit result, running, resources, commit/apply/exit
            (True, True, True, False, True, True, 0),
            (True, False, True, False, True, False, 1),
            (False, True, True, False, False, False, 0),
            (True, True, False, False, True, False, 0),
            (False, True, True, True, False, True, 0),
        ]
        for changed, commit, running, resources, want_commit, want_apply, status in cases:
            with self.subTest(case=(changed, commit, running, resources)), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                command = root / 'service'
                command.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "' + str(root / 'calls') + '"\n')
                command.chmod(0o755)
                result = self.run_subscription(root, str(command), changed=changed, commit=commit,
                                               running=running, resources=resources)
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertEqual('COMMIT\n' in result.stderr, want_commit)
                calls = (root / 'calls').read_text().splitlines() if (root / 'calls').exists() else []
                self.assertEqual(calls, ['reload'] if want_apply else [])
                if want_apply and want_commit:
                    self.assertLess(result.stderr.index('COMMIT\n'), result.stderr.index('Reloading service'))
                if status:
                    self.assertNotIn('Successfully updated subscriptions.', result.stderr)


if __name__ == '__main__':
    unittest.main()
