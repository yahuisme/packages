#!/usr/bin/env python3
"""Subscription wrapper with isolated ucode and init fixtures, no real service calls."""
import os,pathlib,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[1]
s=(root/'root/etc/homeproxy/scripts/update_subscriptions.sh').read_text()
assert 'BACKUP_DIR' in s, 'subscription failure needs a persistent config/runtime backup'
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp); (p/'run').mkdir(); (p/'bin').mkdir(); (p/'config').write_text('OLD')
 (p/'run/sing-box-c.json').write_text('OLDJSON')
 fake=p/'bin/ucode'; fake.write_text('#!/bin/sh\nprintf NEW > "$CONFIG_PATH"\nrm -f "$RUN_DIR/sing-box-c.json"\nexit 1\n'); fake.chmod(0o755)
 service=p/'service'; service.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "$RUN_DIR/service-calls"\nexit 0\n'); service.chmod(0o755)
 test=p/'test.sh'; test.write_text(s.replace('/etc/init.d/homeproxy',str(service)))
 env=dict(os.environ,CONFIG_PATH=str(p/'config'),RUN_DIR=str(p/'run'),PATH=str(p/'bin')+':'+os.environ['PATH'])
 result=subprocess.run(['sh',str(test)],env=env,capture_output=True,text=True)
 assert result.returncode==1,result.stderr
 assert (p/'config').read_text()=='OLD'
 assert (p/'run/sing-box-c.json').read_text()=='OLDJSON'
 assert 'restart' in (p/'run/service-calls').read_text()
 print('PASS subscription wrapper: failed update restores config/runtime and attempts restart')
