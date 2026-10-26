import json
import os
import pathlib
import subprocess
import tempfile
import unittest

root = pathlib.Path(__file__).resolve().parents[1]


def isolated_source(directory):
    source = (root / 'root/usr/libexec/npu-jitter-daemon').read_text().replace(
        '/usr/libexec/flowsense-common.sh', str(root / 'root/usr/libexec/flowsense-common.sh')).replace(
        '/var/run/npu-jitter.json', str(directory / 'result.json'))
    # Ubuntu BusyBox ash prefers compiled-in applets over PATH. Shell functions
    # always win and invoke only the private fixtures, even on that build.
    return ('ping() { "' + str(directory / 'bin/ping') + '" "$@"; }\n'
            'sleep() { "' + str(directory / 'bin/sleep') + '" "$@"; }\n' + source)


class DaemonTest(unittest.TestCase):
    def test_failed_publication_preserves_previous_complete_sample(self):
        with tempfile.TemporaryDirectory() as td:
            d = pathlib.Path(td); (d / 'bin').mkdir()
            result = d / 'result.json'
            original = b'{"timestamp":1,"last_ping":5}\n'; result.write_bytes(original)
            (d / 'bin/ping').write_text('#!/bin/sh\nprintf "round-trip min/avg/max = 10.000/10.000/10.000 ms\\n"\n')
            (d / 'bin/sleep').write_text('#!/bin/sh\nkill -TERM "$PPID"\n')
            for p in (d / 'bin').iterdir(): p.chmod(0o755)
            source = isolated_source(d)
            # A failing shell write models tmpfs exhaustion, without host devices.
            source = source.replace('values=\n', '''printf() {
    case "$2" in '{"timestamp":'*) command printf '%s' '{broken'; return 1;; esac
    command printf "$@"
}
values=
''', 1)
            (d / 'daemon').write_text(source)
            subprocess.run(['busybox', 'ash', str(d / 'daemon'), 'example.com'],
                           env=dict(os.environ, PATH=str(d / 'bin') + ':' + os.environ['PATH']),
                           timeout=5)
            self.assertEqual(result.read_bytes(), original, 'failed output must not replace last complete sample')
            self.assertFalse(list(d.glob('result.json.*')))

    def test_rolling_window_is_bounded_and_preserves_loss(self):
        for sequence in ([0, 0.125, None, 10, 999.999, None, 25.5], [None]):
            with self.subTest(sequence=sequence), tempfile.TemporaryDirectory() as td:
                d = pathlib.Path(td); (d / 'bin').mkdir()
                probes = [sequence[i % len(sequence)] for i in range(30)]
                # BusyBox consumes one deterministic probe result per iteration.
                (d / 'probes').write_text('\n'.join('-' if v is None else str(v) for v in probes) + '\n')
                (d / 'bin/ping').write_text('''#!/bin/sh
n=$(cat "$FIXTURE/count" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$FIXTURE/count"
v=$(sed -n "${n}p" "$FIXTURE/probes")
[ "$v" = - ] || printf 'round-trip min/avg/max = %s/%s/%s ms\n' "$v" "$v" "$v"
''')
                (d / 'bin/sleep').write_text('''#!/bin/sh
cat "$FIXTURE/result.json" >> "$FIXTURE/windows"
[ "$(cat "$FIXTURE/count")" -lt 30 ] || kill -TERM "$PPID"
''')
                for p in (d / 'bin').iterdir(): p.chmod(0o755)
                source = isolated_source(d)
                (d / 'daemon').write_text(source)
                result = subprocess.run(['busybox', 'ash', '-x', str(d / 'daemon'), 'example.com'],
                    env=dict(os.environ, FIXTURE=td, PATH=str(d / 'bin') + ':' + os.environ['PATH']),
                    timeout=10, capture_output=True, text=True, check=True)
                windows = [json.loads(line) for line in (d / 'windows').read_text().splitlines()]
                self.assertEqual(len(windows), len(probes))
                for i, actual in enumerate(windows):
                    window = probes[max(0, i - 9):i + 1]; good = [v for v in window if v is not None]
                    self.assertEqual(actual['samples'], len(window))
                    self.assertEqual(actual['received'], len(good))
                    self.assertEqual(actual['last_ping'], window[-1])
                    self.assertEqual(actual['loss'], round(100 * (len(window) - len(good)) / len(window), 1))
                    mad = sum(abs(v - sum(good) / len(good)) for v in good) / len(good) if good else None
                    self.assertEqual(actual['deviation'], round(mad, 2) if mad is not None else None)
                retained = [line.split('values=', 1)[1] for line in result.stderr.splitlines() if line.startswith('+ values=')]
                self.assertLessEqual(max(len(value.split()) for value in retained), 11)
                self.assertFalse(list(d.glob('result.json.*')))

    def test_daemon_isolated_execution(self):
        with tempfile.TemporaryDirectory() as td:
            d = pathlib.Path(td)
            (d / 'bin').mkdir()
            (d / 'bin/ping').write_text('#!/bin/sh\nprintf "round-trip min/avg/max = 10.000/10.000/10.000 ms\\n"\n')
            (d / 'bin/sleep').write_text('#!/bin/sh\nkill -TERM "$PPID"\n')
            for p in (d / 'bin').iterdir():
                p.chmod(0o755)
            s = isolated_source(d)
            (d / 'daemon').write_text(s)
            subprocess.run(['busybox', 'ash', str(d / 'daemon'), 'example.com'],
                           env=dict(os.environ, PATH=str(d / 'bin') + ':' + os.environ['PATH']),
                           timeout=5, check=True)
            data = json.loads((d / 'result.json').read_text())
            self.assertEqual(data['deviation'], 0)
            self.assertEqual(data['loss'], 0)
            self.assertEqual(data['samples'], 1)
            self.assertFalse(list(d.glob('result.json.*')))


if __name__ == '__main__':
    unittest.main()
