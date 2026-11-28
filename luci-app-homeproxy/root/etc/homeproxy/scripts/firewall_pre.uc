#!/usr/bin/ucode

'use strict';

import { open, readfile, rename, unlink } from 'fs';
import { cursor } from 'uci';
import { RUN_DIR } from 'homeproxy';

const cfgname = 'homeproxy';
const uci = cursor();
uci.load(cfgname);

let input = [];
if (getenv('HOMEPROXY_SERVER_READY') === '1')
	uci.foreach(cfgname, 'server', (server) => {
		if (server.enabled !== '1' || server.firewall !== '1')
			return;

		// Only these inbounds consume the selector; editor retention must not
		// leave a TCP-only opening after switching to a QUIC-based protocol.
		const network = (server.type in ['naive', 'shadowsocks'] && server.network) || '{ tcp, udp }';
		const port = server.port;
		const port_number = int(port);
		if (!match(server['.name'] || '', /^[A-Za-z0-9_]+$/) ||
		    !match(port || '', /^[0-9]+$/) || !(port_number >= 1 && port_number <= 65535) ||
		    !(network in ['tcp', 'udp', '{ tcp, udp }']))
			exit(1);
		push(input, `meta l4proto ${network} th dport ${port} counter accept comment "!${cfgname}: accept server ${server['.name']}"`);
	});

const input_file = RUN_DIR + '/fw4_input.nft';
const staged = input_file + '.new';
const content = length(input) ? join('\n', input) + '\n' : '';
// Service setup holds the native procd lock and owns the runtime directory.
// Verify the staged bytes: older ucode fs bindings can miss buffered failures.
unlink(staged);
const fd = open(staged, 'wx', 0644);
if (!fd)
	exit(1);
const written = fd.write(content);
fd.flush();
const closed = fd.close();
if (written !== length(content) || closed !== true || readfile(staged) !== content || rename(staged, input_file) !== true) {
	unlink(staged);
	exit(1);
}
