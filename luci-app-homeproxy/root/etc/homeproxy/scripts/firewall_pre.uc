#!/usr/bin/ucode

'use strict';

import { writefile } from 'fs';
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

		const network = server.network || '{ tcp, udp }';
		const port = server.port;
		if (!match(server['.name'] || '', /^[A-Za-z0-9_]+$/) ||
		    !match(port || '', /^[0-9]+$/) || int(port) < 1 || int(port) > 65535 ||
		    !(network in ['tcp', 'udp', '{ tcp, udp }']))
			exit(1);
		push(input, `meta l4proto ${network} th dport ${port} counter accept comment "!${cfgname}: accept server ${server['.name']}"`);
	});

const input_file = RUN_DIR + '/fw4_input.nft';

if (writefile(input_file, length(input) ? join('\n', input) + '\n' : '') === null)
	exit(1);
