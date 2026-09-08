"""Catalog coverage/syntax regression. Requires polib and Node acorn (NODE_PATH)."""
import json
import pathlib
import subprocess
import polib

root = pathlib.Path(__file__).resolve().parents[1]
source = root / 'htdocs/luci-static/resources/view/airoha_flowsense/status.js'
ids = set(json.loads(subprocess.check_output(['node', '-e', '''
const ast=require('acorn').parse(require('fs').readFileSync(process.argv[1],'utf8'),
    {ecmaVersion:2020,allowReturnOutsideFunction:true});
const ids=[];
function walk(n) {
    if (!n || typeof n!=='object') return;
    if(n.type==='CallExpression' && n.callee.name==='_') {
        if(n.arguments[0].type!=='Literal') throw Error('Nonliteral translation');
        ids.push(n.arguments[0].value);
    }
    Object.values(n).forEach(v=>Array.isArray(v)?v.forEach(walk):walk(v));
}
walk(ast); console.log(JSON.stringify(ids));
''', str(source)], text=True)))
for path in (root / 'root/usr/share').rglob('*.json'):
    def metadata(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ('title', 'description') and isinstance(value, str):
                    ids.add(value)
                metadata(value)
        elif isinstance(node, list):
            for value in node:
                metadata(value)
    metadata(json.loads(path.read_text()))

catalogs = []
for path in (root / 'po/zh_Hans/luci-app-airoha-flowsense.po',
             root / 'po/templates/luci-app-airoha-flowsense.pot'):
    catalog = polib.pofile(str(path), check_for_duplicates=True)
    active = {e.msgid for e in catalog if not e.obsolete}
    assert ids <= active, (path, ids - active)
    assert all('fuzzy' not in e.flags for e in catalog)
    if path.suffix == '.po':
        assert all(e.msgstr for e in catalog if not e.obsolete)
        translations = {e.msgid: e.msgstr for e in catalog}
        assert translations['Total Port Receive Rate'] == '网口接收总速率'
        assert translations['Total Port Transmit Rate'] == '网口发送总速率'
    catalogs.append(active)
assert catalogs[0] == catalogs[1]
assert not ({'Total Download', 'Total Upload', 'PPE engine inactive', 'Probe inactive'} & catalogs[0])
print(f'PASS: PO/POT syntax, unique IDs, translations and parity; {len(ids)} source/metadata IDs covered')
