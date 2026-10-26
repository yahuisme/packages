#!/usr/bin/env python3
"""Stage checksum-pinned prebuilt OpenWrt tools; never install or start services."""
import argparse
import hashlib
import os
from pathlib import Path
import platform
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

VERSION = '24.10.4'
IMAGES = {
    'x86_64': ('x86/64', 'x86-64', 'e7f8ab84eef55c7eb23492de7b0517dbc23fbedaa4abbb680fe64720c309dc03'),
    'aarch64': ('armsr/armv8', 'armsr-armv8', 'b9e784570872f0c3875d75c54eba842fa6f8a9fb2503897080db240fff6431a3'),
}
WHEEL = ('https://files.pythonhosted.org/packages/d9/5e/813b8aa30445ecffeeba355276d962064abbdf89cbd3db46aa15cec70bb4/po2lmo-1.0.0-py3-none-any.whl',
         '80e4d7c8cf397892f4815b31ad2907917c0bb3063134d1e984e0c723352924c0')


def download(url, digest, target):
    if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        urllib.request.urlretrieve(url, target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        raise RuntimeError('SHA256 mismatch: ' + url)


def executable(path, text):
    path.write_text('#!/bin/sh\n' + text + '\n')
    path.chmod(0o755)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', required=True, type=Path)
    args = parser.parse_args()
    dest = args.dest.resolve()
    dest.mkdir(parents=True, exist_ok=True)
    target, image, digest = IMAGES[platform.machine()]
    archive = dest / 'rootfs.tar.gz'
    download(f'https://downloads.openwrt.org/releases/{VERSION}/targets/{target}/openwrt-{VERSION}-{image}-rootfs.tar.gz', digest, archive)
    runtime = dest / 'runtime'
    runtime.mkdir(exist_ok=True)
    with tarfile.open(archive) as tar:
        # Only libraries, binaries and the sourced jshn library. No init/config,
        # devices, ownership changes, package installation or rootfs execution.
        for member in tar:
            name = member.name.removeprefix('./')
            if (name.startswith(('lib/', 'usr/lib/')) and (member.isfile() or member.issym())) or name in (
                    'bin/busybox', 'sbin/uci', 'usr/bin/ucode', 'usr/bin/jshn',
                    'usr/bin/jsonfilter', 'usr/share/libubox/jshn.sh'):
                member.name = name
                tar.extract(member, runtime, filter='data')
    bindir = dest / 'bin'
    bindir.mkdir(exist_ok=True)
    (dest / 'lib').mkdir(exist_ok=True)  # Fixtures set LD_LIBRARY_PATH here.
    share = dest / 'share/libubox'
    share.mkdir(parents=True, exist_ok=True)
    (share / 'jshn.sh').write_bytes((runtime / 'usr/share/libubox/jshn.sh').read_bytes())
    quote = lambda p: shlex.quote(str(p))
    loader = runtime / 'lib/libc.so'
    libraries = str(runtime / 'lib') + ':' + str(runtime / 'usr/lib')
    for name, binary in [('uci', 'sbin/uci'), ('ucode', 'usr/bin/ucode'),
                         ('jshn', 'usr/bin/jshn'), ('jsonfilter', 'usr/bin/jsonfilter')]:
        extra = (' -L ' + quote(runtime / 'usr/lib/ucode/*.so')) if name == 'ucode' else ''
        executable(bindir / name, 'exec ' + quote(loader) + ' --library-path ' +
                   shlex.quote(libraries) + ' ' + quote(runtime / binary) + extra + ' "$@"')
    # OpenWrt's reduced busybox omits --list, which these fixtures require.
    arch, busybox_hash = {
        'aarch64': ('arm64', 'a745b681c0c52e4e0f028e0dab7b85078de1199c1d86c7b4c12502061c24f297'),
        'x86_64': ('amd64', '4b355fad07d4fe1f5aa282e949281f8dcb7bcdebb023d7e40f4f8fe475e21e29'),
    }[platform.machine()]
    deb = dest / f'busybox_1.35.0-4+deb12u1+b1_{arch}.deb'
    download('https://deb.debian.org/debian/pool/main/b/busybox/' + deb.name,
             busybox_hash, deb)
    subprocess.run(['dpkg-deb', '-x', str(deb), str(dest / 'debian')], check=True)
    shutil.copy2(dest / 'debian/bin/busybox', bindir / 'busybox')
    (bindir / 'jsonpath').unlink(missing_ok=True)
    (bindir / 'jsonpath').symlink_to('jsonfilter')
    # Pure-Python wheel: no compiler and no mutable global pip installation.
    wheel = dest / 'po2lmo-1.0.0-py3-none-any.whl'
    download(*WHEEL, wheel)
    pythonlib = dest / 'python'
    with zipfile.ZipFile(wheel) as z:
        z.extractall(pythonlib)
    executable(bindir / 'po2lmo', 'PYTHONPATH=' + quote(pythonlib) +
               ' exec python3 -m po2lmo.cli "$@"')
    env = dict(os.environ, PATH=str(bindir) + ':' + os.environ['PATH'])
    subprocess.run([str(bindir / 'ucode'), '-e',
                    "import * as fs from 'fs'; import * as uci from 'uci'; print('ucode fs/uci OK\\n');"], check=True, env=env)
    subprocess.run([str(bindir / 'busybox'), 'ash', '-c',
                    '. "$1"; json_load \'{"ready":true}\'; json_get_var ready ready; [ "$ready" = 1 ]',
                    'probe', str(share / 'jshn.sh')], check=True, env=env)
    with tempfile.TemporaryDirectory(dir=dest) as td:
        (Path(td) / 'probe').write_text("config ready 'fixture'\n option value '1'\n")
        subprocess.run([str(bindir / 'uci'), '-c', td, '-C', td, '-t', td,
                        'get', 'probe.fixture.value'], check=True, env=env)
    exports = {'OPENWRT_TOOLS': str(dest), 'UCODE_LIB_DIR': str(runtime / 'usr/lib/ucode'),
               'PO2LMO': str(bindir / 'po2lmo'), 'REAL_UCI': str(bindir / 'uci'),
               'UCI_BIN': str(bindir / 'uci')}
    (dest / 'env.sh').write_text('\n'.join('export ' + key + '=' + shlex.quote(value)
                                         for key, value in exports.items()) +
                               '\nexport PATH=' + quote(bindir) + ':"$PATH"\n')
    print(f'Verified OpenWrt {VERSION} {platform.machine()} runtime at {dest}')


if __name__ == '__main__':
    main()
