#!/usr/bin/env python3
"""Update public resources and the latest official stable sing-box.
No service starts. All downloads/checks complete before publishing local files.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [('geoip', 'sing-geoip', 'rule-set'),
           ('geosite', 'sing-geosite', 'rule-set-unstable')]


def stable_version(release):
    tag = release.get('tag_name', '')
    if release.get('draft') is not False or release.get('prerelease') is not False or not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag):
        raise ValueError('Not an official stable release')
    return tag[1:]


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', 'repos/SagerNet/' + path]))


def download(url):
    return subprocess.check_output(['curl', '-fsSL', '--retry', '3', '--connect-timeout', '10', '--max-time', '180', url])


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def version_metadata(repo, branch):
    meta = api(f'{repo}/commits/{branch}')
    sha, date = meta['sha'], meta['commit']['committer']['date']
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Invalid commit')
    stamp = datetime.strptime(date, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).strftime('%Y%m%d%H%M%S')
    return sha, stamp + ' ' + sha + '\n'


def get_binary(release, temp):
    version = stable_version(release)
    arch = {'aarch64': 'arm64', 'x86_64': 'amd64'}[platform.machine()]
    name = f'sing-box-{version}-linux-{arch}.tar.gz'
    asset = next(a for a in release['assets'] if a['name'] == name)
    data = download(asset['browser_download_url'])
    if asset.get('digest') != 'sha256:' + hashlib.sha256(data).hexdigest():
        raise ValueError('Official binary digest mismatch/missing')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        stream = archive.extractfile(f'sing-box-{version}-linux-{arch}/sing-box')
        if stream is None:
            raise ValueError('Missing sing-box binary')
        binary = temp/'sing-box'
        binary.write_bytes(stream.read())
        binary.chmod(0o755)
    actual = subprocess.check_output([str(binary), 'version'], text=True)
    if actual.splitlines()[0] != f'sing-box version {version}':
        raise ValueError('Binary version mismatch')
    print(actual.splitlines()[0], flush=True)
    return binary


def check(binary, home, temp):
    for path in sorted((home/'resources').glob('*.srs')):
        subprocess.run([str(binary), 'rule-set', 'match', '-f', 'binary', str(path), '192.0.2.1'], check=True, stdout=subprocess.DEVNULL)
    # Offline schema smoke test; not a full device compatibility test.
    config = {'dns': {'servers': [{'type': 'udp', 'tag': 'direct-dns', 'server': '223.5.5.5'}]},
              'inbounds': [{'type': 'mixed', 'tag': 'mixed-in', 'listen': '127.0.0.1', 'listen_port': 5330}],
              'outbounds': [{'type': 'direct', 'tag': 'direct-out'}],
              'route': {'rule_set': [{'type': 'local', 'tag': k + '_cn', 'format': 'binary',
                                     'path': str(home/'resources'/f'{k}_cn.srs')} for k, _, _ in SOURCES],
                        'final': 'direct-out'}}
    path = temp/'check.json'
    path.write_text(json.dumps(config))
    subprocess.run([str(binary), 'check', '-c', str(path)], check=True)


def resources(home, binary, temp):
    for kind, repo, branch in SOURCES:
        sha, version = version_metadata(repo, branch)
        name = f'{kind}-cn.srs'
        metadata = api(f'{repo}/contents/{name}?ref={sha}')
        data = download(f'https://raw.githubusercontent.com/SagerNet/{repo}/{sha}/{name}')
        if metadata['sha'] != blob(data):
            raise ValueError('SRS Git blob mismatch')
        (home/'resources'/f'{kind}_cn.srs').write_bytes(data)
        (home/'resources'/f'{kind}_cn.ver').write_text(version)
        print(f'{kind}: {version.strip()}', flush=True)
    check(binary, home, temp)


def publish(pairs):
    """Rollback all installed targets on a rename failure; retain failed backups."""
    installed = []
    try:
        for staged, target in pairs:
            backup = target.with_name(target.name + '.update-backup')
            if backup.exists():
                raise RuntimeError(f'Recovery backup exists: {backup}')
            target.rename(backup)
            installed.append((target, backup))
            staged.rename(target)
    except BaseException:
        for target, backup in reversed(installed):
            if target.is_dir():
                shutil.rmtree(target)
            elif target.exists():
                target.unlink()
            backup.rename(target)
        raise
    for _, backup in installed:
        if backup.is_dir():
            shutil.rmtree(backup)
        else:
            backup.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    makefile = root/'sing-box/Makefile'
    original = makefile.read_text()
    current = re.search(r'^PKG_UPSTREAM_VERSION:=(.+)$', original, re.M).group(1)
    latest = api('sing-box/releases/latest')
    version = stable_version(latest)
    # Temporary files share the target filesystem; no binary/config survives exit.
    with tempfile.TemporaryDirectory(prefix='.homeproxy-update-', dir=root) as directory:
        temp = Path(directory)
        binary = get_binary(latest, temp)
        source = download(f'https://codeload.github.com/SagerNet/sing-box/tar.gz/v{version}')
        with tarfile.open(fileobj=io.BytesIO(source), mode='r:gz') as archive:
            archive.getmembers()
        digest = hashlib.sha256(source).hexdigest()
        if version == current and digest != re.search(r'^PKG_HASH:=(.+)$', original, re.M).group(1):
            raise ValueError('Current sing-box source hash mismatch')
        print(f'sing-box source SHA256: {digest}', flush=True)
        home = temp/'homeproxy'
        target = root/'luci-app-homeproxy/root/etc/homeproxy'
        shutil.copytree(target, home)
        resources(home, binary, temp)
        pairs = [(home/'resources', target/'resources')]
        if version != current:
            updated = re.sub(r'^PKG_UPSTREAM_VERSION:=.*$', f'PKG_UPSTREAM_VERSION:={version}', original, flags=re.M)
            updated = re.sub(r'^PKG_HASH:=.*$', f'PKG_HASH:={digest}', updated, flags=re.M)
            updated = re.sub(r'^PKG_RELEASE:=.*$', 'PKG_RELEASE:=', updated, flags=re.M)
            staged = temp/'Makefile'
            staged.write_text(updated)
            staged.chmod(makefile.stat().st_mode & 0o777)
            pairs.append((staged, makefile))
        publish(pairs)
    print('Resources validated and published; no service started.', flush=True)


if __name__ == '__main__':
    main()
