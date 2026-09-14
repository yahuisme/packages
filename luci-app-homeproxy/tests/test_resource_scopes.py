"""Real ash, loopback HTTP and ucode digest; isolated decoder/init boundaries."""
import fcntl
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import zipfile

APP = Path(__file__).resolve().parents[1]

class ResourceScopes(unittest.TestCase):
    def test_rpc_request_contract(self):
        src = (APP/'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        method = src[src.index('\tresources_update: {'):src.index('\n};', src.index('\tresources_update: {'))]
        program = '''let calls = [], results = [];
const HP_DIR='/fixture', RUN_DIR='/run';
function cursor() { return {load:function(){},get:function(){return null;}}; }
function shellQuote(s) { return s; }
function readfile(p) { return 'status=0\ncore_updated=1\n'; }
function system(s) { push(calls,s); return 0; }
const methods={''' + method + '''};
for (let args in [{}, {scope:'all'}, {scope:'geoip'}, {scope:'geosite'}, {scope:'manual'}, {scope:''}, {scope:'bad;touch /tmp/pwn'}, {scope:1}])
 push(results,methods.resources_update.call({args}));
print(sprintf('%J',{args:methods.resources_update.args,calls,results}));'''
        p = subprocess.run(['ucode','-e',program],capture_output=True,text=True,check=True)
        data = json.loads(p.stdout)
        self.assertEqual(data['args'], {'scope':'all'})
        self.assertEqual(data['calls'], ['/fixture/scripts/update_resources.sh rules '+s for s in ['all','all','geoip','geosite','manual']])
        self.assertEqual([x['status'] for x in data['results']], [0]*5+[1]*3)

    def rpc_result(self, status, file_status, flags):
        src = (APP/'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        method = src[src.index('\tresources_update: {'):src.index('\n};', src.index('\tresources_update: {'))]
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp)/'update_resources.result').write_text(
                f'status={file_status}\n' + ''.join(f'{k}={v}\n' for k, v in flags.items()))
            program = '''import { readfile as fs_readfile } from 'fs';
let reads = [], calls = [];
const HP_DIR='/fixture', RUN_DIR=''' + json.dumps(temp) + ''';
function cursor() { return {load:function(){},get:function(){return null;}}; }
function shellQuote(s) { return s; }
function readfile(p) { push(reads,p); return fs_readfile(p); }
function system(s) { push(calls,s); return ''' + str(status) + '''; }
const methods={''' + method + '''};
const result=methods.resources_update.call({args:{scope:'manual'}});
print(sprintf('%J',{result,reads,calls}));'''
            p = subprocess.run(['ucode','-e',program], capture_output=True, text=True, check=True)
            data = json.loads(p.stdout)
            self.assertEqual(data['calls'], ['/fixture/scripts/update_resources.sh rules manual'])
            self.assertEqual(data['reads'], [] if status == 2 else [temp+'/update_resources.result'])
            return data['result']

    def test_rpc_per_item_results(self):
        result = self.rpc_result(0, 0, {'geoip_cn':0, 'geosite_cn':3, 'dashboard':3})
        self.assertEqual(result['resources'], [
            {'type':'geoip_cn','status':0}, {'type':'geosite_cn','status':3}, {'type':'dashboard','status':3}])
        result = self.rpc_result(1, 1, {'geoip_cn':1, 'geosite_cn':3, 'dashboard':''})
        self.assertEqual(result['resources'], [{'type':'geoip_cn','status':1}, {'type':'geosite_cn','status':3}])

    def test_rpc_matching_result_preserves_failure_flags(self):
        for apply, rollback in [(1, 0), (1, 1), (0, 1), (0, 0)]:
            with self.subTest(apply=apply, rollback=rollback):
                result = self.rpc_result(1, 1, {'apply_failed':apply, 'rollback_failed':rollback})
                self.assertEqual(result['status'], 1)
                self.assertIs(result['apply_failed'], bool(apply))
                self.assertIs(result['rollback_failed'], bool(rollback))

    def test_rpc_mismatched_result_discards_stale_flags(self):
        result = self.rpc_result(1, 0, {key:1 for key in
            ['apply_failed', 'rollback_failed', 'core_updated', 'dashboard_updated']})
        self.assertEqual(result, dict(status=1, apply_failed=False, rollback_failed=False,
            core_updated=False, dashboard_updated=False, updated=None, failed=None, resources=[]))

    def test_rpc_busy_does_not_read_old_result(self):
        # Even a matching stale status must never supply flags while the lock is held.
        result = self.rpc_result(2, 2, {'apply_failed':1, 'rollback_failed':1})
        self.assertEqual(result, dict(status=2, apply_failed=False, rollback_failed=False,
            core_updated=False, dashboard_updated=False, updated=None, failed=None, resources=[]))

    def test_http_scope_transactions(self):
        evidence = []
        for scope, installed in [('geoip',True),('geosite',True),('all',True),(None,True),('manual',False),('manual',True)]:
            with self.subTest(scope=scope, installed=installed), tempfile.TemporaryDirectory() as temp:
                root=Path(temp); resources=root/'resources'; dashboard=root/'dashboard'; resources.mkdir()
                for kind in ['geoip','geosite']:
                    (resources/(kind+'_cn.srs')).write_bytes(b'old '+kind.encode())
                    (resources/(kind+'_cn.ver')).write_text('old version')
                (resources/'private.txt').write_text('preserve')
                if installed:
                    dashboard.mkdir(); (dashboard/'index.html').write_text('old dashboard'); (dashboard/'dashboard.ver').write_text('old')
                payload=b'SRS\x01fixture'; bad=['NO_FAILURE']; generation=[1]; paths=[]
                blob=hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\0'+payload).hexdigest()
                archive=io.BytesIO()
                with zipfile.ZipFile(archive,'w') as z: z.writestr('site/index.html','new dashboard')
                class Handler(http.server.BaseHTTPRequestHandler):
                    def do_GET(self):
                        paths.append(self.path)
                        if self.path.endswith('/version'):
                            body=json.dumps({'sha':str(generation[0])*40,'commit':{'committer':{'date':'2024-02-03T04:05:06Z'}}}).encode()
                        elif '/digest?' in self.path: body=json.dumps({'sha':blob}).encode()
                        elif self.path.endswith('.srs'): body=b'corrupt' if bad[0] in self.path else payload
                        else: body=b'bad archive' if bad[0]=='dashboard' else archive.getvalue()
                        self.send_response(200); self.end_headers(); self.wfile.write(body)
                    def log_message(self,*args): pass
                # None is not a substring: use an impossible sentinel.
                bad[0]='NO_FAILURE'
                server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
                thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
                try:
                    init=root/'init'; init.write_text('#!/bin/sh\n[ "$1" != reload ] || [ "$FAIL_RELOAD" != 1 ]\n'); init.chmod(0o755)
                    decoder=root/'decoder'; decoder.write_text('#!/bin/sh\nexit 0\n'); decoder.chmod(0o755)
                    wrapper=root/'ucode'; wrapper.write_text('#!/bin/sh\nexec /usr/local/bin/ucode -L "$UCODE_LIB_DIR" "$@"\n'); wrapper.chmod(0o755)
                    env=dict(os.environ,PATH=str(root)+':'+os.environ['PATH'], UCODE_LIB_DIR=os.environ.get('UCODE_LIB_DIR','/root/homeproxy-runtime-quality-tools/build'),RESOURCES_DIR=str(resources),DASHBOARD_DIR=str(dashboard),RUN_DIR=str(root/'run'),SING_BOX=os.environ.get('SING_BOX_TEST',str(decoder)),HOMEPROXY_INIT=str(init))
                    # A real decoder may be supplied together with a real packaged SRS.
                    if os.environ.get('SING_BOX_TEST'):
                        payload=(APP/'root/etc/homeproxy/resources/geoip_cn.srs').read_bytes()
                        blob=hashlib.sha1(b'blob '+str(len(payload)).encode()+b'\0'+payload).hexdigest()
                    url=f'http://127.0.0.1:{server.server_port}'
                    for kind in ['GEOIP','GEOSITE','DASHBOARD']:
                        env[kind+'_SOURCE']=url+'/'+kind.lower(); env[kind+'_VERSION_URL']=url+'/'+kind.lower()+'/version'
                        env[kind+'_DIGEST_URL']=url+'/'+kind.lower()+'/digest'
                    def snapshot():
                        return {str(p.relative_to(root)):p.read_bytes() for d in [resources,dashboard] if d.exists() for p in d.rglob('*') if p.is_file()}
                    def run(code, args=None):
                        start=len(paths)
                        cmd=['busybox','ash',str(APP/'root/etc/homeproxy/scripts/update_resources.sh')]
                        cmd += args if args is not None else ([] if scope is None else ['rules',scope])
                        p=subprocess.run(cmd,env=env,capture_output=True,text=True)
                        self.assertEqual(p.returncode,code,p.stderr)
                        return paths[start:]
                    before=snapshot()
                    self.assertEqual(run(1,['rules','bad;touch /tmp/pwn']),[]); self.assertEqual(snapshot(),before)
                    selected={'geoip','geosite'} if scope in [None,'all','manual'] else {scope}
                    if scope=='manual' and installed: selected.add('dashboard')
                    requested=run(0)
                    self.assertEqual({p.split('/')[1] for p in requested},selected)
                    result_file=root/'run/update_resources.result'
                    def item_results():
                        values=dict(line.split('=',1) for line in result_file.read_text().splitlines())
                        return {k:int(values[k]) for k in ['geoip_cn','geosite_cn','dashboard'] if values.get(k)}
                    expected={k if k=='dashboard' else k+'_cn' for k in selected}
                    self.assertEqual(item_results(),dict.fromkeys(expected,0))
                    after=snapshot()
                    for name,data in before.items():
                        if not any(name.startswith('resources/'+k+'_cn.') or name.startswith(k+'/') for k in selected): self.assertEqual(after[name],data)
                    self.assertEqual(dashboard.exists(),installed)
                    run(3); self.assertEqual(snapshot(),after)
                    self.assertEqual(item_results(),dict.fromkeys(expected,3))
                    with (root/'run/update_resources.lock').open('w') as lock:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        self.assertEqual(run(2), [])
                        self.assertEqual(run(2, ['dashboard-update']), [])
                        self.assertEqual(snapshot(),after)
                    generation[0]=2
                    bad[0]=next(iter(sorted(selected)))
                    run(1); self.assertEqual(snapshot(),after,'download/digest/archive failure retains all')
                    self.assertEqual(item_results(),dict.fromkeys(expected,1))
                    bad[0]='NO_FAILURE'; env['FAIL_RELOAD']='1'
                    run(1); self.assertEqual(snapshot(),after,'reload failure rolls back selected transaction')
                    self.assertIn('apply_failed=1',(root/'run/update_resources.result').read_text())
                    env['FAIL_RELOAD']='0'; run(0)
                    if 'dashboard' in selected:
                        # Already-current dashboard must not discard updated rules.
                        (resources/'geoip_cn.ver').write_text('old'); run(0)
                        self.assertIn('2222',(resources/'geoip_cn.ver').read_text())
                        self.assertEqual(item_results(),{'geoip_cn':0,'geosite_cn':3,'dashboard':3})
                    evidence.append({'scope':scope,'installed':installed,'requested':requested,'rollback':'passed'})
                finally: server.shutdown(); server.server_close(); thread.join()
        if os.environ.get('SCOPE_EVIDENCE'): Path(os.environ['SCOPE_EVIDENCE']).write_text(json.dumps(evidence,indent=2))

if __name__=='__main__': unittest.main()
