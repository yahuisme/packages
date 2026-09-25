"""Native libuci CLI adapter, not the host's unavailable ucode UCI module.

All config, delta and override paths are private. CLI calls save deltas between
processes; unlike an in-memory cursor, aborted deltas survive only in the test's
TemporaryDirectory. Tests inspect committed bytes, never reuse failed cursors.
Run with /opt/test-tools/env.sh sourced (or UCI_BIN/UCI_LIBRARY overrides).
"""
import ctypes
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys


def bridge(root, args):
    op, *args = args
    with (root / 'calls.jsonl').open('a') as stream:
        stream.write(json.dumps([op, *args]) + '\n')
    fault = json.loads((root / 'fault.json').read_text())
    if fault and [op, *args][:len(fault)] == fault:
        return None
    command = [os.environ.get('UCI_BIN', shutil.which('uci') or 'uci'),
               '-c', str(root / 'config'), '-C', str(root / 'override'),
               '-t', str(root / 'saved'), '-X']

    def run(*argv):
        return subprocess.run(command + list(argv), capture_output=True, text=True, check=False)

    def sections():
        result = {}
        response = run('show', 'homeproxy')
        if response.returncode:
            raise RuntimeError(response.stderr)
        for line in response.stdout.splitlines():
            key, value = line.split('=', 1)
            parts, values = key.split('.')[1:], shlex.split(value)
            if len(parts) == 1:
                result[parts[0]] = {'.name': parts[0], '.type': values[0]}
            else:
                result[parts[0]][parts[1]] = values[0] if len(values) == 1 else values
        return result

    if op == 'all':
        return list(sections().values())
    if op == 'get':
        section = sections().get(args[1], {})
        return section.get(args[2] if len(args) > 2 else '.type')
    if op == 'get_first':
        return next((n for n, s in sections().items() if s['.type'] == args[1]), None)
    if op == 'changes':
        return {'pending': True} if run('changes', 'homeproxy').stdout else {}
    if op == 'commit':
        return run('commit', args[0]).returncode == 0
    if op == 'delete':
        return run('delete', '.'.join(args)).returncode == 0
    if op != 'set':
        raise ValueError(op)
    if len(args) == 3:
        return run('set', '.'.join(args[:2]) + '=' + args[2]).returncode == 0
    if args[3] is None:
        # Exercise libuci's real NULL contract; the CLI cannot express NULL.
        lib = ctypes.CDLL(os.environ.get('UCI_LIBRARY', 'libuci.so'))

        class Pointer(ctypes.Structure):
            _fields_ = [('target', ctypes.c_int), ('flags', ctypes.c_int)] + [
                (n, ctypes.c_void_p) for n in ('p', 's', 'o', 'last')] + [
                (n, ctypes.c_char_p) for n in ('package', 'section', 'option', 'value')]

        lib.uci_alloc_context.restype = ctypes.c_void_p
        lib.uci_free_context.argtypes = [ctypes.c_void_p]
        lib.uci_lookup_ptr.argtypes = [ctypes.c_void_p, ctypes.POINTER(Pointer), ctypes.c_char_p, ctypes.c_bool]
        lib.uci_set.argtypes = [ctypes.c_void_p, ctypes.POINTER(Pointer)]
        context = lib.uci_alloc_context()
        try:
            for name, part in [('confdir', 'config'), ('conf2dir', 'override'), ('savedir', 'saved')]:
                setter = getattr(lib, 'uci_set_' + name)
                setter.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
                setter(context, str(root / part).encode())
            pointer = Pointer()
            key = ctypes.create_string_buffer('.'.join(args[:3]).encode())
            status = lib.uci_lookup_ptr(context, ctypes.byref(pointer), key, True)
            return status == 0 and lib.uci_set(context, ctypes.byref(pointer)) == 0
        finally:
            lib.uci_free_context(context)
    if isinstance(args[3], list):
        if run('get', '.'.join(args[:3])).returncode == 0:
            if run('delete', '.'.join(args[:3])).returncode:
                return False
        return all(run('add_list', '.'.join(args[:3]) + '=' + str(v)).returncode == 0 for v in args[3])
    return run('set', '.'.join(args[:3]) + '=' + str(args[3])).returncode == 0


if __name__ == '__main__':
    result = bridge(Path(sys.argv[1]), json.loads(sys.argv[2]))
    # ucode's cursor methods return true on success, null on UCI errors.
    print(json.dumps(None if result is False else result))
