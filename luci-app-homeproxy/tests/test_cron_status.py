"""Complete cron wrapper in native ash; private updater/service boundaries."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP=Path(__file__).resolve().parents[1]

class CronStatus(unittest.TestCase):
    def test_child_failures_propagate_after_independent_updates(self):
        cases=[('success',0,0,0,False,0),('current',3,0,0,False,0),
               ('busy',2,2,0,False,0),('resource-failure',1,0,0,False,1),
               ('subscription-failure',3,7,0,False,1),('reload-failure',0,0,1,True,1),
               ('no-url',3,0,0,True,0)]
        for name,resource,subscription,reload,no_url,expected in cases:
            with self.subTest(case=name), tempfile.TemporaryDirectory(prefix='hp-cron-status-') as directory:
                root=Path(directory);scripts=root/'scripts';scripts.mkdir();run=root/'run';run.mkdir()
                (scripts/'update_resources.sh').write_text('#!/bin/sh\nprintf "resources\\n" >> "$EVENTS"\nprintf "status='+str(resource)+'\\ncore_updated='+('1' if resource==0 else '0')+'\\n" > '+str(run/'update_resources.result')+'\nexit '+str(resource)+'\n')
                (scripts/'update_subscriptions.sh').write_text('#!/bin/sh\nprintf "subscription\\n" >> "$EVENTS"\nexit '+str(subscription)+'\n')
                for script in scripts.iterdir():script.chmod(0o755)
                code=(APP/'root/etc/homeproxy/scripts/update_crond.sh').read_text().replace('SCRIPTS_DIR="/etc/homeproxy/scripts"','SCRIPTS_DIR="'+str(scripts)+'"').replace('RUN_DIR="/var/run/homeproxy"','RUN_DIR="'+str(run)+'"').replace('/etc/init.d/homeproxy','homeproxy_init')
                pre='uci(){ case "$*" in *subscription_url) '+('return 1' if no_url else 'printf https://fixture.invalid')+';; esac; }; homeproxy_init(){ [ "$1" = running ] || return '+str(reload)+'; };\n'
                result=subprocess.run(['busybox','ash','-c',pre+code],env=dict(os.environ,EVENTS=str(root/'events')),capture_output=True,text=True)
                self.assertEqual(result.returncode,expected,result.stderr)
                self.assertEqual((root/'events').read_text().splitlines(),['resources']+([] if no_url else ['subscription']))

if __name__=='__main__':unittest.main()
