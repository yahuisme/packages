"""Real UCI getter equivalence; count shell creation separately from execve."""
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RPC = ROOT / 'root/usr/libexec/rpcd/luci.airoha_npu'
LEGACY = '''uci_read() { "$UCI" -q -c "$ROOT/etc/config" -C "$flow_tmp" -t "$flow_tmp" "$@"; }
get_flow() (
    local sw=0 hw=0 flow_tmp options
    umask 077
    flow_tmp=$(mktemp -d "$ROOT/tmp/luci-airoha-npu-read.XXXXXX" 2>/dev/null) || { printf '{"enabled":null}\\n'; exit; }
    trap 'rm -rf "$flow_tmp"' EXIT
    trap 'exit 1' HUP INT TERM
    options=$(uci_read get 'firewall.@defaults[0]') && [ "$options" = defaults ] || { printf '{"enabled":null}\\n'; return; }
    options=$(uci_read show 'firewall.@defaults[0]') || { printf '{"enabled":null}\\n'; exit; }
    case "$options" in *.flow_offloading=*)
        sw=$(uci_read get 'firewall.@defaults[0].flow_offloading') || { printf '{"enabled":null}\\n'; exit; };; esac
    case "$options" in *.flow_offloading_hw=*)
        hw=$(uci_read get 'firewall.@defaults[0].flow_offloading_hw') || { printf '{"enabled":null}\\n'; exit; };; esac
    case "$sw:$hw" in
        1:1) printf '{"enabled":true}\\n';;
        0:0|0:1|1:0) printf '{"enabled":false}\\n';;
        *) printf '{"enabled":null}\\n';;
    esac
)
'''


