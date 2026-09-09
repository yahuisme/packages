#!/usr/bin/ucode

'use strict';

import { writefile } from 'fs';
import { cursor } from 'uci';
import { RUN_DIR } from 'homeproxy';

const cfgname = 'homeproxy';
const uci = cursor();
const FIREWALL_PROTOCOLS = [ 'tcp', 'udp' ];

function validPort(port) {
	return type(port) === 'string' && match(port, /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/);
}

function protocolExpression(network) {
	if (!network)
		return '{ tcp, udp }';

	return index(FIREWALL_PROTOCOLS, network) === -1 ? null : network;
}

uci.load(cfgname);

let input = [];
if (getenv('HOMEPROXY_SERVER_READY') === '1')
	uci.foreach(cfgname, 'server', (server) => {
		if (server.enabled !== '1' || server.firewall !== '1')
			return;

		const network = protocolExpression(server.network);
		if (!network || !validPort(server.port)) {
			warn(`invalid server firewall configuration: ${server['.name']}`);
			exit(1);
		}

		push(input, `meta l4proto ${network} th dport ${server.port} counter accept comment "!${cfgname}: accept server"`);
	});

const forward_file = RUN_DIR + '/fw4_forward.nft';
const input_file = RUN_DIR + '/fw4_input.nft';

if (writefile(forward_file, '') === null ||
    writefile(input_file, length(input) ? join('\n', input) + '\n' : '') === null)
	exit(1);
