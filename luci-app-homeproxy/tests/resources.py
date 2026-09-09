#!/usr/bin/env python3
"""Offline execution of the actual updater with transport/core-check fixture binaries."""
import os, pathlib, subprocess, tempfile, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'root/etc/homeproxy/scripts/update_resources.sh').read_text()
with tempfile.TemporaryDirectory() as temp:
    base = pathlib.Path(temp)
    for name in ['run', 'resources', 'dashboard', 'bin', 'input']:
        (base / name).mkdir()
    (base/'dashboard/index.html').write_text('OLD')
    (base/'dashboard/dashboard.ver').write_text('old')
    (base/'input/geoip.srs').write_bytes(b'SRS\x01geoip_fixture')
    (base/'input/geosite.srs').write_bytes(b'SRS\x01fixture')
    with zipfile.ZipFile(base/'input/dashboard.zip', 'w') as z:
        z.writestr('dashboard/index.html', 'NEW')
    curl = base/'bin/curl'
    curl.write_text('''#!/usr/bin/env python3
import sys,os,shutil
from pathlib import Path
a=sys.argv[1:]; b=Path(os.environ['FIXTURE'])
if '-w' in a: print('https://fixture/20260908',end=''); sys.exit(0)
if a[-1].endswith('atom'): print('<updated>2026-09-08T00:00:00Z</updated>'); sys.exit(0)
f='geoip.srs' if 'sing-geoip' in a[-1] else ('dashboard.zip' if 'zip' in a[-1] else 'geosite.srs')
shutil.copyfile(b/'input'/f,a[a.index('-o')+1])
''')
    curl.chmod(0o755)
    mv = base/'bin/mv'
    mv.write_text('''#!/bin/sh
case "$*" in
*dashboard.new*) [ "$FAIL_INSTALL" != 1 ] || exit 1 ;;
esac
exec /bin/mv "$@"
'''); mv.chmod(0o755)
    check = base/'bin/sing-box'
    check.write_text('#!/bin/sh\nexit 0\n'); check.chmod(0o755)
    script=base/'updater.sh'
    script.write_text(SOURCE.replace('/usr/bin/curl',str(curl)))
    env=dict(os.environ, FIXTURE=str(base), RUN_DIR=str(base/'run'),
             RESOURCES_DIR=str(base/'resources'), DASHBOARD_DIR=str(base/'dashboard'),
             PATH=str(base/'bin')+':'+os.environ['PATH'], FAIL_INSTALL='1')
    result=subprocess.run(['sh',str(script)],env=env,capture_output=True,text=True)
    assert (base/'dashboard/index.html').exists(), 'failed replacement destroyed old dashboard'
    assert (base/'dashboard/index.html').read_text()=='OLD'
    assert result.returncode in [1,4], (result.returncode,result.stderr)
    env['FAIL_INSTALL']='0'
    result=subprocess.run(['sh',str(script)],env=env,capture_output=True,text=True)
    assert result.returncode==0,(result.returncode,result.stderr)
    assert (base/'dashboard/index.html').read_text()=='NEW'
    assert (base/'resources/geoip_cn.srs').read_bytes()==b'SRS\x01geoip_fixture'
    print('PASS updater: failed dashboard install preserves old directory; successful group install')
