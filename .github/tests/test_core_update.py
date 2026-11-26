"""Core update publication gates and metadata; downloads are fixture boundaries."""
import contextlib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import textwrap
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('core_updater', ROOT / '.github/scripts/update-homeproxy.py')
assert spec and spec.loader
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def archive(name='source/fixture', body=b'fixture'):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w:gz') as tar:
        member = tarfile.TarInfo(name)
        member.size = len(body)
        tar.addfile(member, io.BytesIO(body))
    return data.getvalue()


class CoreUpdate(unittest.TestCase):
    def fixture(self, directory):
        root = Path(directory)
        makefile = root / 'sing-box/Makefile'
        makefile.parent.mkdir()
        source = archive()
        makefile.write_text('PKG_UPSTREAM_VERSION:=1.14.4\nPKG_HASH:=' + hashlib.sha256(source).hexdigest() + '\nPKG_RELEASE:=\n')
        resources = root / 'luci-app-homeproxy/root/etc/homeproxy/resources'
        resources.mkdir(parents=True)
        (resources / 'fixture').write_text('old')
        readme = root / 'README.md'
        readme.write_text('| `sing-box` | `1.14.4` | official stable |\n| `other` | `keep` | untouched |\n')
        return root, makefile, resources, readme, source

    def run_update(self, root, source, version, gate):
        def resources(home, binary, temp, updates):
            (home / 'resources/fixture').write_text('new')
        with patch('sys.argv', ['update-homeproxy.py', '--root', str(root)]), \
             patch.object(updater, 'api', return_value={'tag_name': 'v' + version, 'draft': False, 'prerelease': False}), \
             patch.object(updater, 'download', return_value=source), \
             patch.object(updater, 'get_binary', side_effect=lambda release, temp: temp / 'sing-box'), \
             patch.object(updater, 'resource_updates', return_value=['fixture update']), \
             patch.object(updater, 'resources', side_effect=resources), \
             patch.object(updater, 'core_compatibility', gate):
            updater.main()

    def test_core_bump_validates_before_any_publication_and_updates_readme(self):
        with tempfile.TemporaryDirectory() as directory:
            root, makefile, resources, readme, source = self.fixture(directory)
            before = (makefile.read_bytes(), resources.joinpath('fixture').read_bytes(), readme.read_bytes())
            calls = []
            def gate(binary, version, checkout, temp, *, resources_dir=None):
                self.assertEqual((makefile.read_bytes(), resources.joinpath('fixture').read_bytes(), readme.read_bytes()), before)
                self.assertEqual((version, checkout), ('1.15.0', root))
                assert resources_dir is not None, 'candidate checker must receive the staged resources'
                self.assertEqual((resources_dir / 'fixture').read_text(), 'new')
                calls.append(version)
            self.run_update(root, source, '1.15.0', gate)
            self.assertEqual(calls, ['1.15.0'])
            self.assertIn('PKG_UPSTREAM_VERSION:=1.15.0\n', makefile.read_text())
            self.assertEqual(readme.read_text(), '| `sing-box` | `1.15.0` | official stable |\n| `other` | `keep` | untouched |\n')
            self.assertEqual(resources.joinpath('fixture').read_text(), 'new')
            self.assertFalse(list(root.rglob('*.update-*')))

    def test_failed_compatibility_keeps_all_published_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root, makefile, resources, readme, source = self.fixture(directory)
            targets = [makefile, resources / 'fixture', readme]
            before = [path.read_bytes() for path in targets]
            def gate(*args, **kwargs):
                raise subprocess.CalledProcessError(1, 'injected incompatible candidate')
            with self.assertRaises(subprocess.CalledProcessError):
                self.run_update(root, source, '1.15.0', gate)
            self.assertEqual([path.read_bytes() for path in targets], before)
            self.assertFalse(list(root.glob('.homeproxy-update-*')))

    def test_resource_only_update_never_runs_core_gate_or_rewrites_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root, makefile, resources, readme, source = self.fixture(directory)
            before = (makefile.read_bytes(), readme.read_bytes())
            def gate(*args):
                self.fail('resource-only update must not prepare/run core compatibility')
            self.run_update(root, source, '1.14.4', gate)
            self.assertEqual((makefile.read_bytes(), readme.read_bytes()), before)
            self.assertEqual(resources.joinpath('fixture').read_text(), 'new')

    def test_matching_installed_blobs_skip_binary_download_and_publication(self):
        for changed in (False, True):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                root, _, resources, _, source = self.fixture(directory)
                data = b'SRS\x01fixture'
                for kind, _, _ in updater.SOURCES:
                    (resources / f'{kind}_cn.srs').write_bytes(b'bad' if changed and kind == 'geoip' else data)
                    (resources / f'{kind}_cn.ver').write_text('20240203040506 ' + 'a' * 40 + '\n')

                def api(path):
                    if path == 'sing-box/releases/latest':
                        return {'tag_name': 'v1.14.4', 'draft': False, 'prerelease': False}
                    if '/commits/' in path:
                        return {'sha': 'a' * 40, 'commit': {'committer': {'date': '2024-02-03T04:05:06Z'}}}
                    if '/contents/' in path:
                        return {'sha': updater.blob(data)}
                    self.fail(f'unexpected API call: {path}')

                def download(url):
                    if '/sing-box/tar.gz/' in url:
                        return source
                    self.assertTrue(changed and url.endswith('/geoip-cn.srs'), url)
                    return data

                with patch('sys.argv', ['update-homeproxy.py', '--root', str(root)]), \
                     patch.object(updater, 'api', side_effect=api), \
                     patch.object(updater, 'download', side_effect=download) as requests, \
                     patch.object(updater, 'get_binary', return_value=Path('/fixture/core')) as binary, \
                     patch.object(updater, 'check') as check, \
                     patch.object(updater, 'publish', wraps=updater.publish) as publish:
                    updater.main()
                self.assertEqual(requests.call_count, 2 if changed else 1)
                for call in (binary, check, publish):
                    self.assertEqual(call.call_count, int(changed))
                self.assertEqual((resources / 'geoip_cn.srs').read_bytes(), data)

    def test_readme_install_failure_rolls_back_resources_and_recipe(self):
        with tempfile.TemporaryDirectory() as directory:
            root, makefile, resources, readme, source = self.fixture(directory)
            targets = [makefile, resources / 'fixture', readme]
            before = [path.read_bytes() for path in targets]
            rename = Path.rename
            def fault(path, target):
                if Path(target) == readme and path.name == 'README.md':
                    raise OSError('injected README installation failure')
                return rename(path, target)
            with patch.object(Path, 'rename', fault), self.assertRaises(OSError):
                self.run_update(root, source, '1.15.0', lambda *args, **kwargs: None)
            self.assertEqual([path.read_bytes() for path in targets], before)
            self.assertFalse(list(root.rglob('*.update-*')))

    def test_missing_or_duplicate_sing_box_row_refuses_update(self):
        for text in ('no component row\n', '| `sing-box` | `1.14.4` | x |\n' * 2):
            with self.subTest(text=text), tempfile.TemporaryDirectory() as directory:
                root, makefile, resources, readme, source = self.fixture(directory)
                readme.write_text(text)
                before = (makefile.read_bytes(), resources.joinpath('fixture').read_bytes(), readme.read_bytes())
                with self.assertRaises(ValueError):
                    self.run_update(root, source, '1.15.0', lambda *args: None)
                self.assertEqual((makefile.read_bytes(), resources.joinpath('fixture').read_bytes(), readme.read_bytes()), before)

    def test_completed_readme_cleanup_before_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root, makefile, resources, readme, source = self.fixture(directory)
            complete = readme.with_name('README.md.update-complete')
            complete.write_text('old documentation')
            class Stop(Exception):
                pass
            def lookup(_):
                self.assertFalse(complete.exists())
                raise Stop
            with patch('sys.argv', ['update-homeproxy.py', '--root', str(root)]), \
                 patch.object(updater, 'api', side_effect=lookup), self.assertRaises(Stop):
                updater.main()


