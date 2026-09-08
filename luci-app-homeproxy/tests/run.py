#!/usr/bin/env python3
"""Offline regression entry point. Never invoke router init/firewall or network."""
import pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
def run(*args):
    print('+',' '.join(map(str,args)),flush=True)
    subprocess.run(list(map(str,args)),check=True)
js=list((ROOT/'htdocs').rglob('*.js'))
shell=[p for p in (ROOT/'root').rglob('*') if p.is_file() and p.read_bytes().startswith(b'#!/bin/sh')]
for p in js: run('node','--check',p)
for p in shell: run('bash','-n',p)
for name in ['security.cjs','ports.cjs','ui.cjs','dom.cjs']: run('node',ROOT/'tests'/name)
for name in ['resources.py','init.py','subscriptions.py','i18n.py']: run(sys.executable,ROOT/'tests'/name)
run('git','-C',ROOT.parent,'diff','--check')
print(f'PASS {len(js)} JavaScript syntax checks, {len(shell)} shell syntax checks, 8 fixture/audit suites')
