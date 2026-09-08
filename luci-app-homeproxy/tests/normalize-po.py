#!/usr/bin/env python3
"""Keep the later corrected translation; retain earlier duplicates as gettext obsolete entries."""
import ast,json,pathlib,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
for path in (ROOT/'po').rglob('*'):
    if not path.is_file(): continue
    blocks=re.split(r'\n\s*\n',path.read_text().strip()); keys=[]
    for block in blocks:
        key=None;field=None
        for line in block.splitlines():
            if line.startswith('msgid '): key=ast.literal_eval(line[6:]);field='id'
            elif line.startswith('msgstr '): field='str'
            elif line.startswith('"') and field=='id': key+=ast.literal_eval(line)
        keys.append(key)
    last={key:i for i,key in enumerate(keys) if key is not None};output=[];removed=0
    for i,block in enumerate(blocks):
        if keys[i] is not None and last[keys[i]]!=i:
            block='\n'.join('#~ '+line if not line.startswith('#') else line for line in block.splitlines())
            removed+=1
        output.append(block)
    if 'Expecting: non-empty value' not in last:
        output.append('msgid "Expecting: non-empty value"\nmsgstr '+json.dumps('不能为空' if path.suffix=='.po' else '',ensure_ascii=False))
    path.write_text('\n\n'.join(output)+'\n');print(path, 'obsoleted duplicates',removed)