class CoreGate(unittest.TestCase):
    def test_binary_archive_is_verified_before_extracting_or_executing(self):
        name = 'sing-box-1.15.0-linux-amd64'
        body = b'#!/bin/sh\nprintf "sing-box version 1.15.0\\n"\n'
        with tempfile.TemporaryDirectory() as directory, patch.object(updater.platform, 'machine', return_value='x86_64'):
            root = Path(directory)
            source = root / 'source.tar.gz'
            stage = root / 'stage'
            stage.mkdir()
            release = {'tag_name': 'v1.15.0', 'draft': False, 'prerelease': False,
                       'assets': [{'name': name + '.tar.gz', 'browser_download_url': source.as_uri()}]}
            asset = release['assets'][0]
            source.write_bytes(archive(name + '/sing-box', body))
            asset['digest'] = 'sha256:' + '0' * 64
            with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                updater.get_binary(release, stage)
            self.assertFalse((stage / 'sing-box').exists())
            asset['digest'] = 'sha256:' + hashlib.sha256(source.read_bytes()).hexdigest()
            binary = updater.get_binary(release, stage)
            self.assertEqual(binary.read_bytes(), body)
            self.assertEqual(set(stage.iterdir()), {binary})

    def test_client_generator_uses_selected_resource_bytes(self):
        spec = importlib.util.spec_from_file_location('client_generator_fixture',
            ROOT / 'luci-app-homeproxy/tests/client_generator_fixture.py')
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            resources = Path(directory)
            for name in ('geoip_cn.srs', 'geosite_cn.srs'):
                (resources / name).write_bytes(name.encode())
            with patch.dict(os.environ, HOMEPROXY_TEST_RESOURCES=str(resources)), module.ClientGenerator() as fixture:
                for name in ('geoip_cn.srs', 'geosite_cn.srs'):
                    self.assertEqual((fixture.hp / 'resources' / name).read_bytes(), name.encode())

    def test_unprivileged_runner_uses_sudo_with_candidate_and_prepared_paths(self):
        spec = importlib.util.spec_from_file_location('core_gate_sudo', ROOT / '.github/scripts/check-core-compatibility.py')
        assert spec and spec.loader
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'sing-box'
            binary.touch()
            with patch.object(checker.os, 'geteuid', return_value=1001), \
                 patch.dict(checker.os.environ, {'GH_TOKEN': 'fixture-not-a-secret', 'UCODE_LIB_DIR': directory}), \
                 patch.object(checker.subprocess, 'call', return_value=7) as call, \
                 patch('sys.argv', ['check-core-compatibility.py', '--binary', str(binary), '--version', '1.15.0',
                                    '--resources', directory]):
                self.assertEqual(checker.main(), 7)
            command = call.call_args.args[0]
            self.assertEqual(command[:3], ['sudo', '-n', 'env'])
            self.assertIn('UCODE_LIB_DIR=' + directory, command)
            self.assertNotIn('GH_TOKEN=fixture-not-a-secret', command)
            self.assertEqual(command[-6:], ['--binary', str(binary), '--version', '1.15.0', '--resources', directory])

    def test_preparation_and_checker_failures_propagate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for fail_at in (None, 1, 2):
                calls = []
                def run(command, **kwargs):
                    calls.append(command)
                    self.assertTrue(kwargs['check'])
                    if len(calls) == fail_at:
                        raise subprocess.CalledProcessError(1, command)
                with patch.object(updater.subprocess, 'run', side_effect=run):
                    args = (root / 'sing-box', '1.15.0', root, root)
                    resources = root / 'resources'
                    if fail_at:
                        with self.assertRaises(subprocess.CalledProcessError):
                            updater.core_compatibility(*args, resources_dir=resources)
                    else:
                        updater.core_compatibility(*args, resources_dir=resources)
                self.assertEqual(len(calls), fail_at or 2)
                self.assertIn(str(root / '.github/scripts/setup-test-tools.py'), calls[0])
                if len(calls) == 2:
                    self.assertIn(str(root / '.github/scripts/check-core-compatibility.py'), calls[1])
                    self.assertEqual(calls[1][-3:], [str(root / 'sing-box'), '1.15.0', str(resources)])

    def test_checker_rejects_skips_empty_suites_and_failures(self):
        spec = importlib.util.spec_from_file_location('core_gate', ROOT / '.github/scripts/check-core-compatibility.py')
        assert spec and spec.loader
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        bodies = (
            ('import unittest\nclass Case(unittest.TestCase):\n def test_ok(self): pass\n', 0),
            ('import unittest\nclass Case(unittest.TestCase):\n @unittest.skip("injected unavailable boundary")\n def test_skip(self): pass\n', 1),
            ('import unittest\nclass Case(unittest.TestCase):\n def test_fail(self): self.fail("injected incompatible core")\n', 1),
            ('import unittest\n', None),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tests = root / 'luci-app-homeproxy/tests'
            tests.mkdir(parents=True)
            binary = root / 'sing-box'
            binary.touch()
            for body, expected in bodies:
                with self.subTest(expected=expected):
                    (tests / 'test_fixture.py').write_text(body)
                    with patch.object(checker, 'ROOT', root), patch.object(checker, 'SUITES', ('test_fixture.py',)), \
                         patch.object(checker.os, 'geteuid', return_value=0), \
                         patch.dict(checker.os.environ), patch.object(checker.sys, 'path', checker.sys.path.copy()), \
                         patch.object(checker.subprocess, 'check_output', return_value='sing-box version 1.15.0\n'), \
                         patch.object(checker.subprocess, 'run') as check_default, \
                         contextlib.redirect_stderr(io.StringIO()), \
                         patch('sys.argv', ['check-core-compatibility.py', '--binary', str(binary), '--version', '1.15.0']):
                        if expected is None:
                            with self.assertRaisesRegex(RuntimeError, 'No core compatibility cases'):
                                checker.main()
                        else:
                            self.assertEqual(checker.main(), expected)
                    check_default.assert_called_once()
                    args = check_default.call_args.args[0]
                    self.assertEqual(args[:3], [str(binary), 'check', '-D'])
                    self.assertEqual(args[-2:], ['-c', str(root / 'sing-box/files/config.json')])
                    self.assertTrue(check_default.call_args.kwargs['check'])

    def test_workflow_commits_readme_with_core_not_resources(self):
        workflow = (ROOT / '.github/workflows/update-packages.yaml').read_text()
        script = textwrap.dedent(workflow.split('      - name: Commit and Push\n        run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, checkout = root / 'remote.git', root / 'checkout'
            def git(*args):
                return subprocess.check_output(['git', '-C', str(checkout), *args], text=True, stderr=subprocess.STDOUT)
            subprocess.run(['git', 'init', '--bare', str(remote)], check=True, capture_output=True)
            subprocess.run(['git', 'init', '-b', 'main', str(checkout)], check=True, capture_output=True)
            git('config', 'user.name', 'fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            resource_dir = Path('luci-app-homeproxy/root/etc/homeproxy/resources')
            inputs = [(Path('README.md'), 'old docs\n'), (Path('sing-box/Makefile'), 'PKG_UPSTREAM_VERSION:=1.14.4\n')]
            for kind, _, _ in updater.SOURCES:
                inputs.extend([(resource_dir / f'{kind}_cn.ver', '20240101000000 ' + 'a' * 40 + '\n'),
                               (resource_dir / f'{kind}_cn.srs', 'old fixture\n')])
            for path, value in inputs:
                target = checkout / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(value)
            git('add', '.')
            git('commit', '-m', 'fixture baseline')
            git('remote', 'add', 'origin', str(remote))
            git('push', '-u', 'origin', 'main')
            (checkout / 'README.md').write_text('new docs\n')
            (checkout / 'sing-box/Makefile').write_text('PKG_UPSTREAM_VERSION:=1.15.0\n')
            # Replacing damaged bytes can legitimately leave the source version unchanged.
            (checkout / resource_dir / 'geoip_cn.srs').write_text('verified fixture\n')
            result = subprocess.run(['bash', '-c', script], cwd=checkout, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(git('show', '-s', '--format=%s', 'HEAD'), 'chore: update HomeProxy resources\n')
            self.assertEqual(set(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD^').splitlines()),
                             {'README.md', 'sing-box/Makefile'})
            self.assertEqual(git('show', 'HEAD^:README.md'), 'new docs\n')
            self.assertEqual(git('show', '--format=', '--name-only', 'HEAD').strip(), str(resource_dir / 'geoip_cn.srs'))
            self.assertEqual(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'))
            self.assertEqual(git('status', '--porcelain'), '')


if __name__ == '__main__':
    unittest.main()
