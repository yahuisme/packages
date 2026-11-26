"""Native UCI provider switches and complete server JSON; check-only core opt-in."""
import copy
import json
import os
import subprocess
import unittest

from test_reality_protocol_gate import NativeReality


class ACMEDNS01(unittest.TestCase):
    def test_native_provider_switches_filter_inactive_credentials(self):
        with NativeReality() as f:
            f.switch('vless', tls='1', reality='0', acme='1')
            f.uci('''const values={address:'127.0.0.1',tls_dns01_challenge:'1',
 tls_dns01_cf_api_token:'fixture-token',tls_dns01_ali_akid:'fixture-id',
 tls_dns01_ali_aksec:'fixture-secret',tls_dns01_ali_rid:'cn-hangzhou',
 tls_acme_domain:['example.invalid'],tls_acme_email:'fixture@example.invalid',
 tls_acme_provider:'letsencrypt'};
for(let k,v in values)if(!uci.set('homeproxy','listener',k,v))die('set');
if(!uci.commit('homeproxy'))die('commit');''')
            for provider in ('cfdns', 'alidns', 'cloudflare', 'alidns', 'cfdns'):
                with self.subTest(provider=provider):
                    f.uci("uci.set('homeproxy','listener','tls_dns01_provider'," + json.dumps(provider) + ");uci.commit('homeproxy');")
                    before = f.config.read_bytes()
                    config = f.generate(server=True)
                    challenge = config['inbounds'][0]['tls']['certificate_provider']['dns01_challenge']
                    self.assertEqual(challenge, {
                        'provider': 'alidns', 'access_key_id': 'fixture-id',
                        'access_key_secret': 'fixture-secret', 'region_id': 'cn-hangzhou'
                    } if provider == 'alidns' else {'provider': 'cloudflare', 'api_token': 'fixture-token'})
                    self.assertEqual(f.config.read_bytes(), before)
                    stored = json.loads(f.uci("print(sprintf('%J',uci.get_all('homeproxy','listener')));"))
                    self.assertEqual(stored['tls_dns01_cf_api_token'], 'fixture-token')
                    self.assertEqual(stored['tls_dns01_ali_aksec'], 'fixture-secret')
                    self.check_core(f, config)
                    if os.environ.get('SING_BOX_CHECK'):
                        # Prove the selected core really rejects the former union
                        # shape, not merely that check returned zero for a control.
                        bad = copy.deepcopy(config)
                        dns01 = bad['inbounds'][0]['tls']['certificate_provider']['dns01_challenge']
                        dns01['api_token' if provider == 'alidns' else 'access_key_id'] = 'inactive-secret'
                        self.check_core(f, bad, 'unknown field')
                        if provider != 'alidns':
                            bad = copy.deepcopy(config)
                            bad['inbounds'][0]['tls']['certificate_provider']['dns01_challenge']['provider'] = 'cfdns'
                            self.check_core(f, bad, 'unknown provider type: cfdns')
            for option in ('tls_dns01_challenge', 'tls_acme', 'tls'):
                with self.subTest(disabled=option):
                    f.uci("uci.set('homeproxy','listener'," + json.dumps(option) + ",'0');uci.commit('homeproxy');")
                    before = f.config.read_bytes()
                    inbound = f.generate(server=True)['inbounds'][0]
                    self.assertNotIn('dns01_challenge', inbound.get('tls', {}).get('certificate_provider', {}))
                    self.assertEqual(f.config.read_bytes(), before)

    def check_core(self, fixture, config, diagnostic=None):
        binary = os.environ.get('SING_BOX_CHECK')
        if not binary:
            return
        target = fixture.root / 'schema.json'
        target.write_text(json.dumps(config))
        run = subprocess.run([binary, 'check', '-c', str(target)], capture_output=True, text=True, timeout=15)
        if diagnostic:
            self.assertNotEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assertIn(diagnostic, run.stdout + run.stderr)
        else:
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)


if __name__ == '__main__':
    unittest.main()
