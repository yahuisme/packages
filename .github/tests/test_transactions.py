"""Copy API and transactional publication tests; no network or proxy starts."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('updater', ROOT/'.github/scripts/update-homeproxy.py')
assert spec and spec.loader
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def snapshot(root):
    return {str(p.relative_to(root)): (p.stat().st_mode & 0o777, p.read_bytes())
            for p in root.rglob('*') if p.is_file()}


class Transactions(unittest.TestCase):
    def test_overlay_entrypoint_removed(self):
        self.assertFalse((ROOT/'custom/homeproxy').exists())

    def test_publish_rollback_at_every_rename(self):
        for fail_at in range(1, 5):
            with self.subTest(fail_at=fail_at), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                pairs = []
                for name in ['resources', 'dashboard']:
                    target, stage = root/name, root/(name+'.stage')
                    target.mkdir(); stage.mkdir()
                    (target/'data').write_text('old '+name)
                    (stage/'data').write_text('new '+name)
                    pairs.append((stage, target))
                count = 0
                rename = Path.rename
                def fault(path, target):
                    nonlocal count
                    count += 1
                    if count == fail_at:
                        raise OSError('injected rename failure')
                    return rename(path, target)
                with patch.object(Path, 'rename', fault), self.assertRaises(OSError):
                    updater.publish(pairs)
                for stage, target in pairs:
                    self.assertEqual((target/'data').read_text(), 'old '+target.name)
                    self.assertFalse(target.with_name(target.name+'.update-backup').exists())

    def test_rollback_failure_preserves_other_recovery_targets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            pairs = []
            for name in ['first', 'second']:
                target, stage = root/name, root/(name+'.stage')
                target.mkdir(); stage.mkdir()
                (target/'data').write_text('old '+name)
                (stage/'data').write_text('new '+name)
                pairs.append((stage, target))
            rename = Path.rename
            def fault(path, target):
                if path.name == 'second.stage' or path.name == 'second.update-backup':
                    raise OSError('injected installation/recovery failure')
                return rename(path, target)
            with patch.object(Path, 'rename', fault), self.assertRaises(OSError) as raised:
                updater.publish(pairs)
            self.assertIn('second.update-backup', '\n'.join(raised.exception.__notes__))
            self.assertEqual((root/'first/data').read_text(), 'old first')
            self.assertEqual((root/'second.update-backup/data').read_text(), 'old second')

    def test_completed_directory_cleanup_can_be_retried(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target, stage = root/'resources', root/'resources.stage'
            target.mkdir(); stage.mkdir()
            (target/'data').write_text('old')
            (stage/'data').write_text('new')
            remove = shutil.rmtree
            def fail_cleanup(path, *args, **kwargs):
                if '.update-' in Path(path).name:
                    raise OSError('injected cleanup failure')
                return remove(path, *args, **kwargs)
            with patch.object(updater.shutil, 'rmtree', fail_cleanup), self.assertRaises(OSError):
                updater.publish([(stage, target)])
            self.assertEqual((target/'data').read_text(), 'new')
            stage.mkdir(); (stage/'data').write_text('newer')
            updater.publish([(stage, target)])
            self.assertEqual((target/'data').read_text(), 'newer')
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['resources'])

    def test_completed_file_cleanup_can_be_retried(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target, stage = root/'Makefile', root/'Makefile.stage'
            target.write_text('old'); stage.write_text('new')
            unlink = Path.unlink
            def fail_cleanup(path, *args, **kwargs):
                if '.update-' in path.name:
                    raise OSError('injected unlink failure')
                return unlink(path, *args, **kwargs)
            with patch.object(Path, 'unlink', fail_cleanup), self.assertRaises(OSError):
                updater.publish([(stage, target)])
            self.assertEqual(target.read_text(), 'new')
            stage.write_text('newer')
            updater.publish([(stage, target)])
            self.assertEqual(target.read_text(), 'newer')
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['Makefile'])

    def test_completed_cleanup_is_fail_closed_before_new_publication(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target, stage = root/'resources', root/'resources.stage'
            target.mkdir(); stage.mkdir()
            (target/'data').write_text('current')
            (stage/'data').write_text('next')
            complete = root/'resources.update-complete'
            complete.mkdir(); (complete/'data').write_text('old')
            with patch.object(updater.shutil, 'rmtree', side_effect=OSError('still busy')), self.assertRaises(OSError):
                updater.publish([(stage, target)])
            self.assertEqual((target/'data').read_text(), 'current')
            self.assertEqual((stage/'data').read_text(), 'next')
            self.assertEqual((complete/'data').read_text(), 'old')

    def test_partial_cleanup_does_not_turn_recovery_into_disposable_data(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target, stage = root/'resources', root/'resources.stage'
            target.mkdir(); stage.mkdir()
            (target/'data').write_text('current')
            (stage/'data').write_text('next')
            backup = root/'resources.update-backup'
            backup.mkdir(); (backup/'data').write_text('recovery')
            complete = root/'resources.update-complete'
            complete.mkdir(); (complete/'data').write_text('completed')
            before = snapshot(root)
            with self.assertRaises(RuntimeError):
                updater.publish([(stage, target)])
            self.assertEqual(snapshot(root), before)

    def test_dangling_backup_and_completed_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target, stage = root/'resources', root/'resources.stage'
            target.mkdir(); stage.mkdir()
            (target/'data').write_text('current')
            (stage/'data').write_text('next')
            for suffix in ('update-backup', 'update-complete'):
                with self.subTest(suffix=suffix):
                    link = root/('resources.' + suffix)
                    link.symlink_to(root/'absent')
                    with self.assertRaises(RuntimeError):
                        updater.publish([(stage, target)])
                    self.assertTrue(link.is_symlink())
                    self.assertEqual((target/'data').read_text(), 'current')
                    self.assertEqual((stage/'data').read_text(), 'next')
                    link.unlink()

    def test_all_completed_backups_are_retryable_after_partial_delete(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            pairs = []
            for name in ('resources', 'Makefile'):
                target, stage = root/name, root/(name + '.stage')
                target.mkdir(); stage.mkdir()
                (target/'data').write_text('old ' + name)
                (target/'extra').write_text('old extra')
                (stage/'data').write_text('new ' + name)
                pairs.append((stage, target))
            remove = shutil.rmtree
            def partial_delete(path, *args, **kwargs):
                if path.name == 'resources.update-complete':
                    (path/'extra').unlink()
                    raise OSError('injected partial deletion')
                return remove(path, *args, **kwargs)
            with patch.object(updater.shutil, 'rmtree', partial_delete), self.assertRaises(OSError):
                updater.publish(pairs)
            self.assertTrue((root/'resources.update-complete').is_dir())
            self.assertTrue((root/'Makefile.update-complete').is_dir())
            for stage, target in pairs:
                self.assertEqual((target/'data').read_text(), 'new ' + target.name)
                stage.mkdir(); (stage/'data').write_text('next ' + target.name)
            updater.publish(pairs)
            for _, target in pairs:
                self.assertEqual((target/'data').read_text(), 'next ' + target.name)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['Makefile', 'resources'])

    def test_completion_transition_failure_retains_unresolved_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target, stage = root/'resources', root/'resources.stage'
            target.mkdir(); stage.mkdir()
            (target/'data').write_text('old')
            (stage/'data').write_text('new')
            rename = Path.rename
            def fail_completion(path, destination):
                if str(destination).endswith('.update-complete'):
                    raise OSError('injected completion transition failure')
                return rename(path, destination)
            with patch.object(Path, 'rename', fail_completion), self.assertRaises(OSError):
                updater.publish([(stage, target)])
            backup = root/'resources.update-backup'
            self.assertEqual((backup/'data').read_text(), 'old')
            self.assertEqual((target/'data').read_text(), 'new')
            stage.mkdir(); (stage/'data').write_text('next')
            with self.assertRaises(RuntimeError):
                updater.publish([(stage, target)])
            self.assertEqual((backup/'data').read_text(), 'old')

    def test_main_cleans_unchanged_core_backup_before_network(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root/'luci-app-homeproxy/root/etc/homeproxy/resources'
            target.mkdir(parents=True)
            makefile = root/'sing-box/Makefile'
            makefile.parent.mkdir()
            makefile.write_text('PKG_UPSTREAM_VERSION:=1.14.4\n')
            completed = makefile.with_name('Makefile.update-complete')
            completed.write_text('old core recipe')
            class StopBeforeDownload(Exception):
                pass
            def lookup(_):
                self.assertFalse(completed.exists())
                self.assertEqual(makefile.read_text(), 'PKG_UPSTREAM_VERSION:=1.14.4\n')
                raise StopBeforeDownload
            with patch('sys.argv', ['update-homeproxy.py', '--root', str(root)]), \
                 patch.object(updater, 'api', lookup), self.assertRaises(StopBeforeDownload):
                updater.main()

    def test_refuse_existing_recovery_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ['target', 'stage', 'target.update-backup']:
                (root/name).mkdir()
            with self.assertRaises(RuntimeError):
                updater.publish([(root/'stage', root/'target')])
            self.assertTrue((root/'target.update-backup').is_dir())

if __name__ == '__main__':
    unittest.main()
