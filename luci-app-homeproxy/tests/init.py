#!/usr/bin/env python3
"""Execute only the config promotion block, never init/firewall/procd."""
import pathlib, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parents[1]
s=(root/'root/etc/init.d/homeproxy').read_text()
a=s.index('\tif [ "$client_ready" -eq 1 ]; then\n\t\tmv -f')
b=s.index('\n\tcase "$client_ready:$routing_mode"',a)
block=s[a:b]
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp)
 for mode in ['c','s']: (p/f'sing-box-{mode}.json').write_text('OLD')
 script='RUN_DIR='+tmp+'\nclient_ready=0\nserver_ready=0\nsync_subscription_cron() { :; }\nlog() { :; }\ntest_block() {\n'+block+'\n}\ntest_block\n'
 subprocess.run(['sh','-c',script],check=False)
 for mode in ['c','s']:
  assert (p/f'sing-box-{mode}.json').exists(), 'generation/check failure must retain old JSON'
 print('PASS init promotion failure retains old JSON')
