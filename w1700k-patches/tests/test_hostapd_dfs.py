"""Real-source DFS guard evaluation in JS, not compiled hostapd/RF execution."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / 'fixtures/hostapd-dfs'
PATCH = ROOT / 'tree/package/network/services/hostapd/patches/mtk-0015-hostapd-mtk-6G-band-does-not-require-DFS.patch'
GUARD = '\t    is_6ghz_freq(iface->freq) ||\n'


def fixture(name):
    manifest = json.loads((FIXTURES / 'manifest.json').read_text())
    data = (FIXTURES / name).read_bytes()
    assert hashlib.sha256(data).hexdigest() == manifest['files'][name]['sha256']
    source = gzip.decompress(data)
    assert hashlib.sha256(source).hexdigest() == manifest['files'][name]['source_sha256']
    return source.decode()


def patched(source):
    if not PATCH.exists():
        return source  # RED evaluates the real official predicate before the fix.
    with tempfile.TemporaryDirectory(prefix='hostapd-dfs-') as tmp:
        root = Path(tmp)
        target = root / 'src/ap/dfs.c'
        target.parent.mkdir(parents=True)
        target.write_text(source)
        result = subprocess.run(['patch', '-p1', '--batch', '--fuzz=0',
                                 '--no-backup-if-mismatch', '-i', str(PATCH)],
                                cwd=root, capture_output=True, text=True)
        assert result.returncode == 0, result.stdout + result.stderr
        return target.read_text()


class HostapdDfsTests(unittest.TestCase):
    def guard(self, rows):
        source = patched(fixture('official-prepared-dfs.c.gz'))
        body = source.split('int hostapd_is_dfs_required(', 1)[1]
        match = re.search(r'if \((.*?)\)\s*return 0;', body, re.S)
        if match is None:
            self.fail('DFS early-return predicate missing')
        # Only a trusted, pinned C boolean predicate is evaluated; no external
        # content enters Function(). Operators have the same boolean semantics.
        expr = match[1].replace('->', '.')
        code = '''const rows=JSON.parse(process.argv[1]);
const predicate=new Function('iface','is_6ghz_freq',
 'const WPA_DRIVER_FLAGS_DFS_OFFLOAD=1, HOSTAPD_MODE_IEEE80211A=1; return !!('+
 process.argv[2]+')');
console.log(JSON.stringify(rows.map(r=>predicate({freq:r.freq,
 drv_flags:r.offload?1:0, conf:{ieee80211h:r.ieee80211h},
 current_mode:r.mode===null?null:{mode:r.mode}},()=>r.six))));'''
        result = subprocess.run(['node', '-e', code, json.dumps(rows), expr],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_6ghz_exits_before_dfs_channel_calculation(self):
        rows = [dict(freq=f, six=True, offload=offload, ieee80211h=True, mode=1)
                for f in (5935, 5955, 6135, 7115) for offload in (False, True)]
        self.assertEqual(self.guard(rows), [True] * len(rows))

    def test_5ghz_dfs_path_remains_enabled(self):
        rows = [dict(freq=f, six=False, offload=o, ieee80211h=h, mode=1)
                for f in (5180, 5260, 5500, 5745) for o, h in
                ((False, True), (True, False), (True, True))]
        self.assertEqual(self.guard(rows), [False] * len(rows))

    def test_original_disabled_missing_mode_and_2ghz_guards_remain(self):
        rows = [dict(freq=2412, six=False, offload=False, ieee80211h=True, mode=0),
                dict(freq=5500, six=False, offload=False, ieee80211h=False, mode=1),
                dict(freq=5500, six=False, offload=True, ieee80211h=True, mode=None)]
        self.assertEqual(self.guard(rows), [True] * len(rows))

    def test_only_one_frequency_guard_changes_on_both_source_shapes(self):
        for name in ('pristine-dfs.c.gz', 'official-prepared-dfs.c.gz'):
            with self.subTest(name=name):
                source = fixture(name)
                text = patched(source)
                self.assertEqual(text.count(GUARD), source.count(GUARD) + 1)
                self.assertEqual(text.replace(GUARD, '', 1), source)
                self.assertLess(text.index(GUARD, text.index('int hostapd_is_dfs_required(')),
                                text.index('start_chan_idx = dfs_get_start_chan_idx(',
                                           text.index('int hostapd_is_dfs_required(')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
