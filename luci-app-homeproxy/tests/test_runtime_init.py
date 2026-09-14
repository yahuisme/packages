import os, subprocess, tempfile
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'root/usr/libexec/homeproxy-runtime-init'

class RuntimeInit(unittest.TestCase):
    def run_case(self, fault='', initial='', pending=False):
        with tempfile.TemporaryDirectory() as d:
            r=Path(d); (r/'bin').mkdir(); (r/'run').mkdir()
            (r/'bin/uci').write_text("""#!/bin/sh
case \"$1:$2\" in
*-q:get) key=$(printf '%s' \"$3\" | tr '.' '_'); eval \"printf '%s' \\\"\\$UCI_$key\\\"\";;
*-q:set) [ \"$FAULT\" != set ] || exit 1; echo \"$3\" >> \"$ROOT/delta\"; echo \"$3\" >> \"$ROOT/sets\";;
*-q:commit) [ \"$FAULT\" != commit ] || exit 1; rm -f \"$ROOT/delta\";;
*-q:revert) echo \"revert $3\" >> \"$ROOT/events\"; [ ! -f \"$ROOT/delta\" ] || sed -i \"\\|^$3=|d\" \"$ROOT/delta\";; esac
""")
            (r/'bin/homeproxy-random-port').write_text('#!/bin/sh\n[ "$FAULT" != random_port ] || exit 1\nprintf 12345\n')
            (r/'bin/sing-box').write_text('#!/bin/sh\nprintf 1.14.0\n')
            for p in (r/'bin/uci',r/'bin/homeproxy-random-port',r/'bin/sing-box'): p.chmod(0o755)
            if pending:
                (r/'delta').write_text('homeproxy.user.pending=keep\n')
            env=dict(os.environ,ROOT=str(r),FAULT=fault,PATH=str(r/'bin')+':'+os.environ['PATH'],UCI_homeproxy_config_dashboard_port=initial,UCI_homeproxy_infra_clash_api_port='9090',UCI_homeproxy_config_dashboard_port_initialized=('1' if initial else '0'),UCI_homeproxy_infra_clash_api_port_initialized='1')
            script_text=SCRIPT.read_text().replace('/usr/libexec/homeproxy-random-port', str(r/'bin/homeproxy-random-port')).replace('/usr/bin/sing-box', str(r/'bin/sing-box')).replace('/var/run/homeproxy', str(r/'run'))
            script=r/'runtime-init'; script.write_text(script_text)
            x=subprocess.run(['busybox','ash',str(script)],env=env,capture_output=True,text=True)
            delta=(r/'delta').read_text() if (r/'delta').exists() else ''
            return x,(r/'sets').read_text() if (r/'sets').exists() else '',(r/'events').read_text() if (r/'events').exists() else '',bool(delta)
    def test_set_commit_and_random_failures_propagate(self):
        for f in ('set','commit','random_port'):
            x,_,events,delta=self.run_case(f,'')
            self.assertNotEqual(x.returncode,0,f)
            self.assertFalse(delta, f)
            if f in ('set', 'commit'):
                self.assertIn('revert', events)
    def test_success_and_no_change(self):
        x,sets,_,delta=self.run_case('', '9095')
        self.assertEqual(x.returncode,0,x.stderr); self.assertEqual(sets,''); self.assertFalse(delta)
        x,sets,_,delta=self.run_case('', '')
        self.assertEqual(x.returncode,0,x.stderr); self.assertIn('homeproxy.config.dashboard_port',sets); self.assertFalse(delta)

    def test_failure_preserves_preexisting_pending_delta(self):
        for fault in ('set', 'commit'):
            with self.subTest(fault=fault):
                x, _, _, delta = self.run_case(fault, '', pending=True)
                self.assertNotEqual(x.returncode, 0)
                self.assertTrue(delta)

if __name__ == '__main__': unittest.main()
