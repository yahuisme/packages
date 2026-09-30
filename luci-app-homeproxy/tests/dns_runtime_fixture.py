"""Private sing-box DNS integration worker. Never run on the host network.

Only the DNS section is production-generated; inbounds/outbounds, synthetic
geoip/geosite sets and responding upstreams are loopback-only test fixtures.
The official prebuilt core is supplied by the caller (no compilation/download).
"""
import json
import os
from pathlib import Path
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
from typing import cast

from test_dns_fallback import dns_config


def question_end(packet):
    pos = 12
    labels = []
    while packet[pos]:
        length = packet[pos]
        labels.append(packet[pos + 1:pos + 1 + length].decode())
        pos += length + 1
    return '.'.join(labels), pos + 5


class Upstream(socketserver.ThreadingUDPServer):
    daemon_threads = True

    def __init__(self, port, tag):
        self.tag, self.calls = tag, []
        super().__init__(('127.0.0.1', port), Answer)


class Answer(socketserver.BaseRequestHandler):
    def handle(self):
        server = cast(Upstream, self.server)
        packet, sock = self.request
        name, end = question_end(packet)
        server.calls.append(name)
        address = {'main': '203.0.113.20', 'china': '192.0.2.20', 'default': '192.0.2.30'}[server.tag]
        if server.tag == 'main':
            if name.startswith('timeout.'):
                return
            if name.startswith('delayed.'):
                time.sleep(0.45)
            if name.startswith('late.'):
                time.sleep(3.7)
            if name.startswith('mainland.') or name.endswith('proxy.test'):
                address = '1.0.1.20'
        response = (packet[:2] + struct.pack('!HHHHH', 0x8180, 1, 1, 0, 0) + packet[12:end]
                    + b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 60, 4) + socket.inet_aton(address))
        sock.sendto(response, self.client_address)


def query(name, core, servers):
    before = {s.tag: len(s.calls) for s in servers}
    wire = b''.join(bytes([len(p)]) + p.encode() for p in name.split('.')) + b'\0'
    packet = struct.pack('!HHHHHH', 31415, 0x100, 1, 0, 0, 0) + wire + struct.pack('!HH', 1, 1)
    start = time.monotonic()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(7)
        sock.sendto(packet, ('127.0.0.1', 15300))
        response = sock.recv(4096)
    elapsed = time.monotonic() - start
    assert core.poll() is None, 'core exited'
    assert response[:2] == packet[:2]
    assert struct.unpack('!H', response[2:4])[0] & 15 == 0, response.hex()
    assert struct.unpack('!H', response[6:8])[0] == 1, response.hex()
    return {'name': name, 'address': socket.inet_ntoa(response[-4:]),
            'elapsed': round(elapsed, 3),
            'upstreams': [s.tag for s in servers if len(s.calls) > before[s.tag]]}


