import pathlib,tempfile,subprocess,os,json
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
 d=pathlib.Path(td);(d/'bin').mkdir()
 (d/'bin/ping').write_text('#!/bin/sh\nprintf "round-trip min/avg/max = 10.000/10.000/10.000 ms\\n"\n')
 (d/'bin/sleep').write_text('#!/bin/sh\nkill -TERM "$PPID"\n')
 for p in (d/'bin').iterdir():p.chmod(0o755)
 s=(root/'root/usr/libexec/npu-jitter-daemon').read_text().replace('/usr/libexec/flowsense-common.sh',str(root/'root/usr/libexec/flowsense-common.sh')).replace('/tmp/npu-jitter.json',str(d/'result.json'))
 (d/'daemon').write_text(s)
 subprocess.run(['busybox','ash',str(d/'daemon'),'example.com'],env=dict(os.environ,PATH=str(d/'bin')+':'+os.environ['PATH']),timeout=5,check=True)
 data=json.loads((d/'result.json').read_text());assert data['deviation']==0 and data['loss']==0 and data['samples']==1,data
 assert not list(d.glob('result.json.*'))
 print('Daemon isolated execution PASS: zero deviation, window counters, atomic result and temp cleanup')
