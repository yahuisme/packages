import pathlib,subprocess,tempfile,json,os
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
 d=pathlib.Path(td);(d/'bin').mkdir();(d/'config').mkdir();(d/'delta').mkdir();(d/'config/npu-monitor').write_text("config jitter\n option target '223.5.5.5'\n option enabled '1'\n")
 common=root/'root/usr/libexec/flowsense-common.sh'
 rpc=(root/'root/usr/libexec/rpcd/luci.airoha_flowsense').read_text().replace('/usr/libexec/flowsense-common.sh',str(common)).replace('/etc/init.d/npu-jitter restart','fake_restart').replace('/sys/kernel/debug/ppe/entries',str(d/'entries'))
 (d/'rpc').write_text(rpc)
 (d/'bin/jsonfilter').symlink_to('/root/flowsense-audit/jsonfilter')
 (d/'bin/uci').write_text('#!/bin/sh\n[ "$FAIL" != 1 ] || exit 1\nexec /root/wifi7-audit-evidence/uci-test-source/uci -c "'+str(d/'config')+'" -P "'+str(d/'delta')+'" "$@"\n')
 (d/'bin/fake_restart').write_text('#!/bin/sh\nexit 0\n')
 for p in (d/'bin').iterdir():p.chmod(0o755)
 env=dict(os.environ,PATH=str(d/'bin')+':'+os.environ['PATH'])
 def call(method,payload={},extra={}):return subprocess.run(['busybox','ash',str(d/'rpc'),'call',method],input=json.dumps(payload)+'\n',text=True,capture_output=True,env=dict(env,**extra))
 assert json.loads(call('setMonitor',{'target':'bad"target','enabled':1}).stdout)['success'] is False
 assert json.loads(call('setMonitor',{'target':'1.1.1.1','enabled':1},{'FAIL':'1'}).stdout)['success'] is False
 assert json.loads(call('setMonitor',{'target':'example.com','enabled':0}).stdout)['success'] is True
 (d/'entries').write_text(pathlib.Path(__file__).with_name('ppe-fixture.txt').read_text())
 r=call('getPpeEntries');p=json.loads(r.stdout);assert p['total']==4 and p['bnd']==2 and p['unb']==1,p
 (d/'entries').unlink();assert json.loads(call('getPpeEntries').stdout)['available'] is False
 print('Real UCI/jsonfilter: validation, failed write, valid save, PPE count and missing source PASS')
