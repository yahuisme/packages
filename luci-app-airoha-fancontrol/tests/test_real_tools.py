#!/usr/bin/env python3
"""Real UCI integration in temporary config, delta and sysfs directories."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from test_fan import ROOT

@unittest.skipUnless(os.environ.get('REAL_UCI'), 'set REAL_UCI to an isolated CLI binary')
class RealTools(unittest.TestCase):
 def setUp(self):
  self.assertTrue(Path(os.environ['REAL_UCI']).is_file())
  self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup); self.d=Path(self.tmp.name)
  for name in ('config','delta','bin'): (self.d/name).mkdir()
  shutil.copy(ROOT/'root/etc/config/fan', self.d/'config/fan')
  wrapper='''#!/bin/sh
exec "$REAL_UCI" -c "$TESTDIR/config" -P "$TESTDIR/delta" "$@"
'''
  (self.d/'bin/uci').write_text(wrapper); (self.d/'bin/uci').chmod(0o755)
  self.env=dict(os.environ,TESTDIR=str(self.d),PATH=str(self.d/'bin')+':'+os.environ['PATH'])
  source=(ROOT/'root/usr/libexec/rpcd/luci.fan').read_text()
  self.rpcfile=self.d/'rpc'; self.rpcfile.write_text(source.replace('/sys/',str(self.d)+'/sys/'))
 def uci(self,*args):
  return subprocess.run([str(self.d/'bin/uci'),*args],env=self.env,text=True,capture_output=True)
 def call(self,method,payload):
  return subprocess.run(['busybox','ash',str(self.rpcfile),'call',method],input=json.dumps(payload)+'\n',env=self.env,text=True,capture_output=True)
 def test_status_reads_real_uci_without_mutating_it(self):
  self.uci('set','fan.settings.mode=manual')
  self.uci('set','fan.settings.manual_pwm=0')
  self.uci('commit','fan')
  before=self.uci('export','fan').stdout
  result=self.call('getStatus',{})
  self.assertEqual(result.returncode,0,result.stderr)
  data=json.loads(result.stdout)
  self.assertEqual(data['uci_mode'],'manual')
  self.assertEqual(data['uci_manual_pwm'],0)
  self.assertFalse(data['available'])
  self.assertEqual(self.uci('export','fan').stdout,before)
  for method in ('setMode','setManualPwm','setPreset','setCustomCurve','getCurve','getAllCurves'):
   result=self.call(method,{'mode':'auto','pwm':255})
   self.assertNotEqual(result.returncode,0)
   self.assertEqual(self.uci('export','fan').stdout,before)

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
