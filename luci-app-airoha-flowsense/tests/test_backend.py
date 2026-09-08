import json
import os
import pathlib
import shlex
import shutil
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]


def dependency(name):
    requested = os.environ.get(name.upper() + '_BIN') or name
    found = shutil.which(requested)
    if not found:
        raise SystemExit(f'Required real dependency missing: {requested}; set {name.upper()}_BIN or PATH')
    return str(pathlib.Path(found).resolve())


uci = dependency('uci')
jsonfilter = dependency('jsonfilter')
busybox = dependency('busybox')
with tempfile.TemporaryDirectory() as td:
    d = pathlib.Path(td)
    for name in ('bin', 'config', 'delta', 'fresh'):
        (d / name).mkdir()
    (d / 'config/npu-monitor').write_text("config jitter\n option target '223.5.5.5'\n option enabled '1'\n")
    common = root / 'root/usr/libexec/flowsense-common.sh'
    rpc = (root / 'root/usr/libexec/rpcd/luci.airoha_flowsense').read_text().replace(
        '/usr/libexec/flowsense-common.sh', str(common)).replace(
        '/etc/init.d/npu-jitter restart', 'fake_restart').replace(
        '/sys/kernel/debug/ppe/entries', str(d / 'entries'))
    (d / 'rpc').write_text(rpc)
    (d / 'bin/jsonfilter').symlink_to(jsonfilter)
    # Inject a single command failure, then allow real UCI rollback.
    # -t is intentional: -P silently disables commit in the real CLI.
    (d / 'bin/uci').write_text('''#!/bin/sh
if [ -n "$FAIL_COMMAND" ] && [ "$1" = "$FAIL_COMMAND" ] && [ ! -e "$FAIL_MARKER" ]; then
    touch "$FAIL_MARKER"
    exit 1
fi
exec ''' + shlex.join([uci, '-c', str(d / 'config'), '-t', str(d / 'delta')]) + ' "$@"\n')
    (d / 'bin/fake_restart').write_text('''#!/bin/sh
printf 'restart\n' >> "$RESTART_LOG"
if [ "$FAIL_RESTART" = 1 ] && [ ! -e "$FAIL_MARKER" ]; then
    touch "$FAIL_MARKER"
    exit 1
fi
''')
    for p in (d / 'bin').iterdir():
        if not p.is_symlink():
            p.chmod(0o755)
    env = dict(os.environ, PATH=str(d / 'bin') + ':' + os.environ['PATH'],
               FAIL_MARKER=str(d / 'failed'), RESTART_LOG=str(d / 'restarts'))

    def call(method, payload=None, extra=None):
        result = subprocess.run([busybox, 'ash', str(d / 'rpc'), 'call', method],
                                input=json.dumps(payload or {}) + '\n', text=True,
                                capture_output=True, env=dict(env, **(extra or {})), timeout=10)
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)

    def persisted():
        # Fresh context cannot see staged deltas used by the RPC wrapper.
        return tuple(subprocess.check_output(
            [uci, '-c', str(d / 'config'), '-t', str(d / 'fresh'), 'get',
             'npu-monitor.@jitter[0].' + key], text=True).strip()
                     for key in ('target', 'enabled'))

    initial = persisted()
    assert call('setMonitor', {'target': 'bad"target', 'enabled': 1})['success'] is False
    assert persisted() == initial
    assert not (d / 'restarts').exists()
    for failure in ({'FAIL_COMMAND': 'set'}, {'FAIL_COMMAND': 'commit'}, {'FAIL_RESTART': '1'}):
        (d / 'failed').unlink(missing_ok=True)
        assert call('setMonitor', {'target': 'example.com', 'enabled': 0}, failure)['success'] is False
        assert (d / 'failed').exists(), failure
        assert persisted() == initial, failure
        print('PASS: injected failure and persisted rollback', failure)
    assert call('setMonitor', {'target': 'example.com', 'enabled': 0})['success'] is True
    assert persisted() == ('example.com', '0')
    assert (d / 'restarts').read_text().splitlines()
    (d / 'entries').write_text(pathlib.Path(__file__).with_name('ppe-fixture.txt').read_text())
    p = call('getPpeEntries')
    assert p['total'] == 4 and p['bnd'] == 2 and p['unb'] == 1, p
    (d / 'entries').unlink()
    assert call('getPpeEntries')['available'] is False
    print(f'Real dependencies: uci={uci}; jsonfilter={jsonfilter}')
    print('PASS: validation, durable save in fresh UCI context, PPE counts/missing source; service restart stubbed')