class FlowCostTest(unittest.TestCase):
    def setUp(self):
        self.uci = os.environ.get('UCI_BIN') or shutil.which('uci')
        self.busybox = os.environ.get('BUSYBOX_BIN') or shutil.which('busybox')
        self.assertTrue(self.uci and self.busybox, 'real prebuilt UCI and BusyBox required')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = Path(self.tmp.name)
        self.config = self.d / 'etc/config'
        self.config.mkdir(parents=True)
        (self.d / 'tmp').mkdir()
        self.firewall = self.config / 'firewall'
        source = RPC.read_text()
        prefix = source[:source.index('UCI=${NPU_UCI:-uci}')]
        suffix = source[source.index('case "$1" in\n\tlist)'):]
        (self.d / 'before').write_text(prefix + 'UCI=${NPU_UCI:-uci}\n' + LEGACY + suffix)
        (self.d / 'after').write_text(source)
        self.env = dict(os.environ, NPU_ROOT=str(self.d), NPU_UCI=str(self.uci))

    def run_getter(self, version, trace=False):
        command = [self.busybox, 'ash', str(self.d / version), 'call', 'getFlowOffload']
        if trace:
            command = ['strace', '-f', '-qq', '-e', 'trace=process', '-o',
                       str(self.d / (version + '.trace')), *command]
        return subprocess.run(command, input=b'{}', capture_output=True, timeout=10, env=self.env)

    def compare(self, expected):
        before = (self.firewall.read_bytes(), self.firewall.stat().st_mtime_ns)
        old, new = self.run_getter('before'), self.run_getter('after')
        self.assertEqual((new.stdout, new.stderr, new.returncode),
                         (old.stdout, old.stderr, old.returncode))
        self.assertEqual(new.returncode, 0, new.stderr)
        self.assertIs(json.loads(new.stdout)['enabled'], expected)
        self.assertEqual((self.firewall.read_bytes(), self.firewall.stat().st_mtime_ns), before)
        self.assertEqual(list((self.d / 'tmp').iterdir()), [])

    def test_real_uci_types_escaping_absence_errors_and_freshness(self):
        for content, expected in [
                ("config defaults\n option flow_offloading '1'\n option flow_offloading_hw '1'\n", True),
                ("config defaults\n option flow_offloading '1'\n option flow_offloading_hw '0'\n", False),
                ("config defaults\n", False),
                ("config defaults\n option flow_offloading ''\n", False),
                ("config defaults\n list flow_offloading '1'\n list flow_offloading '0'\n option flow_offloading_hw '1'\n", None),
                ("config defaults\n option flow_offloading \"quote'\\\\value\"\n option flow_offloading_hw '1'\n", None),
                ("config defaults\n option flow_offloading '1\n0'\n option flow_offloading_hw '1'\n", None),
                ("config rule\n", None), ("config defaults\n option broken '\n", None)]:
            with self.subTest(content=content):
                self.firewall.write_text(content)
                self.compare(expected)
        self.firewall.write_text("config defaults\n option flow_offloading '1'\n option flow_offloading_hw '1'\n")
        # Failure after partial stdout must never look like a successful read.
        wrapper = self.d / 'uci-failure'
        wrapper.write_text('#!' + str(self.busybox) + ' ash\n' +
                           'if [ "$*" = "$FAIL_ARGS" ]; then printf "1\\n"; printf "failed read\\n" >&2; exit 7; fi\n' +
                           'exec ' + shlex.quote(str(self.uci)) + ' "$@"\n')
        wrapper.chmod(0o700)
        self.env['NPU_UCI'] = str(wrapper)
        # Private temp suffix varies, so inspect the last command/target instead.
        wrapper.write_text(wrapper.read_text().replace('[ "$*" = "$FAIL_ARGS" ]',
                           '[ "${8} ${9}" = "$FAIL_ARGS" ]'))
        for target in ['get firewall.@defaults[0]', 'show firewall.@defaults[0]',
                       'get firewall.@defaults[0].flow_offloading',
                       'get firewall.@defaults[0].flow_offloading_hw']:
            with self.subTest(failure=target):
                self.env['FAIL_ARGS'] = target
                self.compare(None)

    def test_four_uci_execs_without_forwarding_subshells(self):
        self.firewall.write_text("config defaults\n option flow_offloading '1'\n option flow_offloading_hw '1'\n")
        before = (self.firewall.read_bytes(), self.firewall.stat().st_mtime_ns)
        results = {}
        for version in ('before', 'after'):
            r = self.run_getter(version, trace=True)
            trace = (self.d / (version + '.trace')).read_text()
            results[version] = dict(stdout=r.stdout.decode(), stderr=r.stderr.decode(), status=r.returncode,
                created_processes=len(re.findall(r'\b(?:clone|clone3|fork|vfork)\(.*(?:= [1-9][0-9]*|<unfinished \.\.\.>)', trace)),
                execve=len(re.findall(r'\bexecve\(', trace)),
                uci_execve=len(re.findall(r'execve\("' + re.escape(str(self.uci)) + r'"', trace)))
            out = os.environ.get('EQUIVALENCE_LOG_DIR')
            if out:
                out = Path(out); out.mkdir(parents=True, exist_ok=True)
                (out / ('npu-' + version + '.trace')).write_text(trace)
                (out / ('npu-' + version + '.json')).write_text(json.dumps(results[version], indent=2))
        self.assertEqual(results['before']['stdout'], results['after']['stdout'])
        self.assertEqual(results['after']['stdout'], '{"enabled":true}\n')
        self.assertEqual(results['before']['uci_execve'], 4, results)
        self.assertEqual(results['after']['uci_execve'], 4, results)
        self.assertEqual(results['before']['execve'], results['after']['execve'], results)
        self.assertEqual((self.firewall.read_bytes(), self.firewall.stat().st_mtime_ns), before)
        self.assertEqual(list((self.d / 'tmp').iterdir()), [])
        print('NPU accounting:', json.dumps(results, sort_keys=True))
        self.assertEqual(results['after']['created_processes'], results['before']['created_processes'] - 4, results)


if __name__ == '__main__':
    unittest.main()
