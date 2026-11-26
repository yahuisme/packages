#!/usr/bin/env python3
"""Update public resources and the latest official stable sing-box.
No host service starts. Downloads/checks finish before publishing local files.
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
import sys
import tarfile
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
SOURCES = [('geoip', 'sing-geoip', 'rule-set'),
           ('geosite', 'sing-geosite', 'rule-set-unstable')]
CURL = ('curl', '-fsSL', '--retry', '3', '--connect-timeout', '10', '--max-time', '180')


def stable_version(release):
    tag = release.get('tag_name', '')
    if release.get('draft') is not False or release.get('prerelease') is not False or not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag):
        raise ValueError('Not an official stable release')
    return tag[1:]


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', 'repos/SagerNet/' + path]))


def download(url):
    return subprocess.check_output([*CURL, url])


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
    name = f'sing-box-{version}-linux-{arch}'
    archive_path = temp / (name + '.tar.gz')
    asset = next(a for a in release['assets'] if a['name'] == archive_path.name)
    subprocess.run([*CURL, '--output', str(archive_path), asset['browser_download_url']], check=True)
    with archive_path.open('rb') as compressed:
        digest = hashlib.file_digest(compressed, 'sha256').hexdigest()
    if asset.get('digest') != 'sha256:' + digest:
        raise ValueError('Official binary digest mismatch/missing')
    binary = temp/'sing-box'
    with tarfile.open(archive_path, mode='r|gz') as archive:
        for member in archive:
            if member.name == f'{name}/sing-box' and member.isfile():
                stream = archive.extractfile(member)
                if stream is not None:
                    with stream, binary.open('wb') as target:
                        shutil.copyfileobj(stream, target)
                    break
        else:
            raise ValueError('Missing sing-box binary')
    archive_path.unlink()
    binary.chmod(0o755)
    actual = subprocess.check_output([str(binary), 'version'], text=True, timeout=10)
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


def resource_updates(installed):
    updates = []
    for kind, repo, branch in SOURCES:
        sha, version = version_metadata(repo, branch)
        name = f'{kind}-cn.srs'
        digest = api(f'{repo}/contents/{name}?ref={sha}')['sha']
        if not re.fullmatch('[0-9a-f]{40}', digest):
            raise ValueError('Invalid SRS Git blob identity')
        try:
            current_version = (installed/f'{kind}_cn.ver').read_bytes()
            current_data = (installed/f'{kind}_cn.srs').read_bytes()
            current_digest = blob(current_data) if current_data else None
        except FileNotFoundError:
            current_version, current_digest = None, None
        if current_version != version.encode() or current_digest != digest:
            updates.append((kind, version, digest, f'https://raw.githubusercontent.com/SagerNet/{repo}/{sha}/{name}'))
        print(f'{kind}: {version.strip()}', flush=True)
    return updates


def resources(home, binary, temp, updates):
    for kind, version, digest, url in updates:
        binary_path = home/'resources'/f'{kind}_cn.srs'
        # A metadata-only change need not retrieve identical SRS bytes again.
        data = binary_path.read_bytes() if binary_path.is_file() else b''
        if blob(data) != digest or not data:
            data = download(url)
        if not data or digest != blob(data):
            raise ValueError('SRS Git blob mismatch')
        binary_path.write_bytes(data)
        (home/'resources'/f'{kind}_cn.ver').write_text(version)
    check(binary, home, temp)


def core_compatibility(binary, version, root, temp, *, resources_dir):
    # Only core-version changes pay for the native generator/runtime gates.
    # Keep the verified candidate alive until they finish, before publication.
    tools = temp/'tools'
    env = dict(os.environ, TMPDIR=str(temp), PYTHONDONTWRITEBYTECODE='1')
    subprocess.run([sys.executable, str(root/'.github/scripts/setup-test-tools.py'),
                    '--dest', str(tools)], env=env, check=True)
    subprocess.run(['sh', '-ec', '. "$1"; exec "$2" "$3" --binary "$4" --version "$5" --resources "$6"',
                    'core-compatibility', str(tools/'env.sh'), sys.executable,
                    str(root/'.github/scripts/check-core-compatibility.py'), str(binary), version, str(resources_dir)],
                   env=env, check=True)


def remove_completed(path):
    if path.is_symlink():
        raise RuntimeError(f'Invalid completed backup: {path}')
    if path.is_dir():
        shutil.rmtree(path)
    elif path.is_file():
        path.unlink()
    elif path.exists():
        raise RuntimeError(f'Invalid completed backup: {path}')


def prepare_publication(targets):
    # Check every recovery target before cleaning anything or installing new bytes.
    targets = list(targets)
    for target in targets:
        backup = target.with_name(target.name + '.update-backup')
        if backup.exists() or backup.is_symlink():
            raise RuntimeError(f'Recovery backup exists: {backup}')
    for target in targets:
        complete = target.with_name(target.name + '.update-complete')
        if complete.exists() and (not target.exists() or target.is_symlink()):
            raise RuntimeError(f'Published target is unavailable: {target}')
        remove_completed(complete)


def publish(pairs):
    """Retain recovery backups; only completed publications may be cleaned on retry."""
    pairs = list(pairs)
    prepare_publication(target for _, target in pairs)
    installed = []
    try:
        for staged, target in pairs:
            backup = target.with_name(target.name + '.update-backup')
            target.rename(backup)
            installed.append((target, backup))
            staged.rename(target)
    except BaseException as error:
        for target, backup in reversed(installed):
            try:
                if target.is_dir():
                    shutil.rmtree(target)
                elif target.exists():
                    target.unlink()
                backup.rename(target)
            except OSError as recovery_error:
                error.add_note(f'Recovery failed for {target}; retain {backup}: {recovery_error}')
        raise
    # A distinct name is the durable completion state. Partial delete failures
    # can be retried without ever treating an unresolved rollback as disposable.
    completed = []
    for target, backup in installed:
        complete = target.with_name(target.name + '.update-complete')
        backup.rename(complete)
        completed.append(complete)
    for complete in completed:
        remove_completed(complete)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    makefile = root/'sing-box/Makefile'
    readme = root/'README.md'
    target = root/'luci-app-homeproxy/root/etc/homeproxy'
    # A prior core update can have completed even if its version is unchanged
    # now; recover every target before deciding which ones need publication.
    prepare_publication([target/'resources', makefile, readme])
    original = makefile.read_text()
    version_match = re.search(r'^PKG_UPSTREAM_VERSION:=(.+)$', original, re.M)
    hash_match = re.search(r'^PKG_HASH:=([0-9a-f]{64})$', original, re.M)
    if not version_match or not hash_match:
        raise ValueError('Invalid current sing-box recipe version or hash')
    current = version_match[1]
    latest = api('sing-box/releases/latest')
    version = stable_version(latest)
    source = download(f'https://codeload.github.com/SagerNet/sing-box/tar.gz/v{version}')
    digest = hashlib.sha256(source).hexdigest()
    if version == current and digest != hash_match[1]:
        raise ValueError('Current sing-box source hash mismatch')
    if version != current:
        with tarfile.open(fileobj=io.BytesIO(source), mode='r:gz') as archive:
            archive.getmembers()
    del source
    print(f'sing-box source SHA256: {digest}', flush=True)
    updates = resource_updates(target/'resources')
    if version == current and not updates:
        print('Core and both resource blobs are current.', flush=True)
        return
    # Temporary files share the target filesystem; no binary/config survives exit.
    with tempfile.TemporaryDirectory(prefix='.homeproxy-update-', dir=root) as directory:
        temp = Path(directory)
        binary = get_binary(latest, temp)
        home = temp/'homeproxy'
        shutil.copytree(target/'resources', home/'resources')
        resources(home, binary, temp, updates)
        pairs = [(home/'resources', target/'resources')] if updates else []
        if version != current:
            documentation, count = re.subn(r'^(\| `sing-box` \| )`[^`]+`( \|.*)$',
                                          lambda match: match[1] + f'`{version}`' + match[2],
                                          readme.read_text(), flags=re.M)
            if count != 1:
                raise ValueError('Expected exactly one sing-box README version row')
            core_compatibility(binary, version, root, temp, resources_dir=home/'resources')
            updated = re.sub(r'^PKG_UPSTREAM_VERSION:=.*$', f'PKG_UPSTREAM_VERSION:={version}', original, flags=re.M)
            updated = re.sub(r'^PKG_HASH:=.*$', f'PKG_HASH:={digest}', updated, flags=re.M)
            updated = re.sub(r'^PKG_RELEASE:=.*$', 'PKG_RELEASE:=', updated, flags=re.M)
            staged = temp/'Makefile'
            staged.write_text(updated)
            staged.chmod(makefile.stat().st_mode & 0o777)
            pairs.append((staged, makefile))
            staged_readme = temp/'README.md'
            staged_readme.write_text(documentation)
            staged_readme.chmod(readme.stat().st_mode & 0o777)
            pairs.append((staged_readme, readme))
        publish(pairs)
    print('Resources validated and published; no host service started.', flush=True)


if __name__ == '__main__':
    main()
