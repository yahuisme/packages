"""Real ash/ucode and HTTP archive fixtures; init boundary only is simulated."""
import http.server
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import zipfile

APP = Path(__file__).resolve().parents[1]

class Dashboard(unittest.TestCase):
    def test_independent_lifecycle(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dashboard = root/'dashboard'
            metadata = {'sha': 'a'*40, 'commit': {'committer': {'date': '2024-02-03T04:05:06Z'}}}
            def archive(content, name='site/index.html'):
                data = io.BytesIO()
                with zipfile.ZipFile(data, 'w') as z:
                    z.writestr(name, content)
                return data.getvalue()
            body = archive('first')
            requests = []
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    requests.append(self.path)
                    self.send_response(200); self.end_headers()
                    self.wfile.write(json.dumps(metadata).encode() if self.path == '/version' else body)
                def log_message(self, *args): pass
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                init = root/'init'
                init.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "$INIT_LOG"\n[ "$1" != reload ] || [ "$FAIL_RELOAD" != 1 ]\n'); init.chmod(0o755)
                url = f'http://127.0.0.1:{server.server_port}'
                env = dict(os.environ, RESOURCES_DIR=str(root/'resources'), DASHBOARD_DIR=str(dashboard), RUN_DIR=str(root/'run'), HOMEPROXY_INIT=str(init), DASHBOARD_SOURCE=url+'/zip', DASHBOARD_VERSION_URL=url+'/version', INIT_LOG=str(root/'init.log'))
                def run(action, code):
                    p = subprocess.run(['busybox', 'ash', str(APP/'root/etc/homeproxy/scripts/update_resources.sh'), 'dashboard-'+action], env=env, capture_output=True, text=True)
                    self.assertEqual(p.returncode, code, p.stderr)
                    self.assertFalse((root/'resources').exists(), 'dashboard must not touch rules')
                run('remove', 3)
                self.assertEqual(requests, [])
                run('update', 0)
                self.assertEqual((dashboard/'index.html').read_text(), 'first')
                self.assertEqual((dashboard/'dashboard.ver').read_text(), '20240203040506 '+'a'*40+'\n')
                self.assertIn('/zip/'+'a'*40, requests)
                run('update', 3)
                metadata['sha'] = 'b'*40
                body = archive('second')
                run('update', 0)
                self.assertEqual((dashboard/'index.html').read_text(), 'second')
                metadata['sha'] = 'c'*40
                body = b'broken zip'
                run('update', 1)
                self.assertEqual((dashboard/'index.html').read_text(), 'second')
                body = archive('escape', '../escape')
                run('update', 1)
                self.assertFalse((root/'escape').exists())
                body = archive('third')
                env['FAIL_RELOAD'] = '1'
                run('update', 1)
                self.assertEqual((dashboard/'index.html').read_text(), 'second')
                before = len(requests)
                run('remove', 1)
                self.assertEqual(len(requests), before)
                self.assertEqual((dashboard/'index.html').read_text(), 'second')
                self.assertIn('rollback_failed=1', (root/'run/dashboard.result').read_text())
                env['FAIL_RELOAD'] = '0'
                run('remove', 0)
                self.assertEqual(len(requests), before)
                self.assertFalse(dashboard.exists())
                run('remove', 3)
                env['FAIL_RELOAD'] = '1'
                run('update', 1)
                self.assertFalse(dashboard.exists(), 'failed first install restores absent state')
                env['FAIL_RELOAD'] = '0'
                run('update', 0)
                self.assertEqual((dashboard/'index.html').read_text(), 'third')
            finally:
                server.shutdown(); server.server_close(); thread.join()

if __name__ == '__main__': unittest.main()
