"""Offline native sing-box regression using complete generated client configs.

Run only via unshare -n, supplying the caller's /proc/self/ns/net value. Input
files are global.json and bypass_mainland_china.json. No generator API imports,
compilation, downloads, host clock changes or TUN/kernel acceptance are involved.
DNS/route rule arrays are retained exactly, in order. Only network endpoints,
listeners, synthetic rule-set contents and private log/cache paths are adapted.
The input fixtures must force wan_proxy_ipv4_ips=['127.0.0.1/32'].
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import socketserver
import struct
import subprocess
import tempfile
import threading
import time
from typing import Any, cast


class Witness(socketserver.ThreadingUDPServer):
    daemon_threads = True

    def __init__(self, port, kind):
        self.kind, self.calls = kind, []
        super().__init__(('0.0.0.0' if kind == 'ntp' else '127.0.0.1', port), Answer)


class Answer(socketserver.BaseRequestHandler):
    def handle(self):
        packet, sock = self.request
        server = cast(Witness, self.server)
        if server.kind == 'ntp':
            server.calls.append(packet.hex())
            if len(packet) != 48:
                return
            response = bytearray(48)
            response[0:4] = bytes([0x24, 1, 6, 0xec])
            response[12:16] = b'LOCL'
            response[24:32] = packet[40:48]
            stamp = struct.pack('!II', int(time.time()) + 2208988800, 0)
            response[32:40] = stamp
            response[40:48] = stamp
        else:
            pos, labels = 12, []
            while packet[pos]:
                size = packet[pos]
                labels.append(packet[pos + 1:pos + 1 + size].decode())
                pos += size + 1
            server.calls.append('.'.join(labels))
            response = (packet[:2] + struct.pack('!HHHHH', 0x8180, 1, 1, 0, 0)
                        + packet[12:pos + 5] + b'\xc0\x0c'
                        + struct.pack('!HHIH', 1, 1, 60, 4)
                        + socket.inet_aton('192.0.2.44'))
        sock.sendto(response, self.client_address)


def exchange(packet, port, timeout=4.0):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(timeout)
        sock.sendto(packet, ('127.0.0.1', port))
        try:
            return sock.recv(4096)
        except socket.timeout:
            return b''


def dns_query(name, port):
    wire = b''.join(bytes([len(s)]) + s.encode() for s in name.split('.')) + b'\0'
    packet = struct.pack('!HHHHHH', 31415, 0x100, 1, 0, 0, 0) + wire + struct.pack('!HH', 1, 1)
    response = exchange(packet, port)
    if (len(response) >= 12 and response[:2] == packet[:2]
            and struct.unpack('!H', response[2:4])[0] & 15 == 0
            and struct.unpack('!H', response[6:8])[0] == 1):
        return socket.inet_ntoa(response[-4:])
    return None


def isolated_namespace(parent):
    namespace = os.readlink('/proc/self/ns/net')
    if namespace == parent:
        raise RuntimeError('refusing caller network namespace; use unshare -n')
    links = json.loads(subprocess.check_output(['ip', '-j', 'link'], text=True))
    if [link['ifname'] for link in links] != ['lo']:
        raise RuntimeError(f'non-loopback interfaces: {links}')
    subprocess.run(['ip', 'link', 'set', 'lo', 'up'], check=True)
    routes_by_family = {}
    for family in ('-4', '-6'):
        routes = json.loads(subprocess.check_output(
            ['ip', '-j', family, 'route', 'show', 'table', 'all'], text=True))
        if not all(route.get('dev') == 'lo' for route in routes):
            raise RuntimeError(f'non-loopback routes: {routes}')
        routes_by_family[family] = routes
    return {'namespace': namespace, 'parent_namespace': parent,
            'interfaces': ['lo'], 'routes': routes_by_family}


def runtime_config(original, root, mode):
    config = copy.deepcopy(original)
    config['log'] = {'level': 'debug', 'timestamp': False}
    config.pop('ntp', None)  # never let core set the host clock
    config.pop('experimental', None)  # no persistent caches/API listeners
    config['inbounds'] = [
        {'type': 'direct', 'tag': 'dns-in', 'listen': '127.0.0.1', 'listen_port': 15300},
        {'type': 'direct', 'tag': 'runtime-ntp', 'listen': '127.0.0.1', 'listen_port': 17123,
         'network': 'udp', 'override_address': '127.0.0.1', 'override_port': 123},
        {'type': 'direct', 'tag': 'runtime-non123', 'listen': '127.0.0.1', 'listen_port': 17124,
         'network': 'udp', 'override_address': '203.0.113.123', 'override_port': 124},
    ]
    # Global ignores WAN force lists and bypasses private destinations.
    # TEST-NET on lo exercises its final proxy policy without changing rules.
    # Mainland instead proves the exact caller-supplied forced 127.0.0.1 rule.
    if mode == 'global':
        config['inbounds'][1]['override_address'] = '203.0.113.123'
    else:
        config['inbounds'][2]['override_address'] = '127.0.0.1'
    servers = []
    for server in config['dns']['servers']:
        tag = server['tag']
        if tag not in ('default-dns', 'main-dns', 'china-dns'):
            raise RuntimeError(f'unexpected DNS boundary: {tag}')
        # Literal loopback means ordinary main-DNS failures cannot cause a
        # bootstrap lookup of the resolver hostname and false default-DNS hits.
        replacement = {'tag': tag, 'type': 'udp', 'server': '127.0.0.1',
                       'server_port': 15302 if tag == 'china-dns' else 15301}
        if tag == 'main-dns':
            if server.get('detour') != 'main-out':
                raise RuntimeError('main DNS must use main-out')
            replacement['detour'] = 'main-out'
        servers.append(replacement)
    config['dns']['servers'] = servers
    config['outbounds'] = [
        {'type': 'direct', 'tag': 'direct-out', 'bind_interface': 'lo'},
        {'type': 'socks', 'tag': 'main-out', 'server': '127.0.0.1', 'server_port': 10999},
    ]
    sets = []
    for item in config['route'].get('rule_set', []):
        tag = item['tag']
        rule = ({'ip_cidr': ['198.51.100.0/24']} if tag.startswith('geoip')
                else {'domain_suffix': ['synthetic-mainland.test']})
        sets.append({'type': 'inline', 'tag': tag, 'rules': [rule]})
    config['route']['rule_set'] = sets
    # Only replace auto-detected WAN binding with lo; do not modify rules,
    # final, default resolver or other generated routing semantics.
    config['route']['auto_detect_interface'] = False
    config['route']['default_interface'] = 'lo'
    assert config['dns']['rules'] == original['dns']['rules']
    assert config['route']['rules'] == original['route']['rules']
    # Fail closed if the caller forgot the forced WAN-policy fixture.
    def forced(rule):
        return (rule.get('ip_cidr') == ['127.0.0.1/32']
                and rule.get('outbound') == 'main-out') or any(
                    forced(child) for child in rule.get('rules', []))
    if mode != 'global' and not any(forced(rule) for rule in original['route']['rules']):
        raise RuntimeError('input missing forced WAN 127.0.0.1/32 -> main-out rule')
    path = root / 'runtime.json'
    path.write_text(json.dumps(config))
    return path


def wait_ready(core):
    deadline = time.monotonic() + 6
    while core.poll() is None:
        try:
            with socket.create_connection(('127.0.0.1', 15300), .1):
                return
        except OSError:
            if time.monotonic() > deadline:
                break
            time.sleep(.02)
    raise RuntimeError('core DNS listener did not start')


def stop(core):
    if core.poll() is None:
        core.terminate()
        try:
            core.wait(timeout=5)
        except subprocess.TimeoutExpired:
            core.kill()
            core.wait(timeout=5)


def run(args):
    isolated_namespace(args.parent_namespace)  # validate before any namespace writes
    subprocess.run(['ip', 'addr', 'add', '203.0.113.123/32', 'dev', 'lo'], check=True)
    report = isolated_namespace(args.parent_namespace)
    version = subprocess.check_output([args.binary, 'version'], text=True, timeout=10)
    if version.splitlines()[0] != 'sing-box version ' + args.expected_version:
        raise RuntimeError(f'incorrect core: {version}')
    report.update(version=version.splitlines()[0], cases=[], scope=(
        'Production DNS/userspace routing with local witnesses; not TUN/kernel, '
        'router reboot, upstream availability or host clock synchronization evidence'))
    witnesses = [Witness(15301, 'default'), Witness(15302, 'china'),
                 Witness(123, 'ntp'), Witness(124, 'ntp')]
    for server in witnesses:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    default, china, ntp, other = witnesses
    try:
        with tempfile.TemporaryDirectory(prefix='hp-ntp-runtime-') as temp:
            for mode in ('global', 'bypass_mainland_china'):
                raw = (Path(args.configs) / (mode + '.json')).read_bytes()
                original = json.loads(raw)
                root = Path(temp) / mode
                root.mkdir()
                path = runtime_config(original, root, mode)
                check = subprocess.run([args.binary, 'check', '-c', str(path)],
                                       capture_output=True, text=True, timeout=10)
                if check.returncode:
                    raise RuntimeError(check.stderr)
                with (root / 'core.log').open('w+') as log:
                    core = subprocess.Popen([args.binary, 'run', '-c', str(path)], stdout=log, stderr=log)
                    try:
                        wait_ready(core)
                        row: dict[str, Any] = {
                            'mode': mode, 'input_sha256': hashlib.sha256(raw).hexdigest(),
                            'udp_target': '203.0.113.123' if mode == 'global' else '127.0.0.1',
                            'rule_order_preserved': True}
                        before = [len(server.calls) for server in witnesses]
                        log.flush()
                        ntp_log_start = log.tell()
                        row['ntp_address'] = dns_query(args.ntp_domain, 15300)
                        row['ntp_dns_witnesses'] = {
                            s.kind: s.calls[n:] for s, n in zip(witnesses[:2], before[:2])}
                        log.flush()
                        log.seek(ntp_log_start)
                        ntp_dns_log = log.read()
                        log.seek(0, 2)
                        row['ntp_dns_proxy_attempt'] = 'outbound/socks[main-out]' in ntp_dns_log
                        before_dns = [len(default.calls), len(china.calls)]
                        log.flush()
                        ordinary_log_start = log.tell()
                        row['ordinary_address'] = dns_query('ordinary-foreign.test', 15300)
                        row['ordinary_dns_witnesses'] = {
                            s.kind: s.calls[n:] for s, n in zip(witnesses[:2], before_dns)}
                        log.flush()
                        log.seek(ordinary_log_start)
                        ordinary_log = log.read()
                        log.seek(0, 2)
                        request = b'\x23' + bytes(39) + struct.pack('!II', 0x12345678, 0x11223344)
                        response = exchange(request, 17123, timeout=1)
                        row['ntp_packet_count'] = len(ntp.calls) - before[2]
                        row['valid_ntp_response'] = (len(response) == 48 and response[0] & 7 == 4
                                                     and response[24:32] == request[40:48]
                                                     and response[40:48] != bytes(8))
                        log.flush()
                        log_start = log.tell()
                        unexpected = exchange(request, 17124, timeout=.5)
                        log.flush()
                        log.seek(log_start)
                        non123_log = log.read()
                        log.seek(0)
                        full_log = log.read()
                        row['non123_packet_count'] = len(other.calls) - before[3]
                        row['non123_main_out_attempt'] = ('outbound/socks[main-out]' in non123_log
                                                          and ':124' in non123_log)
                        row['ordinary_proxy_attempt'] = (
                            'ordinary-foreign.test' in ordinary_log
                            and 'outbound/socks[main-out]: outbound packet connection to 127.0.0.1:15301'
                            in ordinary_log)
                        checks = {
                            'NTP DNS exclusively default-dns': (
                                row['ntp_address'] == '192.0.2.44'
                                and row['ntp_dns_witnesses']['default'] == [args.ntp_domain]
                                and not row['ntp_dns_witnesses']['china']
                                and not row['ntp_dns_proxy_attempt']),
                            'ordinary DNS never default-dns': not row['ordinary_dns_witnesses']['default'],
                            'ordinary DNS attempts proxy': row['ordinary_proxy_attempt'],
                            'ordinary mode behavior': (
                                row['ordinary_address'] is None and not row['ordinary_dns_witnesses']['china']
                                if mode == 'global' else
                                row['ordinary_address'] == '192.0.2.44'
                                and row['ordinary_dns_witnesses']['china'] == ['ordinary-foreign.test']),
                            'UDP123 direct NTP response': (row['valid_ntp_response']
                                                          and row['ntp_packet_count'] == 1
                                                          and request.hex() in ntp.calls[before[2]:]),
                            'UDP non123 uses main-out': (row['non123_main_out_attempt']
                                                        and not unexpected and row['non123_packet_count'] == 0),
                        }
                        row['checks'] = checks
                        if not all(checks.values()):
                            row['core_log'] = full_log
                        report['cases'].append(row)
                    except Exception as exc:
                        log.flush()
                        log.seek(0)
                        raise RuntimeError(f'{mode}: {exc}\n{log.read()}') from exc
                    finally:
                        stop(core)
    finally:
        for server in witnesses:
            server.shutdown()
            server.server_close()
    report['passed'] = all(all(row['checks'].values()) for row in report['cases'])
    return report


def interrupted(signum, frame):
    raise KeyboardInterrupt(f'signal {signum}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configs', required=True)
    parser.add_argument('--binary', required=True)
    parser.add_argument('--parent-namespace', required=True)
    parser.add_argument('--ntp-domain', default='time.apple.com')
    parser.add_argument('--expected-version', default=os.environ.get('DNS_RUNTIME_VERSION', '1.14.4'))
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupted)
    report = run(args)
    print(json.dumps(report, indent=2))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
