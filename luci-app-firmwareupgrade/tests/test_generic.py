"""Generic release rules through the actual isolated shell RPC."""
import json
import unittest
import test_runtime

class Generic(unittest.TestCase):
    setUp = test_runtime.Runtime.setUp
    stub = test_runtime.Runtime.stub
    rpc = test_runtime.Runtime.rpc
    uci = test_runtime.Runtime.uci
    def test_release_body_tab_is_valid_json(self):
        import subprocess
        releases = json.loads(self.release.read_text())
        releases[0]['body'] = 'notes\twith tab'
        self.release.write_text(json.dumps(releases))
        result = subprocess.run(['busybox', 'ash', str(self.backend), 'call', 'checkUpdate'],
                                input=b'{}', capture_output=True, env=self.env, timeout=15)
        self.assertEqual(result.returncode, 0)
        self.assertIn(b'notes\\twith tab', result.stdout)
        self.assertNotIn(b'\t', result.stdout)
        response = json.loads(result.stdout)
        self.assertTrue(response['success'], response)
        self.assertEqual(response['body'], 'notes\twith tab')

    def test_save_rules_and_candidate_invalidation(self):
        data = dict(repository='owner/repo', token='', keep_config='0', release_pattern='stable-*', asset_pattern='*sysupgrade.itb')
        self.assertTrue(self.rpc('saveSettings', data)['success'])
        info = self.rpc('getSystemInfo')
        self.assertEqual(info['release_pattern'], 'stable-*')
        self.assertEqual(info['asset_pattern'], '*sysupgrade.itb')
        self.release.write_text(json.dumps([dict(tag_name='stable-1', published_at='2026-01-01T00:00:00Z', draft=False, prerelease=False, assets=[self.asset])]))
        identity = self.rpc('checkUpdate')['candidate_id']
        self.uci('set', 'firmwareupgrade.main.release_pattern=other-*')
        self.uci('commit', 'firmwareupgrade')
        self.assertFalse(self.rpc('startUpgrade', dict(keep_config='0', candidate_id=identity))['success'])
        self.assertFalse((self.root/'launches').exists())

    def test_ambiguity_is_not_silently_resolved(self):
        self.release.write_text(json.dumps([dict(tag_name='v1', published_at='2026-01-01T00:00:00Z', draft=False, prerelease=False, assets=[self.asset, dict(self.asset, name='other-w1700k-sysupgrade.itb')])]))
        result = self.rpc('checkUpdate')
        self.assertFalse(result['success'])
        self.assertIn('多个', result['error'])

    def test_pagination_checks_later_newer_release(self):
        old = dict(tag_name='old', published_at='2026-01-01T00:00:00Z', draft=False, prerelease=False, assets=[self.asset])
        (self.root/'page1').write_text(json.dumps([old]*20))
        (self.root/'page2').write_text(json.dumps([dict(old,tag_name='new',published_at='2026-02-01T00:00:00Z')]))
        self.stub('curl', '#!/bin/sh\ncase "$*" in *page=1) cat "$ROOT/page1";; *page=2) cat "$ROOT/page2";; *) exit 22;; esac\n')
        self.assertEqual(self.rpc('checkUpdate')['tag_name'], 'new')
        self.stub('curl', '#!/bin/sh\ncase "$*" in *page=1) cat "$ROOT/page1";; *) exit 22;; esac\n')
        self.assertFalse(self.rpc('checkUpdate')['success'])

    def test_full_page_then_empty_array_terminates(self):
        # Synthetic pagination fixture: exactly 20 releases, not an API sample.
        rows = json.loads(self.release.read_text()) * 20
        (self.root/'page1').write_text(json.dumps(rows))
        self.stub('curl', '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ROOT/requests"\ncase "$*" in *page=1) cat "$ROOT/page1";; *page=2) cat "$ROOT/page2";; *) exit 22;; esac\n')
        for empty in ('[]', ' \t\r\n[ \t\r\n ]\n'):
            with self.subTest(empty=empty):
                (self.root/'page2').write_text(empty)
                (self.root/'requests').write_text('')
                result = self.rpc('checkUpdate')
                self.assertTrue(result['success'], result)
                self.assertEqual(result['tag_name'], rows[0]['tag_name'])
                self.assertEqual(len((self.root/'requests').read_text().splitlines()), 2)
                self.assertTrue((self.runtime/'firmwareupgrade.candidate').exists())

    def test_empty_first_page_clears_candidate_without_parse_error(self):
        for empty in ('[]', ' \t\r\n[ \t\r\n ]\n'):
            with self.subTest(empty=empty):
                (self.runtime/'firmwareupgrade.candidate').write_text('stale')
                self.release.write_text(empty)
                self.assertEqual(self.rpc('checkUpdate'), dict(success=False, error='未找到可验证的匹配固件'))
                self.assertFalse((self.runtime/'firmwareupgrade.candidate').exists())

    def test_invalid_or_failed_empty_page_never_keeps_candidate(self):
        rows = json.loads(self.release.read_text()) * 20
        (self.root/'page1').write_text(json.dumps(rows))
        self.stub('curl', '#!/bin/sh\ncase "$*" in *page=1) cat "$ROOT/page1";; *page=2) cat "$ROOT/page2"; exit "${CURL_FAIL:-0}";; *) exit 22;; esac\n')
        for invalid in ('', '[', '[}', '{}', '{"release":' + json.dumps(rows[0]) + '}', '[] garbage', '[ ] []', '[\v]', '[\f]'):
            with self.subTest(invalid=invalid):
                (self.runtime/'firmwareupgrade.candidate').write_text('stale')
                (self.root/'page2').write_text(invalid)
                self.assertEqual(self.rpc('checkUpdate'), dict(success=False, error='Release 数据解析失败'))
                self.assertFalse((self.runtime/'firmwareupgrade.candidate').exists())
        (self.root/'page2').write_text('[]')
        self.env['CURL_FAIL'] = '22'
        self.assertEqual(self.rpc('checkUpdate'), dict(success=False, error='无法获取最新 Release'))
        self.assertFalse((self.runtime/'firmwareupgrade.candidate').exists())
        self.assertFalse((self.root/'launches').exists())
        self.assertFalse((self.root/'flashes').exists())

    def test_newest_without_image_does_not_hide_older_valid_release(self):
        old = dict(tag_name='old', published_at='2026-01-01T00:00:00Z', draft=False, prerelease=False, assets=[self.asset])
        self.release.write_text(json.dumps([dict(old,tag_name='empty',published_at='2026-02-01T00:00:00Z',assets=[]),old]))
        self.assertEqual(self.rpc('checkUpdate')['tag_name'], 'old')

    def test_real_external_ax6600_series(self):
        releases = json.loads((test_runtime.PACKAGE/'tests/fixtures/ones20250-ax6600-releases.json').read_text())
        self.backend.write_text(self.backend.read_text().replace('board=gemtek,w1700k', 'board=jdcloud,re-cs-02'))
        self.release.write_text(json.dumps(releases))
        for series in ('PURE', 'PLUS'):
            data = dict(repository='ones20250/Openwrt-AX6600', token='', keep_config='0', release_pattern='IPQ60XX-WIFI-YES-' + series + '-*', asset_pattern='*jdcloud_re-cs-02-squashfs-sysupgrade-*.bin')
            self.assertTrue(self.rpc('saveSettings', data)['success'])
            result = self.rpc('checkUpdate')
            expected = max((r for r in releases if '-' + series + '-' in r['tag_name']), key=lambda r: r['published_at'])
            asset = next(a for a in expected['assets'] if 'sysupgrade' in a['name'])
            self.assertTrue(result['success'], result)
            self.assertEqual(result['tag_name'], expected['tag_name'])
            self.assertEqual(result['asset_name'], asset['name'])
            self.assertEqual(result['asset_size'], asset['size'])
            self.assertEqual(result['sha256'], asset['digest'][7:])
            self.assertIn(asset['browser_download_url'], (self.runtime/'firmwareupgrade.candidate').read_text())

    def test_real_zqinking_and_breeze_reduced_samples(self):
        # Field-preserving subsets, deliberately not full pagination fixtures.
        samples = json.loads((test_runtime.PACKAGE/'tests/fixtures/external-release-subsets.json').read_text())
        for sample in samples:
            with self.subTest(repository=sample['repository'], pattern=sample['release_pattern']):
                self.assertTrue(self.rpc('saveSettings', dict(repository=sample['repository'], token='', keep_config='0',
                    release_pattern=sample['release_pattern'], asset_pattern=sample['asset_pattern']))['success'])
                release = sample['release']
                asset = release['assets'][0]
                self.release.write_text(json.dumps([release]))
                result = self.rpc('checkUpdate')
                self.assertTrue(result['success'], result)
                self.assertEqual(result['tag_name'], release['tag_name'])
                self.assertEqual(result['published_at'], release['published_at'])
                self.assertEqual(result['asset_name'], asset['name'])
                self.assertEqual(result['asset_size'], asset['size'])
                self.assertEqual(result['sha256'], asset['digest'][7:])
                self.assertEqual((self.runtime/'firmwareupgrade.candidate').read_text().splitlines()[1], asset['browser_download_url'])
        self.assertFalse((self.root/'launches').exists())
        self.assertFalse((self.root/'flashes').exists())

    def test_real_external_w1700k_tags(self):
        releases = json.loads((test_runtime.PACKAGE/'tests/fixtures/w1700k-builds-releases.json').read_text())
        self.release.write_text(json.dumps(releases))
        for pattern in ('ubi2_*', 'ubi2-oc_*'):
            data = dict(repository='w1700k/builds', token='', keep_config='0', release_pattern=pattern, asset_pattern='*gemtek_w1700k-ubi-squashfs-sysupgrade.itb')
            self.assertTrue(self.rpc('saveSettings',data)['success'])
            result = self.rpc('checkUpdate')
            expected = next(r for r in releases if r['tag_name'].startswith(pattern[:-1]))
            self.assertTrue(result['success'],result)
            self.assertEqual(result['sha256'],expected['assets'][0]['digest'][7:])

    def test_unknown_board_explicit_rule_still_rejects_non_upgrade_images(self):
        self.backend.write_text(self.backend.read_text().replace('board=gemtek,w1700k','board=unknown,device'))
        self.assertTrue(self.rpc('checkUpdate')['success'])
        for token in ('factory','initramfs','bootloader','rootfs','kernel'):
            release = dict(tag_name='v1', published_at='2026-01-01T00:00:00Z', draft=False, prerelease=False, assets=[dict(self.asset,name='w1700k-'+token+'-sysupgrade.itb')])
            self.release.write_text(json.dumps([release]))
            self.assertFalse(self.rpc('checkUpdate')['success'])

    def test_proxy_used_only_by_worker_and_bound_to_candidate(self):
        self.uci('set', 'firmwareupgrade.main.download_proxy=https://gh-proxy.com/')
        identity = self.rpc('checkUpdate')['candidate_id']
        saved = (self.runtime/'firmwareupgrade.candidate').read_text()
        self.assertEqual(saved.splitlines()[1], self.asset['browser_download_url'])
        self.uci('set', 'firmwareupgrade.main.download_proxy=https://other.example/')
        self.assertFalse(self.rpc('startUpgrade',dict(keep_config='0',candidate_id=identity))['success'])
        self.stub('curl', '#!/bin/sh\nprintf "%s\\n" "$*" > "$ROOT/request"\nwhile [ "$1" != --output ]; do shift; done\nprintf image > "$2"\n')
        import subprocess
        result = subprocess.run(['busybox','ash',str(self.worker),self.asset['browser_download_url'],self.asset['name'],self.asset['digest'][7:],'0','5','','https://gh-proxy.com/'], env=self.env,timeout=10)
        self.assertEqual(result.returncode,0)
        request=(self.root/'request').read_text()
        self.assertIn('https://gh-proxy.com/'+self.asset['browser_download_url'],request)
        self.assertNotIn('secret',request)
        self.assertNotIn('Authorization',request)

    def test_download_proxy_settings(self):
        data = dict(repository='owner/repo', token='', keep_config='0', release_pattern='*', asset_pattern='*sysupgrade.itb', download_proxy='https://gh-proxy.com/')
        self.assertTrue(self.rpc('saveSettings', data)['success'])
        self.assertEqual(self.rpc('getSystemInfo')['download_proxy'], data['download_proxy'])
        for value in ('https://user:pass@host/', 'file:///tmp/', 'https://host/\nother', 'https://host/?token=x'):
            self.assertFalse(self.rpc('saveSettings', dict(data, download_proxy=value))['success'])

    def test_generic_rules_and_published_order(self):
        self.cfg.write_text("config firmwareupgrade 'main'\n option repository 'owner/repo'\n option release_pattern 'stable-*'\n option asset_pattern '*w1700k*sysupgrade.itb'\n")
        releases = [dict(tag_name='stable-old', published_at='2026-01-01T00:00:00Z', draft=False, prerelease=False, assets=[self.asset]), dict(tag_name='stable-new', published_at='2026-02-01T00:00:00Z', draft=False, prerelease=False, assets=[self.asset])]
        self.release.write_text(json.dumps(releases))
        result = self.rpc('checkUpdate')
        self.assertTrue(result['success'], result)
        self.assertEqual(result['tag_name'], 'stable-new')
