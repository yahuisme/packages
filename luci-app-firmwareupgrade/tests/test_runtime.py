"""Execute real shell entrypoints with private paths and harmless boundaries."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

PACKAGE = Path(__file__).resolve().parents[1]
UCI = os.environ.get('UCI_BIN', '/tmp/packages-fan-upgrade-audit/uci')
JSONFILTER = os.environ.get('JSONFILTER_BIN', '/tmp/packages-final-jsonfilter/jsonpath')

class Runtime(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='firmwareupgrade-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / 'bin'; self.bin.mkdir()
        self.runtime = self.root / 'run'; self.runtime.mkdir()
        self.config = self.root / 'config'; self.config.mkdir()
        self.delta = self.root / 'delta'; self.delta.mkdir()
        self.cfg = self.config / 'firmwareupgrade'
        self.cfg.write_text("config firmwareupgrade 'main'\n option repository 'owner/repo'\n option token 'secret'\n option keep_config '0'\n")
        self.env = dict(os.environ, PATH=f'{self.bin}:/usr/bin:/bin', ROOT=str(self.root))
        self.stub('uci', f'#!/bin/sh\nexec {UCI} -c {self.config} -C {self.runtime} -t {self.delta} "$@"\n')
        self.stub('jsonfilter', f'#!/bin/sh\nexec {JSONFILTER} "$@"\n')
        self.stub('curl', '#!/bin/sh\ncat "$ROOT/release.json"\nexit "${CURL_FAIL:-0}"\n')
        self.stub('sysupgrade', '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ROOT/flashes"\n[ "$1" = -T ] && exit "${TEST_FAIL:-0}"\nexit "${FLASH_FAIL:-0}"\n')
        self.stub('worker-stub', '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ROOT/launches"\n')
        self.backend = self.root / 'backend'
        source = (PACKAGE / 'root/usr/libexec/rpcd/luci.firmwareupgrade').read_text()
        source = source.replace('/var/run/', str(self.runtime) + '/').replace('/etc/config', str(self.config))
        source = source.replace("WORKER_SCRIPT='/usr/libexec/firmwareupgrade-worker'", f"WORKER_SCRIPT='{self.bin}/worker-stub'")
        source = source.replace('board=$(get_board_name)', 'board=gemtek,w1700k').replace('variant=$(detect_variant "$board")', 'variant=ubi2')
        self.backend.write_text(source)
        self.worker = self.root / 'worker'
        self.worker.write_text((PACKAGE / 'root/usr/libexec/firmwareupgrade-worker').read_text().replace('/var/run/', str(self.runtime) + '/'))
        self.asset = dict(name='openwrt-w1700k-ubi-sysupgrade.itb', size=5, digest='sha256:'+hashlib.sha256(b'image').hexdigest(), browser_download_url='https://github.com/owner/repo/releases/download/v1/image.itb')
        self.release = self.root / 'release.json'
        self.release.write_text(json.dumps(dict(tag_name='v1', assets=[self.asset])))

    def stub(self, name, text):
        path=self.bin/name
        # Replacing an applet symlink must never overwrite its host binary.
        if path.is_symlink():
            path.unlink()
        path.write_text(text); path.chmod(0o755)

    def rpc(self, method, data=None):
        result=subprocess.run(['busybox','ash',str(self.backend),'call',method],input=json.dumps(data or {}),capture_output=True,text=True,env=self.env,timeout=15)
        return json.loads(result.stdout)

    def uci(self,*args):
        return subprocess.check_output([str(self.bin/'uci'),*args],env=self.env,text=True).strip()

    def test_release_returns_identity_and_four_column_producer_matches(self):
        result=self.rpc('checkUpdate')
        self.assertTrue(result['success'])
        self.assertRegex(result['candidate_id'],r'^[0-9a-f]{32}$')
        self.assertEqual((self.runtime/'firmwareupgrade.candidate').read_text().splitlines()[0],result['candidate_id'])

    def openwrt_path(self):
        # Explicit BusyBox applet allowlist: host /usr/bin must not supply od.
        for name in ('busybox', 'awk', 'cat', 'chmod', 'grep', 'mkdir', 'mktemp',
                     'mv', 'rm', 'rmdir', 'tr', 'uname'):
            (self.bin / name).symlink_to('/usr/bin/busybox')
        self.env['PATH'] = str(self.bin)
        probe = subprocess.run(['busybox', 'ash', '-c', 'command -v od'],
                               env=self.env, capture_output=True)
        self.assertNotEqual(probe.returncode, 0)

    def test_discovery_without_od(self):
        self.openwrt_path()
        identities = [self.rpc('checkUpdate')['candidate_id'] for _ in range(4)]
        self.assertEqual(len(set(identities)), 4)
        for identity in identities:
            self.assertRegex(identity, r'^[0-9a-f]{32}$')
        self.assertEqual((self.runtime / 'firmwareupgrade.candidate').stat().st_mode & 0o777, 0o600)
        self.assertTrue(self.rpc('startUpgrade', dict(keep_config='0', candidate_id=identities[-1]))['success'])
        self.assertFalse(self.rpc('startUpgrade', dict(keep_config='0', candidate_id=identities[-1]))['success'])

    def test_mx4200v2_discovery_without_od(self):
        self.openwrt_path()
        self.backend.write_text(self.backend.read_text().replace('board=gemtek,w1700k', 'board=linksys,mx4200v2').replace('variant=ubi2', 'variant=v2', 1))
        asset = dict(self.asset, name='immortalwrt-qualcommax-ipq807x-linksys_mx4200v2-squashfs-sysupgrade.bin')
        wrong = dict(asset, name=asset['name'].replace('mx4200v2', 'mx4200v1'))
        self.release.write_text(json.dumps(dict(tag_name='v2-release', assets=[wrong, asset])))
        result = self.rpc('checkUpdate')
        self.assertTrue(result['success'], result)
        self.assertEqual(result['asset_name'], asset['name'])
        self.assertRegex(result['candidate_id'], r'^[0-9a-f]{32}$')
        self.assertFalse((self.root / 'launches').exists())
        self.assertFalse((self.root / 'flashes').exists())

    def test_candidate_creation_failures_return_json(self):
        self.openwrt_path()
        original = self.backend.read_text()
        for stage in ('release', 'assets', 'candidate', 'missing-random', 'empty-random', 'invalid-random', 'tr', 'chmod', 'mv', 'write'):
            with self.subTest(stage=stage):
                self.backend.write_text(original)
                for command in ('mktemp', 'chmod', 'mv', 'tr'):
                    (self.bin / command).unlink()
                    (self.bin / command).symlink_to('/usr/bin/busybox')
                if stage in ('release', 'assets', 'candidate'):
                    (self.bin / 'mktemp').unlink()
                    self.stub('mktemp', '#!/bin/sh\ncase "$*" in *firmwareupgrade.' + stage + '.*|*firmwareupgrade-' + stage + '.*) exit 1;; esac\nexec /usr/bin/busybox mktemp "$@"\n')
                elif stage.endswith('-random'):
                    random = self.root / 'random'
                    if stage == 'empty-random':
                        random.write_text('')
                    elif stage == 'invalid-random':
                        random.write_text('x' * 36 + '\n')
                    self.backend.write_text(original.replace('/proc/sys/kernel/random/uuid', str(random)))
                elif stage == 'write':
                    (self.bin / 'mktemp').unlink()
                    self.stub('mktemp', '#!/bin/sh\ncase "$*" in *firmwareupgrade.candidate.*) printf /dev/full; exit 0;; esac\nexec /usr/bin/busybox mktemp "$@"\n')
                    # Never allow cleanup of the injected device boundary.
                    self.stub('rm', '#!/bin/sh\nfor arg do [ "$arg" = /dev/full ] && exit 0; done\nexec /usr/bin/busybox rm "$@"\n')
                else:
                    (self.bin / stage).unlink()
                    self.stub(stage, '#!/bin/sh\nexit 1\n')
                result = self.rpc('checkUpdate')
                self.assertFalse(result['success'], result)
                self.assertTrue(result['error'])
                self.assertFalse((self.runtime / 'firmwareupgrade.candidate').exists())
                self.assertFalse(list(self.runtime.glob('firmwareupgrade.candidate.*')))
                self.assertFalse((self.runtime / 'firmwareupgrade.lock').exists())
                self.assertFalse((self.root / 'launches').exists())

    def test_real_w1700k_release_selects_variant_not_latest_oc(self):
        self.cfg.write_text("config firmwareupgrade 'main'\n option repository 'yahuisme/w1700k-immortalwrt'\n option token ''\n option keep_config '0'\n")
        fixtures = PACKAGE / 'tests/fixtures'
        self.release.write_bytes((fixtures / 'w1700k-immortalwrt-latest.json').read_bytes())
        (self.root / 'releases.json').write_bytes((fixtures / 'w1700k-immortalwrt-releases.json').read_bytes())
        self.stub('curl', '#!/bin/sh\ncase "$*" in *releases/latest*) cat "$ROOT/release.json";; *releases?per_page=20*) cat "$ROOT/releases.json";; *) exit 22;; esac\n')
        releases = json.loads((self.root / 'releases.json').read_text())
        normal = next(r for r in releases if r['tag_name'].startswith('W1700K-ImmortalWrt_'))
        result = self.rpc('checkUpdate')
        self.assertTrue(result['success'], result)
        self.assertEqual(result['tag_name'], normal['tag_name'])
        self.assertEqual(result['sha256'], normal['assets'][0]['digest'][7:])
        # OC uses the same filename, but must get its own release digest.
        self.backend.write_text(self.backend.read_text().replace('variant=ubi2', 'variant=ubi2-oc', 1))
        oc = next(r for r in releases if r['tag_name'].startswith('W1700K-ImmortalWrt-OC_'))
        result = self.rpc('checkUpdate')
        self.assertTrue(result['success'], result)
        self.assertEqual(result['sha256'], oc['assets'][0]['digest'][7:])
        # Never cross branches, accept prereleases or bypass digest validation.
        for rejected in ([normal], [dict(oc, prerelease=True)],
                         [dict(oc, draft=True)],
                         [dict(oc, assets=[dict(oc['assets'][0], digest=None)])],
                         [dict(oc, assets=[dict(oc['assets'][0], size=0)])],
                         [dict(oc, assets=[dict(oc['assets'][0], browser_download_url='http://github.com/image')])]):
            (self.root / 'releases.json').write_text(json.dumps(rejected))
            self.assertFalse(self.rpc('checkUpdate')['success'])
            self.assertFalse((self.runtime / 'firmwareupgrade.candidate').exists())
        self.assertFalse((self.root / 'launches').exists())
        self.assertFalse((self.root / 'flashes').exists())

    def test_lock_contender_does_not_delete_candidate(self):
        candidate=self.runtime/'firmwareupgrade.candidate'; candidate.write_text('sentinel')
        (self.runtime/'firmwareupgrade.lock').mkdir()
        self.assertFalse(self.rpc('checkUpdate')['success'])
        self.assertEqual(candidate.read_text(),'sentinel')

    def test_failed_discovery_clears_old_candidate(self):
        self.rpc('checkUpdate'); self.release.write_text('{}')
        self.assertFalse(self.rpc('checkUpdate')['success'])
        self.assertFalse((self.runtime/'firmwareupgrade.candidate').exists())

    def test_http_failure_with_body_must_not_publish(self):
        self.env['CURL_FAIL']='22'
        self.assertFalse(self.rpc('checkUpdate')['success'])
        self.assertFalse((self.runtime/'firmwareupgrade.candidate').exists())

    def test_matching_rejects_five_columns(self):
        path=self.root/'assets'; path.write_text('1\t'+self.asset['name']+'\t5\t'+self.asset['digest']+'\t'+self.asset['browser_download_url']+'\n')
        out=subprocess.check_output(['sh',str(self.backend),'test_match',str(path),'gemtek,w1700k','ubi2'],text=True)
        self.assertEqual(out,'')

    def test_pending_uci_changes_not_committed_or_lost(self):
        before=self.cfg.read_bytes(); self.uci('set','firmwareupgrade.main.other=staged'); changes=self.uci('changes','firmwareupgrade')
        result=self.rpc('saveSettings',dict(repository='new/repo',token='',keep_config='1'))
        self.assertFalse(result['success'])
        self.assertEqual(self.cfg.read_bytes(),before)
        self.assertEqual(self.uci('changes','firmwareupgrade'),changes)

    def test_save_retains_blank_token(self):
        result=self.rpc('saveSettings',dict(repository='new/repo',token='',keep_config='1'))
        self.assertTrue(result['success'],result)
        self.assertEqual(self.uci('get','firmwareupgrade.main.token'),'secret')
        self.assertEqual(self.uci('get','firmwareupgrade.main.repository'),'new/repo')
        self.assertEqual(self.uci('changes','firmwareupgrade'),'')

    def test_worker_contender_preserves_active_state(self):
        (self.runtime/'firmwareupgrade.worker.lock').mkdir()
        (self.runtime/'firmwareupgrade.pid').write_text('12345\n')
        (self.runtime/'firmwareupgrade.status').write_text('sentinel')
        p=subprocess.run(['busybox','ash',str(self.worker),'invalid'],env=self.env,capture_output=True)
        self.assertNotEqual(p.returncode,0)
        self.assertEqual((self.runtime/'firmwareupgrade.pid').read_text(),'12345\n')
        self.assertEqual((self.runtime/'firmwareupgrade.status').read_text(),'sentinel')

    def test_start_requires_exact_candidate_and_consumes_once(self):
        result=self.rpc('checkUpdate'); identity=result['candidate_id']
        self.assertFalse(self.rpc('startUpgrade',dict(keep_config='0',candidate_id='wrong'))['success'])
        self.assertFalse((self.root/'launches').exists())
        self.assertFalse((self.runtime/'firmwareupgrade.candidate').exists())
        identity=self.rpc('checkUpdate')['candidate_id']
        self.assertTrue(self.rpc('startUpgrade',dict(keep_config='0',candidate_id=identity))['success'])
        self.assertFalse(self.rpc('startUpgrade',dict(keep_config='0',candidate_id=identity))['success'])

    def test_private_save_failure_preserves_absent_options(self):
        self.cfg.write_text("config firmwareupgrade 'main'\n option repository 'owner/repo'\n")
        original=self.cfg.read_bytes()
        wrapper=(self.bin/'uci').read_text()
        # Match private calls regardless of UCI flags; fail at commit only.
        self.stub('uci',wrapper.replace('exec ', 'case " $* " in *" commit "*) exit 1;; esac\nexec ',1))
        self.assertFalse(self.rpc('saveSettings',dict(repository='new/repo',token='new',keep_config='1'))['success'])
        self.assertEqual(self.cfg.read_bytes(),original)
        self.assertEqual(self.uci('changes','firmwareupgrade'),'')

    def test_save_postpublish_failure_restores_exact_original(self):
        original=self.cfg.read_bytes()
        self.stub('mv', '#!/bin/sh\n/bin/mv "$@" || exit $?\ncase "$2" in */.firmwareupgrade.*/firmwareupgrade) printf "broken\\n" > "$3";; esac\n')
        result=self.rpc('saveSettings',dict(repository='new/repo',token='',keep_config='1'))
        self.assertFalse(result['success'])
        self.assertIn('restored original',result['error'])
        self.assertEqual(self.cfg.read_bytes(),original)

    def test_save_failed_rollback_is_explicit(self):
        self.stub('mv', '#!/bin/sh\ncase "$2" in */restore) exit 1;; esac\n/bin/mv "$@" || exit $?\ncase "$2" in */.firmwareupgrade.*/firmwareupgrade) printf "broken\\n" > "$3";; esac\n')
        result=self.rpc('saveSettings',dict(repository='new/repo',token='',keep_config='1'))
        self.assertFalse(result['success']); self.assertIn('rollback failed',result['error'])

    def test_empty_candidate_identity_never_authorizes(self):
        candidate=self.runtime/'firmwareupgrade.candidate'
        candidate.write_text('\n'+self.asset['browser_download_url']+'\n'+self.asset['name']+'\n'+self.asset['digest'][7:]+'\n5\n')
        self.assertFalse(self.rpc('startUpgrade',dict(keep_config='0',candidate_id=''))['success'])
        self.assertFalse((self.root/'launches').exists())

    def test_active_worker_blocks_start_even_without_pid(self):
        identity=self.rpc('checkUpdate')['candidate_id']
        (self.runtime/'firmwareupgrade.worker.lock').mkdir()
        self.assertFalse(self.rpc('startUpgrade',dict(keep_config='0',candidate_id=identity))['success'])
        self.assertFalse((self.root/'launches').exists())

    def test_start_refuses_unconsumable_candidate(self):
        identity=self.rpc('checkUpdate')['candidate_id']
        self.stub('rm', '#!/bin/sh\ncase "$*" in *firmwareupgrade.candidate*) exit 1;; esac\nexec /bin/rm "$@"\n')
        self.assertFalse(self.rpc('startUpgrade',dict(keep_config='0',candidate_id=identity))['success'])
        self.assertFalse((self.root/'launches').exists())

    def test_worker_integrity_failure_never_flashes(self):
        self.stub('curl', '#!/bin/sh\nwhile [ "$1" != --output ]; do shift; done\nprintf wrong > "$2"\n')
        for size in ('5','6'):
            p=subprocess.run(['busybox','ash',str(self.worker),self.asset['browser_download_url'],self.asset['name'],self.asset['digest'][7:],'0',size],env=self.env,timeout=10)
            self.assertNotEqual(p.returncode,0)
            self.assertEqual(json.loads((self.runtime/'firmwareupgrade.status').read_text())['stage'],'error')
            self.assertFalse((self.root/'flashes').exists())

    def test_worker_preflight_failure_never_flashes(self):
        self.stub('curl', '#!/bin/sh\nwhile [ "$1" != --output ]; do shift; done\nprintf image > "$2"\n')
        self.env['TEST_FAIL']='1'
        p=subprocess.run(['busybox','ash',str(self.worker),self.asset['browser_download_url'],self.asset['name'],self.asset['digest'][7:],'0','5'],env=self.env,timeout=10)
        self.assertNotEqual(p.returncode,0)
        self.assertEqual(len((self.root/'flashes').read_text().splitlines()),1)
        self.assertEqual(json.loads((self.runtime/'firmwareupgrade.status').read_text())['stage'],'error')

    def test_concurrent_start_launches_one_worker(self):
        identity=self.rpc('checkUpdate')['candidate_id']
        self.stub('worker-stub', '#!/bin/sh\nprintf launched >> "$ROOT/launches"\n')
        data=json.dumps(dict(keep_config='0',candidate_id=identity))
        procs=[subprocess.Popen(['busybox','ash',str(self.backend),'call','startUpgrade'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=self.env) for _ in range(2)]
        results=[json.loads(p.communicate(data,timeout=10)[0]) for p in procs]
        self.assertEqual(sum(bool(r['success']) for r in results),1)
        self.assertEqual((self.root/'launches').read_text(),'launched')

    def test_invalid_settings_do_not_modify_config(self):
        original=self.cfg.read_bytes()
        for repo in ('a/b/extra','owner/repo?query','owner/repo\nother/repo'):
            self.assertFalse(self.rpc('saveSettings',dict(repository=repo,token='',keep_config='1'))['success'])
            self.assertEqual(self.cfg.read_bytes(),original)

    def test_worker_success_is_terminal(self):
        self.stub('curl', '#!/bin/sh\nwhile [ "$1" != --output ]; do shift; done\nprintf image > "$2"\n')
        p=subprocess.run(['busybox','ash',str(self.worker),self.asset['browser_download_url'],self.asset['name'],self.asset['digest'][7:],'1','5'],env=self.env,timeout=10)
        self.assertEqual(p.returncode,0)
        self.assertEqual(json.loads((self.runtime/'firmwareupgrade.status').read_text())['stage'],'complete')
        self.assertFalse((self.runtime/'firmwareupgrade.worker.lock').exists())

    def test_worker_final_failure_and_keep_modes(self):
        self.stub('curl', '#!/bin/sh\nwhile [ "$1" != --output ]; do shift; done\nprintf image > "$2"\n')
        for keep in ('0','1'):
            self.env['FLASH_FAIL']='7'
            p=subprocess.run(['busybox','ash',str(self.worker),self.asset['browser_download_url'],self.asset['name'],self.asset['digest'][7:],keep,'5'],env=self.env,timeout=10)
            self.assertEqual(p.returncode,7)
            self.assertEqual(json.loads((self.runtime/'firmwareupgrade.status').read_text())['stage'],'error')
        calls=(self.root/'flashes').read_text().splitlines()
        self.assertTrue(calls[1].startswith('-n ')); self.assertFalse(calls[3].startswith('-n '))

if __name__=='__main__': unittest.main()
