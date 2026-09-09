'use strict';

var fs = require('fs');
var assert = require('assert');
var source = fs.readFileSync(__dirname + '/../htdocs/luci-static/resources/view/firmwareupgrade/index.js', 'utf8');

assert(source.includes("params: [ 'keep_config' ]"), 'start RPC must expose only keep_config');
assert(!source.includes('download_url'), 'browser must not handle upgrade URLs');
assert(!source.includes('candidate: null'), 'unused candidate state must be removed');
assert(source.includes("poll.remove(refresh)"), 'progress polling must unregister on modal removal or error');
assert(source.includes('@media(max-width:760px)'), 'narrow screens need a single-column layout');
assert(!source.includes(':root'), 'view must not override global theme variables');
assert(!source.includes('fwup-proxy'), 'removed proxy must not remain in the view');
console.log('PASS: firmware upgrade view structure is native, scoped, and lifecycle-safe.');
