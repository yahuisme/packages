"""Native ucode certificate RPC with private real files and command faults."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[1]
PEM = '-----BEGIN CERTIFICATE-----\nYQ==\n-----END CERTIFICATE-----\n'


class CertificateCleanup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hp-cert-cleanup-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.upload = self.root / 'upload.tmp'
        self.upload.write_text(PEM)

    def invoke(self, fault='', filename='client_ca'):
        rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
        helper = (APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
        quote = helper[helper.index('export function shellQuote'):helper.index('export function isBinary')]
        binary = helper[helper.index('export function isBinary'):helper.index('export function getTime')]
        cert = rpc[rpc.index('\tcertificate_write: {'):rpc.index('\n\tconnection_check: {')]
        cert = cert.replace("'/tmp/homeproxy_certificate.tmp'", json.dumps(str(self.upload))).rstrip().rstrip(',')
        pre = '''import {lstat,readfile as rr,writefile as rw,popen} from 'fs';
const HP_DIR=%s, FAULT=%s;
function readfile(p){if(FAULT==='read')return null;return rr(p);}
function writefile(p,c){if(FAULT==='short')return rw(p,substr(c,0,4));return rw(p,c);}
function system(s){
 if(FAULT==='cleanup' && index(s,'/bin/rm')===0)return 1;
 if(FAULT==='mv' && index(s,'/bin/mv')===0)return 1;
 if(FAULT==='chmod' && index(s,'/bin/chmod')===0)return 1;
 const fd=popen(s,'r');fd.read('all');return fd.close();
}
''' % (json.dumps(str(self.root)), json.dumps(fault))
        script = self.root / 'case.uc'
        script.write_text(pre + (quote + binary).replace('export function', 'function') +
                          'const methods={' + cert + '};\nprint(sprintf("%J", methods.certificate_write.call({args:{filename:' + json.dumps(filename) + '}})));')
        result = subprocess.run(['ucode', '-L', os.environ.get('UCODE_LIB_DIR', '/opt/test-tools/ucode/build'), str(script)],
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def test_cleanup_failure_cannot_report_success(self):
        result = self.invoke('cleanup')
        self.assertFalse(result['result'])
        self.assertTrue(self.upload.exists())
        self.assertEqual(self.invoke()['result'], True)
        self.assertFalse(self.upload.exists())

    def test_illegal_filename_cleans_only_fixed_upload(self):
        unrelated = self.root / 'unrelated.pem'
        unrelated.write_text('KEEP')
        result = self.invoke(filename='../unrelated')
        self.assertFalse(result['result'])
        self.assertEqual(result['error'], 'illegal certificate filename')
        self.assertFalse(self.upload.exists())
        self.assertEqual(unrelated.read_text(), 'KEEP')

    def test_validation_failures_remove_upload(self):
        for payload, error in [('', 'empty certificate file'), ('broken', 'this does not look like a correct PEM file'),
                               ('a\x00b', 'illegal file type: binary')]:
            with self.subTest(error=error):
                self.upload.write_text(payload)
                result = self.invoke()
                self.assertFalse(result['result'])
                self.assertEqual(result['error'], error)
                self.assertFalse(self.upload.exists())

    def test_write_install_and_protection_failure_cleanup(self):
        cert = self.root / 'certs/client_ca.pem'
        cert.parent.mkdir()
        cert.write_text('OLD CERT')
        for fault in ['short', 'mv', 'chmod']:
            with self.subTest(fault=fault):
                self.upload.write_text(PEM)
                self.assertFalse(self.invoke(fault)['result'])
                self.assertFalse(self.upload.exists())
                self.assertFalse((cert.parent / 'client_ca.pem.new').exists())
                self.assertEqual(cert.read_text(), 'OLD CERT')

    def test_certificates_private_key_and_ech_protocol_unchanged(self):
        for filename, label, mode in [('client_ca', 'CERTIFICATE', 0o644),
                                      ('server_publickey', 'CERTIFICATE', 0o644),
                                      ('client_ech_conf', 'ECH CONFIGS', 0o644),
                                      ('server_privatekey', 'PRIVATE KEY', 0o600)]:
            with self.subTest(filename=filename):
                payload = PEM.replace('CERTIFICATE', label)
                self.upload.write_text(payload.replace('\n', '\r\n'))
                self.assertTrue(self.invoke(filename=filename)['result'])
                cert = self.root / f'certs/{filename}.pem'
                self.assertEqual(cert.read_text(), payload)
                self.assertEqual(cert.stat().st_mode & 0o777, mode)
                self.assertFalse(self.upload.exists())
        self.upload.write_text(PEM * 2)
        self.assertTrue(self.invoke()['result'])

    def test_symlink_upload_is_unlinked_without_touching_target(self):
        target = self.root / 'target'
        target.write_text('KEEP')
        self.upload.unlink()
        self.upload.symlink_to(target)
        self.assertFalse(self.invoke()['result'])
        self.assertFalse(self.upload.is_symlink())
        self.assertEqual(target.read_text(), 'KEEP')

    def test_read_failure_removes_upload(self):
        self.assertFalse(self.invoke('read')['result'])
        self.assertFalse(self.upload.exists())


if __name__ == '__main__':
    unittest.main()
