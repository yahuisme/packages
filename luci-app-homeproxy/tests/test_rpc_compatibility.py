"""Load the complete RPC module with real native fs/UCI, private helper only."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]


class RpcCompatibility(unittest.TestCase):
    def test_latency_probe_distinguishes_success_http_errors_and_timeout(self):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        start = rpc.index('const parseDelayResponse =')
        end = rpc.index('let requested_nodes =', start)
        with tempfile.TemporaryDirectory(prefix='hp-delay-rpc-') as directory:
            root = Path(directory)
            script = root / 'case.uc'
            curl = root / 'curl'
            curl.write_text('''#!/bin/sh
while [ "$#" -gt 0 ]; do
 case "$1" in
 -fsS) discard_error_body=1 ;;
 -o) output="$2"; shift ;;
 --write-out) [ "$2" = '%{http_code} ' ] || exit 2; show_code=1; shift ;;
 --max-time) [ "$2" -gt 5 ] && has_grace=1; shift ;;
 esac
 shift
done
case "$output" in
 */ok.json) body='{"delay":42}'; http=200; status=0 ;;
 */failed.json) body='{"message":"An error occurred in the delay test"}'; http=503; status=0 ;;
 */timeout.json) body='{"message":"Timeout"}'; http=504; status=0 ;;
 */partial.json) body='{"delay":42}'; http=200; status=18 ;;
 */noresponse.json) body=''; http=0; status=28 ;;
esac
if [ "${has_grace:-0}" -ne 1 ] && [ "$http" -eq 504 ]; then
 http=0; status=28; body=''
fi
if [ "$http" -ge 400 ] && [ "${discard_error_body:-0}" -eq 1 ]; then body=''; status=22; fi
[ -z "$body" ] || printf '%s' "$body" > "$output"
[ "${show_code:-0}" -eq 0 ] || printf '%03d ' "$http"
exit "$status"
''')
            curl.chmod(0o700)
            helper = (APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
            quote = helper[helper.index('export function shellQuote'):helper.index('export function isBinary')].replace('export function', 'function')
            script.write_text('import {readfile} from "fs";\n' + quote + '''
const delay_timeout_ms=5000, probe_parallelism=16, probe_url_encoded='fixture';
const error_codes={delay_failed:'delay_failed',delay_timeout:'delay_timeout'};
const formatResult=(node,state,latency_ms,error)=>({node,state,latency_ms,error});
''' + rpc[start:end].replace('/usr/bin/curl', str(curl)) + '''
const entries=map(['ok','failed','timeout','partial','noresponse'],tag=>({tag,node:tag}));
probeDelays({session_dir:ARGV[0],controller_url:'http://fixture.invalid'},entries);
print(sprintf('%J',map(entries,entry=>entry.result)));
''')
            run = subprocess.run(['ucode', str(script), directory], text=True, capture_output=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            result = json.loads(run.stdout)
            self.assertEqual([(r['node'], r['state'], r['latency_ms']) for r in result],
                             [('ok', 'success', 42), ('failed', 'error', None), ('timeout', 'timeout', None),
                              ('partial', 'error', None), ('noresponse', 'timeout', None)])
            self.assertEqual(result[1]['error']['message'], 'An error occurred in the delay test')

    def test_log_viewer_reads_through_its_own_rpc(self):
        acl = json.loads((APP / 'root/usr/share/rpcd/acl.d/luci-app-homeproxy.json').read_text())['luci-app-homeproxy']
        self.assertIn('log_read', acl['read']['ubus']['luci.homeproxy'])
        for name in ('homeproxy', 'sing-box-c', 'sing-box-s'):
            self.assertNotIn(f'/var/run/homeproxy/{name}.log', json.dumps(acl['read']),
                             'the viewer must not need raw log file access')
        view = (APP / 'htdocs/luci-static/resources/view/homeproxy/status.js').read_text()
        self.assertIn("method: 'log_read'", view)
        self.assertNotIn('read_direct', view, 'a poll must not refetch the whole log')

    def test_atomic_private_directories_are_unique_with_native_fs(self):
        runtime = os.environ.get('HP_COMPAT_UCODE', 'ucode')
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        helper = (APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
        quote = helper[helper.index('export function shellQuote'):helper.index('export function isBinary')].replace('export function', 'function')
        allocation = rpc[rpc.index('function makeTempDir'):rpc.index('function validDomainListId')]
        with tempfile.TemporaryDirectory(prefix='hp-native-stage-') as directory:
            root = Path(directory)
            script = root / 'case.uc'
            script.write_text("import { popen, lstat } from 'fs';\n" + quote + allocation +
                              'let result=[]; for(let i=0;i<20;i++) push(result, makeTempDir(' + json.dumps(str(root / 'stage.XXXXXX')) + ')); printf("%J",result);')
            run = subprocess.run([runtime, str(script)], text=True, capture_output=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            paths = json.loads(run.stdout)
            self.assertEqual(len(set(paths)), 20)
            for path in paths:
                self.assertEqual(Path(path).stat().st_mode & 0o777, 0o700)

    def test_complete_rpc_links_on_selected_openwrt_runtime(self):
        runtime = os.environ.get('HP_COMPAT_UCODE', 'ucode')
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        with tempfile.TemporaryDirectory(prefix='hp-rpc-link-') as directory:
            root = Path(directory)
            helper = root / 'helper.uc'
            http = root / 'http.uc'
            http.write_text('export function urldecode_params(v) { return {}; };')
            helper.write_text((APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
                              .replace("from 'luci.http'", 'from ' + json.dumps(str(http))))
            module = root / 'rpc.uc'
            module.write_text(rpc.replace("'/etc/homeproxy/scripts/homeproxy.uc'", json.dumps(str(helper)))
                              .replace('/etc/homeproxy/scripts/runtime-files.uc', str(APP / 'root/etc/homeproxy/scripts/runtime-files.uc'))
                              .replace("return { 'luci.homeproxy': methods };", 'print("linked\\n");'))
            run = subprocess.run([runtime, str(module)], text=True, capture_output=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(run.stdout, 'linked\n')


if __name__ == '__main__':
    unittest.main()