def run(binary, parent_namespace):
    namespace = os.readlink('/proc/self/ns/net')
    assert namespace != parent_namespace, 'refusing host network namespace'
    links = json.loads(subprocess.check_output(['ip', '-j', 'link'], text=True))
    assert [link['ifname'] for link in links] == ['lo'], links
    subprocess.run(['ip', 'link', 'set', 'lo', 'up'], check=True)
    for family in ('-4', '-6'):
        routes = json.loads(subprocess.check_output(['ip', '-j', family, 'route', 'show', 'table', 'all'], text=True))
        assert all(route.get('dev') == 'lo' for route in routes), routes
    version = subprocess.check_output([binary, 'version'], text=True)
    assert version.splitlines()[0] == 'sing-box version 1.14.2', version
    report = {'namespace': namespace, 'parent_namespace': parent_namespace,
              'interfaces': ['lo'], 'version': version.splitlines()[0], 'cases': []}
    servers = [Upstream(15301, 'main'), Upstream(15302, 'china'), Upstream(53, 'default')]
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix='homeproxy-dns-core-') as temp:
            for mode in ('bypass_mainland_china', 'global'):
                sets = [
                    {'type': 'inline', 'tag': 'domain-direct-suffix', 'rules': [{'domain_suffix': ['direct.test']}]},
                ]
                if mode == 'bypass_mainland_china':
                    sets += [
                        {'type': 'inline', 'tag': 'domain-proxy-suffix', 'rules': [{'domain_suffix': ['proxy.test']}]},
                        {'type': 'inline', 'tag': 'geoip-cn', 'rules': [{'ip_cidr': ['1.0.1.0/24']}]},
                        {'type': 'inline', 'tag': 'geosite-cn', 'rules': [{'domain_suffix': ['known-cn.test']}]},
                    ]
                dns = dns_config(mode)
                # Rebind the discovery fallback, never change DNS rules/strategy.
                next(s for s in dns['servers'] if s['tag'] == 'default-dns')['server'] = '127.0.0.1'
                config = {
                    'log': {'level': 'debug', 'timestamp': False}, 'dns': dns,
                    'inbounds': [{'type': 'direct', 'tag': 'dns-in', 'listen': '127.0.0.1', 'listen_port': 15300}],
                    'outbounds': [{'type': 'direct', 'tag': 'main-out', 'bind_interface': 'lo'}],
                    'route': {'default_domain_resolver': 'default-dns', 'rules': [{'inbound': ['dns-in'], 'action': 'hijack-dns'}], 'rule_set': sets},
                }
                path = Path(temp) / 'config.json'
                path.write_text(json.dumps(config))
                check = subprocess.run([binary, 'check', '-c', str(path)], capture_output=True, text=True, timeout=10)
                assert check.returncode == 0, check.stderr
                with (Path(temp) / 'core.log').open('w+') as log:
                    core = subprocess.Popen([binary, 'run', '-c', str(path)], stdout=log, stderr=log)
                    try:
                        # Wait for the actual listener, rather than a fixed startup sleep.
                        deadline = time.monotonic() + 5
                        while True:
                            if core.poll() is not None:
                                raise AssertionError('core exited during startup')
                            try:
                                with socket.create_connection(('127.0.0.1', 15300), timeout=0.1):
                                    break
                            except OSError:
                                if time.monotonic() > deadline:
                                    raise AssertionError('DNS listener did not start')
                                time.sleep(0.02)
                        cases = [
                            ('overseas.test', '203.0.113.20', ['main'], 0, 1.5),
                            ('overseas.test', '203.0.113.20', [], 0, 1.5),
                            ('mainland.test', '192.0.2.20' if mode != 'global' else '1.0.1.20',
                             ['main', 'china'] if mode != 'global' else ['main'], 0, 1.5),
                            ('direct.test', '192.0.2.20' if mode != 'global' else '192.0.2.30',
                             ['china'] if mode != 'global' else ['default'], 0, 1.5),
                            ('proxy.test', '1.0.1.20', ['main'], 0, 1.5),
                            ('known-cn.test', '192.0.2.20' if mode != 'global' else '203.0.113.20',
                             ['china'] if mode != 'global' else ['main'], 0, 1.5),
                            ('delayed.test', '203.0.113.20', ['main'], 0.4, 2.0),
                            ('late.test', '192.0.2.20' if mode != 'global' else '203.0.113.20',
                             ['main', 'china'] if mode != 'global' else ['main'],
                             2.7 if mode != 'global' else 3.5, 4.5),
                        ]
                        if mode != 'global':
                            cases.append(('timeout.test', '192.0.2.20', ['main', 'china'], 2.7, 4.5))
                        for name, address, upstreams, minimum, maximum in cases:
                            row = query(name, core, servers)
                            row['mode'] = mode
                            assert row['address'] == address, row
                            assert row['upstreams'] == upstreams, row
                            assert minimum <= row['elapsed'] <= maximum, row
                            report['cases'].append(row)
                    except Exception as exc:
                        log.flush()
                        log.seek(0)
                        raise AssertionError(str(exc) + '\n' + log.read()) from exc
                    finally:
                        core.terminate()
                        try:
                            core.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            core.kill()
                            core.wait(timeout=5)
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
    return report


if __name__ == '__main__':
    print(json.dumps(run(sys.argv[1], sys.argv[2]), indent=2))
