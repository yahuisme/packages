"""Source-bound TX-free cleanup regression; no C or firmware compilation."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / 'tree/package/kernel/mt76/patches/913-mt76-mt7996-clean-up-truncated-txfree.patch'
FIXTURE = Path(__file__).parent / 'fixtures/mt76-txfree/mt7996/mac.c'
GUARD = '\t\tif (WARN_ON_ONCE((void *)cur_info >= end))\n'


class TxFreeCleanupTests(unittest.TestCase):
    def patched(self):
        original = FIXTURE.read_text()
        self.assertEqual(hashlib.sha256(FIXTURE.read_bytes()).hexdigest(),
                         'a22a9a73f3db00e933ee79041dbf41e9d1abe481e1d7c7babffe2ff0d0ec8fbf')
        # RED uses the unmodified official function until the production patch exists.
        if not PATCH.exists():
            return original
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'mt7996/mac.c'
            target.parent.mkdir()
            shutil.copyfile(FIXTURE, target)
            result = subprocess.run(['patch', '-p1', '--batch', '--forward', '--fuzz=0',
                                     '--no-backup-if-mismatch', '-i', str(PATCH)],
                                    cwd=tmp, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return target.read_text()

    def test_truncated_event_reaches_existing_cleanup_without_losing_warning(self):
        original = FIXTURE.read_text()
        expected = original.replace(GUARD + '\t\t\treturn;', GUARD + '\t\t\tbreak;', 1)
        self.assertNotEqual(original, expected)
        self.assertEqual(self.patched(), expected,
                         'truncation must leave the loop, not skip free_list/wake/worker cleanup')
        for call in ('mt76_set_tx_blocked', 'mt76_worker_schedule', 'napi_consume_skb'):
            self.assertIn(call, expected[expected.index('mt7996_mac_sta_poll(dev);'):])

    def test_invalid_version_and_normal_processing_remain_unchanged(self):
        text = self.patched()
        self.assertIn('if (WARN_ON_ONCE(ver < 5))\n\t\treturn;', text)
        # Normalize only the authorized control-flow change, then require byte equality.
        restored = text.replace(GUARD + '\t\t\tbreak;', GUARD + '\t\t\treturn;', 1)
        self.assertEqual(restored, FIXTURE.read_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
