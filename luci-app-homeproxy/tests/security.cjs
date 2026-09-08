// Offline source-level execution of portable ucode guards (not a ucode runtime).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const source = read('root/etc/homeproxy/scripts/generate_client.uc');
const start = source.indexOf('function validate_dashboard(');
assert(start >= 0, 'backend dashboard guard must exist');
const guard = source.slice(start, source.indexOf('\n}', start) + 2);
const ctx = { trim: s => s.trim(), die: s => { throw Error(s); } };
vm.createContext(ctx); vm.runInContext(guard, ctx);
for (const secret of ['', ' ', '\t\n', null])
 assert.throws(() => ctx.validate_dashboard(true, secret), /secret/i);
ctx.validate_dashboard(false, ''); ctx.validate_dashboard(true, 'safe-secret');
assert(source.includes("listen: '::'"), 'dashboard listen default must remain ::');
assert(source.includes("validate_dashboard(uci.get(uciconfig, ucimain, 'dashboard_enabled') === '1', dashboard_secret)"));
console.log('PASS dashboard backend guard: empty/whitespace/null rejected, disabled allowed, :: retained');
