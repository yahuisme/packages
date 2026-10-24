"""Download failure/size regressions: real ash, private curl boundary or HTTP.

No proxy or host service is started. Integration uses real curl/ucode/unzip;
only the HomeProxy init boundary is simulated, with all paths private.
"""
import http.server
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import threading
import unittest
import zipfile


APP = Path(__file__).resolve().parents[1]
UPDATER = APP / 'root/etc/homeproxy/scripts/update_resources.sh'


class ResourceDownloads(unittest.TestCase):
    def test_download_preserves_transport_failure_and_size_limit(self):
        source = UPDATER.read_text()
        download = source[source.index('download() {'):source.index('\nfetch_sha() {')]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            curl = root / 'curl'
            curl.write_text('''#!/bin/sh
while [ "$1" != -o ]; do shift; done
printf '%s' "$BODY" > "$2"
exit "$CURL_STATUS"
''')
            curl.chmod(0o755)
            script = root / 'download.sh'
            script.write_text(download.replace('/usr/bin/curl', shlex.quote(str(curl))) +
                              '\ndownload fixture "$1"\n')
            target = root / 'download'
            for proxy in ['', 'http://127.0.0.1:12345']:
                for status, body, success in [(0, 'valid', True), (18, 'valid', False),
                                               (22, 'valid', False), (28, 'valid', False),
                                               (0, '', False), (0, 'x' * 16, True),
                                               (0, 'x' * 17, False), (63, 'x' * 17, False)]:
                    with self.subTest(proxy=bool(proxy), status=status, size=len(body)):
                        env = dict(os.environ, UPDATE_PROXY=proxy, DOWNLOAD_MAX_BYTES='16',
                                   BODY=body, CURL_STATUS=str(status))
                        result = subprocess.run(['busybox', 'ash', str(script), str(target)],
                                                env=env, capture_output=True, text=True,
                                                timeout=10)
                        self.assertEqual(result.returncode == 0, success, result.stderr)
                        if status == 0 and len(body) > 16:
                            self.assertFalse(target.exists(), 'oversized body must be removed')

    def test_failed_http_transfer_never_installs_valid_dashboard_zip(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as data:
            data.writestr('site/index.html', 'new dashboard')
        metadata = json.dumps({'sha': 'a' * 40, 'commit': {
            'committer': {'date': '2024-02-03T04:05:06Z'}}}).encode()

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = metadata if self.path == '/version' else archive.getvalue()
                self.send_response(200)
                # Valid ZIP bytes remain on disk, but curl correctly returns 18.
                self.send_header('Content-Length', str(len(body) +
                                                       (0 if self.path == '/version' else 7)))
                self.end_headers()
                self.wfile.write(body)
                self.wfile.flush()
                self.close_connection = True

            def log_message(self, format, *args):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                dashboard = root / 'dashboard'
                dashboard.mkdir()
                (dashboard / 'index.html').write_text('old dashboard')
                (dashboard / 'dashboard.ver').write_text('old version')
                init = root / 'init'
                init.write_text('#!/bin/sh\nexit 1\n')
                init.chmod(0o755)
                url = f'http://127.0.0.1:{server.server_port}'
                env = dict(os.environ, RESOURCES_DIR=str(root / 'resources'),
                           DASHBOARD_DIR=str(dashboard), RUN_DIR=str(root / 'run'),
                           HOMEPROXY_INIT=str(init), HOMEPROXY_UPDATE_PROXY='',
                           HOMEPROXY_DOWNLOAD_MAX_BYTES='16777216',
                           DASHBOARD_SOURCE=url + '/zip', DASHBOARD_VERSION_URL=url + '/version')
                result = subprocess.run(['busybox', 'ash', str(UPDATER), 'dashboard-update'],
                                        env=env, capture_output=True, text=True, timeout=30)
                self.assertIn('curl: (18)', result.stderr)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual((dashboard / 'index.html').read_text(), 'old dashboard')
                self.assertEqual((dashboard / 'dashboard.ver').read_text(), 'old version')
                status = (root / 'run/dashboard.result').read_text()
                self.assertIn('status=1\n', status)
                self.assertIn('dashboard_updated=0\n', status)
                self.assertIn('dashboard=1\n', status)
                self.assertFalse(list(root.glob('dashboard.old.*')))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
