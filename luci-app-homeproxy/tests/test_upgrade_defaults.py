"""Upgrade hook uses real ash/private command boundaries; no host defaults."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import test_reload

APP=Path(__file__).resolve().parents[1]

class UpgradeDefaults(unittest.TestCase):
    def test_upgrade_reloads_client_or_server_and_preserves_retry_failure(self):
        source=(APP/'root/etc/uci-defaults/luci-homeproxy').read_text()
        for mode in ['client','server','none']:
            for failure in [False,True]:
                with self.subTest(mode=mode,failure=failure), tempfile.TemporaryDirectory(prefix='hp-upgrade-') as directory:
                    root=Path(directory);run=root/'run';run.mkdir()
                    if mode!='none':(run/('sing-box-'+('c' if mode=='client' else 's')+'.json')).write_text('OLD')
                    code=source.replace('/usr/libexec/homeproxy-runtime-init','runtime_init').replace('/etc/init.d/homeproxy','homeproxy_init').replace('/var/run/homeproxy',str(run)).replace('/etc/homeproxy/dashboard',str(root/'dashboard')).replace('/tmp/luci-',str(root/'luci-'))
                    pre='''ucode(){ return 0; }
runtime_init(){ return 0; }
uci(){ cat >/dev/null; return 0; }
homeproxy_init(){ printf '%s\\n' "$1" >> "$RELOAD_EVENTS"; [ "$1" = reload ] && [ "$RELOAD_FAIL" = 0 ]; }
'''
                    result=subprocess.run(['busybox','ash','-c',pre+code],env=dict(os.environ,RELOAD_EVENTS=str(root/'events'),RELOAD_FAIL=str(int(failure))),capture_output=True,text=True)
                    self.assertEqual(result.returncode,1 if failure and mode!='none' else 0,result.stderr)
                    events=(root/'events').read_text().splitlines() if (root/'events').exists() else []
                    self.assertEqual(events,[] if mode=='none' else ['reload'])
                    self.assertNotIn('restart',events)

    def test_native_upgrade_reload_keeps_old_runtime_on_preparation_failure(self):
        for fault in ['runtime-init','generate']:
            with self.subTest(fault=fault):
                test_reload.Reload().run_case(fault,mode='both',operation='reload',preexisting=True)

if __name__=='__main__':unittest.main()
