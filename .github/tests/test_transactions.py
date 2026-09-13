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
