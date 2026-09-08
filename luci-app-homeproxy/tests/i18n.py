#!/usr/bin/env python3
"""Multiline gettext parser and bidirectional literal-source audit; no dependencies."""
import ast, collections, json, pathlib, re
ROOT=pathlib.Path(__file__).resolve().parents[1]
def entries(path):
    result=[]; entry=None; field=None
    for line in path.read_text().splitlines()+['msgid ""']:
        if line.startswith('msgid '):
            if entry is not None: result.append(entry)
            entry={'msgid':ast.literal_eval(line[6:]),'msgstr':''};field='msgid'
        elif line.startswith('msgstr '):
            field='msgstr';entry[field]=ast.literal_eval(line[7:])
        elif line.startswith('"') and entry is not None:
            entry[field]+=ast.literal_eval(line)
    return result
literal=r'''(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")'''
source=set()
for p in (ROOT/'htdocs').rglob('*.js'):
    for m in re.finditer(r'(?<![\w])_\(\s*('+literal+r'(?:\s*\+\s*'+literal+r')*)\s*\)',p.read_text()):
        source.add(''.join(ast.literal_eval(v.group()) for v in re.finditer(literal,m.group(1))))
for p in (ROOT/'root/usr/share/luci/menu.d').glob('*.json'):
    source.update(v['title'] for v in json.loads(p.read_text()).values() if 'title' in v)
sets=[]
for p in (ROOT/'po').rglob('*'):
    if not p.is_file(): continue
    rows=entries(p);counts=collections.Counter(e['msgid'] for e in rows)
    duplicate=[k for k,v in counts.items() if v>1]
    ids=set(counts)-{''};sets.append(ids)
    print(p.relative_to(ROOT), 'entries',len(ids),'duplicates',duplicate,
          'missing',sorted(source-ids),'catalog-only',sorted(ids-source))
    assert not duplicate
    assert not source-ids
assert sets[0]==sets[1], 'PO/POT msgid mismatch'
