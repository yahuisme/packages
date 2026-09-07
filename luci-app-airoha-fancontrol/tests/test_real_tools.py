#!/usr/bin/env python3
"""Real UCI/jsonfilter integration. Set REAL_UCI and REAL_JSONFILTER to built binaries."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from test_fan import ROOT

@unittest.skipUnless(os.environ.get('REAL_UCI') and os.environ.get('REAL_JSONFILTER'), 'set REAL_UCI and REAL_JSONFILTER')
class RealTools(unittest.TestCase):
 def setUp(self):
  for key in ('REAL_UCI','REAL_JSONFILTER'):
   self.assertTrue(Path(os.environ[key]).is_file() and os.access(os.environ[key],os.X_OK),key)
  probe=subprocess.run([os.environ['REAL_JSONFILTER'],'-s','{"probe":123}','-e','@.probe'],text=True,capture_output=True)
  self.assertEqual(probe.stdout.strip(),'123',probe.stderr)
  self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); self.d=Path(self.tmp.name)
  for name in ('config','delta','bin'): (self.d/name).mkdir()
  shutil.copy(ROOT/'root/etc/config/fan', self.d/'config/fan')
  wrapper='''#!/bin/sh
case "$*" in *"$FAIL_SET"*) [ -z "$FAIL_SET" ] || exit 1;; esac
if [ "$1" = commit ] && [ "$FAIL_COMMIT" = 1 ] && [ ! -f "$TESTDIR/failed" ]; then touch "$TESTDIR/failed"; exit 1; fi
exec "$REAL_UCI" -c "$TESTDIR/config" -P "$TESTDIR/delta" "$@"
'''
  (self.d/'bin/uci').write_text(wrapper); (self.d/'bin/uci').chmod(0o755)
  (self.d/'bin/jsonfilter').symlink_to(os.environ['REAL_JSONFILTER'])
  self.env=dict(os.environ,TESTDIR=str(self.d),PATH=str(self.d/'bin')+':'+os.environ['PATH'],FAIL_SET='',FAIL_COMMIT='')
  source=(ROOT/'root/usr/libexec/rpcd/luci.fan').read_text()
  needle='/etc/init.d/fan reload >/dev/null 2>&1'; self.assertIn(needle,source)
  source=source.replace(needle,f'printf reload >> {self.d}/reload; [ "${{FAIL_RELOAD:-0}}" = 0 ]')
  self.rpcfile=self.d/'rpc'; self.rpcfile.write_text(source.replace('/sys/',str(self.d)+'/sys/'))
 def uci(self,*args):
  return subprocess.run([str(self.d/'bin/uci'),*args],env=self.env,text=True,capture_output=True)
 def call(self,method,payload):
  return subprocess.run(['busybox','ash',str(self.rpcfile),'call',method],input=json.dumps(payload)+'\n',env=self.env,text=True,capture_output=True)
 def points(self): return {'points':[{'temp':t,'pwm':p} for t,p in zip((30,40,50,60,70),(50,80,100,150,255))]}
 def test_custom_save_real_uci_jsonfilter(self):
  r=self.call('setCustomCurve',self.points()); self.assertEqual(r.returncode,0,r.stderr+r.stdout)
  self.assertTrue(json.loads(r.stdout)['success']); self.assertEqual(self.uci('get','fan.custom.point1_temp').stdout.strip(),'30')
 def test_rollback_real_pending_delta(self):
  self.uci('set','fan.custom.point1_temp=39'); before=self.uci('export','fan').stdout
  self.env['FAIL_SET']='fan.custom.point3_pwm='
  r=self.call('setCustomCurve',self.points()); self.assertNotEqual(r.returncode,0)
  self.assertFalse(json.loads(r.stdout)['success']); self.assertEqual(self.uci('export','fan').stdout,before)
  self.assertFalse((self.d/'reload').exists())
 def test_commit_failure_real_uci(self):
  before=self.uci('export','fan').stdout; self.env['FAIL_COMMIT']='1'
  r=self.call('setCustomCurve',self.points()); self.assertNotEqual(r.returncode,0)
  self.assertFalse(json.loads(r.stdout)['success']); self.assertEqual(self.uci('export','fan').stdout,before)
 def test_malformed_json_and_extra_points(self):
  for payload in ({'points':[]},{'points':self.points()['points']+[{'temp':90,'pwm':255}]}):
   r=self.call('setCustomCurve',payload); self.assertNotEqual(r.returncode,0,r.stdout)
   self.assertFalse(json.loads(r.stdout)['success'])
 def test_single_setters_rollback_without_hardware_reapply(self):
  for method,payload in [('setMode',{'mode':'manual'}),('setManualPwm',{'pwm':200}),('setPreset',{'preset':'quiet'}),('setCustomCurve',self.points())]:
   with self.subTest(method=method):
    before=self.uci('export','fan').stdout; self.env['FAIL_RELOAD']='1'
    (self.d/'reload').write_text('')
    r=self.call(method,payload); self.assertNotEqual(r.returncode,0)
    self.assertFalse(json.loads(r.stdout)['success']); self.assertEqual(self.uci('export','fan').stdout,before)
    self.assertEqual((self.d/'reload').read_text(),'reload')
 def test_trailing_null_is_ignored_by_jsonfilter(self):
  payload=self.points(); payload['points'].append(None)
  r=self.call('setCustomCurve',payload); self.assertEqual(r.returncode,0,r.stdout+r.stderr)
  self.assertTrue(json.loads(r.stdout)['success'])
  self.assertNotEqual(self.uci('get','fan.custom.point6_temp').returncode,0)
 def test_init_with_real_uci_and_real_file_writes(self):
  hw=self.d/'sys/class/hwmon/hwmon9'; hw.mkdir(parents=True)
  for name,value in {'name':'nct7802','pwm1':'0','pwm1_enable':'2'}.items(): (hw/name).write_text(value+'\n')
  for i in range(1,6):
   (hw/f'pwm1_auto_point{i}_temp').write_text('0\n')
   if i<5: (hw/f'pwm1_auto_point{i}_pwm').write_text('0\n')
  script=self.d/'init'; script.write_text((ROOT/'root/etc/init.d/fan').read_text().replace('/sys/',str(self.d)+'/sys/'))
  def run(): return subprocess.run(['busybox','ash','-c',f'. {script}; apply_settings'],env=self.env,text=True,capture_output=True)
  r=run(); self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual((hw/'pwm1_enable').read_text(),'2\n')
  self.assertEqual((hw/'pwm1_auto_point5_temp').read_text(),'80000\n')
  before={p.name:p.read_text() for p in hw.iterdir()}
  self.uci('set','fan.balanced.point5_pwm=254'); r=run()
  self.assertNotEqual(r.returncode,0); self.assertEqual({p.name:p.read_text() for p in hw.iterdir()},before)
 def test_real_uci_rejects_multiple_assignments(self):
  self.assertNotEqual(self.uci('set','fan.settings.mode=manual','fan.settings.manual_pwm=255').returncode,0)

if __name__=='__main__': unittest.main(verbosity=2)
