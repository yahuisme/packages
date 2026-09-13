"""Execute the actual RPC methods in host ucode with isolated boundaries."""
import json
from pathlib import Path
import re
import subprocess
import unittest

APP = Path(__file__).resolve().parents[1]

class DashboardRPC(unittest.TestCase):
    def test_local_status_and_action_validation(self):
        src = (APP/'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        status = src[src.index('\tresources_get: {'):src.index('\tresources_update: {')]
        program = '''let installed = false, calls = [];
const HP_DIR = '/fixture', RUN_DIR = '/run';
const RESOURCES = { dashboard: { version: '/fixture/dashboard/dashboard.ver', source: 'source' } };
function readfile(p) { if (p == '/fixture/dashboard/index.html') return installed ? 'html' : null; if (p == '/fixture/dashboard/dashboard.ver') return '20260908094002 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; return ''; }
function cursor() { return { load: function() {}, get: function() { return null; } }; }
function shellQuote(s) { return s; }
function system(s) { push(calls, s); return 0; }
const methods = {''' + status + '''};
let absent = methods.resources_get.call();
installed = true;
let present = methods.resources_get.call();
for (let action in ['update', 'remove', 'bad; touch /tmp/pwn', '']) methods.dashboard_manage.call({ args: { action } });
print(sprintf('%J', { absent, present, calls }));'''
        result = subprocess.run(['ucode', '-e', program], capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        self.assertFalse(data['absent']['resources'][0]['installed'])
        self.assertTrue(data['present']['resources'][0]['installed'])
        self.assertEqual(data['present']['resources'][0]['version'], '20260908094002')
        self.assertEqual(data['calls'], ['/fixture/scripts/update_resources.sh dashboard-update', '/fixture/scripts/update_resources.sh dashboard-remove'])
        acl = json.loads((APP/'root/usr/share/rpcd/acl.d/luci-app-homeproxy.json').read_text())['luci-app-homeproxy']
        self.assertIn('dashboard_manage', acl['write']['ubus']['luci.homeproxy'])
        self.assertNotIn('dashboard_manage', acl['read']['ubus']['luci.homeproxy'])

if __name__ == '__main__': unittest.main()
