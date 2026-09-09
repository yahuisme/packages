"""Execute runtime updater against local HTTP fixtures and real ucode hashing.
No proxy starts; the SRS decoder/init boundary is stubbed in this focused test.
"""
import hashlib
import http.server
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import io
import zipfile

APP = Path(__file__).resolve().parents[1]

class Versions(unittest.TestCase):
    def test_update_migration_digest_failure_and_rollback(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            sha = 'a' * 40
            data = b'SRS\x01fixture'
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            metadata = {'sha': sha, 'commit': {'committer': {'date': '2024-02-03T04:05:06Z'}}}
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('dashboard/index.html', 'fixture dashboard')
            paths = []
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    paths.append(self.path)
                    if self.path.endswith('/version'):
                        body = json.dumps(metadata).encode()
                    elif '/digest?' in self.path:
                        body = json.dumps({'sha': blob}).encode()
                    elif self.path.endswith('.srs'):
                        body = data
                    else:
                        body = archive.getvalue()
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(body)
                def log_message(self, format, *args):
                    pass
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f'http://127.0.0.1:{server.server_port}'
                resources, dashboard = base/'resources', base/'dashboard'
                resources.mkdir(); dashboard.mkdir()
                (resources/'direct_list.txt').write_text('user.example\n')
                (resources/'diversion').mkdir()
                (resources/'diversion/orphan.txt').write_text('disabled-or-orphan.example\n')
                for kind in ['geoip', 'geosite']:
                    (resources/f'{kind}_cn.ver').write_text(sha+'\n')
                    (resources/f'{kind}_cn.srs').write_bytes(data)
                (dashboard/'dashboard.ver').write_text('20240203040506\n')
                (dashboard/'index.html').write_text('old')
                stub = base/'stub'
                stub.write_text('#!/bin/sh\nexit 0\n'); stub.chmod(0o755)
                env = dict(os.environ, RESOURCES_DIR=str(resources), DASHBOARD_DIR=str(dashboard), RUN_DIR=str(base/'run'), SING_BOX=str(stub), HOMEPROXY_INIT=str(stub))
                # Optional host-only module search path; firmware has ucode-mod-digest.
                if os.environ.get('UCODE_LIB_DIR'):
                    wrapper = base/'ucode'
                    wrapper.write_text('#!/bin/sh\nexec /usr/local/bin/ucode -L "$UCODE_LIB_DIR" "$@"\n')
                    wrapper.chmod(0o755)
                    env['PATH'] = str(base)+':'+env['PATH']
                for kind in ['GEOIP', 'GEOSITE', 'DASHBOARD']:
                    env[kind+'_SOURCE'] = url+'/'+kind.lower()
                    env[kind+'_VERSION_URL'] = url+'/'+kind.lower()+'/version'
                    if kind!='DASHBOARD': env[kind+'_DIGEST_URL'] = url+'/'+kind.lower()+'/digest'
                def run(code):
                    result = subprocess.run(['busybox', 'ash', str(APP/'root/etc/homeproxy/scripts/update_resources.sh')], env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, code, result.stderr)
                    self.assertEqual((resources/'direct_list.txt').read_text(), 'user.example\n')
                    self.assertEqual((resources/'diversion/orphan.txt').read_text(), 'disabled-or-orphan.example\n')
                run(0)
                for p in [resources/'geoip_cn.ver', resources/'geosite_cn.ver', dashboard/'dashboard.ver']:
                    self.assertEqual(p.read_text(), '2024-02-03 '+sha+'\n')
                self.assertIn('/geoip/'+sha+'/geoip-cn.srs', paths)
                self.assertIn('/geoip/digest?ref='+sha, paths)
                run(3)
                before = (resources/'geoip_cn.ver').read_text()
                blob = 'b'*40
                run(1)
                self.assertEqual((resources/'geoip_cn.ver').read_text(), before)
                metadata['commit']['committer']['date'] = None
                run(1)
                self.assertEqual((resources/'geoip_cn.ver').read_text(), before)
                metadata['commit']['committer']['date'] = '2024-02-04T04:05:06Z'
                blob = hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
                stub.write_text('#!/bin/sh\n[ "$1" != reload ]\n')
                run(1)
                self.assertEqual((resources/'geoip_cn.ver').read_text(), before)
                self.assertEqual((dashboard/'dashboard.ver').read_text(), before)
            finally:
                server.shutdown(); server.server_close(); thread.join()

if __name__ == '__main__':
    unittest.main()
