#!/usr/bin/env python3
"""Isolated BusyBox ash regression tests; read-only UCI adapter, no host sysfs/services."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ADAPTER = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
while args and args[0].startswith('-'): args.pop(0)
if len(args)!=2 or args[0]!='get': sys.exit(1)
with open(os.environ['UCI_LOG'],'a') as log: log.write(' '.join(args)+'\\n')
db=json.loads(Path(os.environ['STATE']).read_text())
if args[1] not in db: sys.exit(1)
print(db[args[1]])
'''

class FanTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
  self.d=Path(self.tmp.name); self.hw=self.d/'sys/class/hwmon/hwmon8'; self.hw.mkdir(parents=True)
  self.state=self.d/'state.json'; self.log=self.d/'writes'; self.log.touch()
  self.env=dict(os.environ,STATE=str(self.state),UCI_LOG=str(self.d/'uci.log'),PATH=str(self.d)+':'+os.environ['PATH'])
  p=self.d/'uci'; p.write_text(ADAPTER); p.chmod(0o755)
  db={}; section=''
  for line in (ROOT/'root/etc/config/fan').read_text().splitlines():
   a=shlex.split(line)
   if a and a[0]=='config': section=a[2]
   if a and a[0]=='option': db['fan.'+section+'.'+a[1]]=a[2]
  self.state.write_text(json.dumps(db))
  for name,value in {'name':'nct7802','pwm1':'80','pwm1_enable':'2','temp1_input':'42000','fan1_input':'1500'}.items(): (self.hw/name).write_text(value+'\n')
  for i in range(1,6):
   (self.hw/f'pwm1_auto_point{i}_temp').write_text('0\n')
   if i<5: (self.hw/f'pwm1_auto_point{i}_pwm').write_text('0\n')
 def config(self, **values):
  db=json.loads(self.state.read_text())
  for k,v in values.items():
   if v is None: db.pop(k,None)
   else: db[k]=v
  self.state.write_text(json.dumps(db))
 def script(self,relative):
  text=(ROOT/relative).read_text().replace('/sys/',str(self.d)+'/sys/')
  text=text.replace('/etc/init.d/fan reload', 'false')
  p=self.d/Path(relative).name; p.write_text(text); return p
 def run_init(self,fail=''):
  p=self.script('root/etc/init.d/fan')
  # Override only the I/O boundary. Production validation and apply logic run unchanged.
  wrapper=f''' . {shlex.quote(str(p))}
logger() {{ :; }}
write_hwmon() {{
 printf '%s %s\\n' "${{2##*/}}" "$1" >> {shlex.quote(str(self.log))}
 [ "${{2##*/}}:$1" != {shlex.quote(fail or 'NONE')} ] || return 1
 case "${{2##*/}}:$1" in pwm1_enable:0|pwm1_enable:3) return 1;; esac
 [ -f "$2" ] || return 1
 printf '%s\\n' "$1" > "$2"
}}
apply_settings
'''
  return subprocess.run(['busybox','ash','-c',wrapper],env=self.env,text=True,capture_output=True)
 def rpc(self,method,payload=None):
  p=self.script('root/usr/libexec/rpcd/luci.fan')
  return subprocess.run(['busybox','ash',str(p),'call',method],input=json.dumps(payload or {})+'\n',env=self.env,text=True,capture_output=True)
 def test_rpc_is_read_only(self):
  script=self.script('root/usr/libexec/rpcd/luci.fan')
  result=subprocess.run(['busybox','ash',str(script),'list'],text=True,capture_output=True)
  self.assertEqual(json.loads(result.stdout), {'getStatus':{}})

 def test_invalid_last_point_never_writes(self):
  self.config(**{'fan.balanced.point5_pwm':'254'})
  r=self.run_init(); self.assertNotEqual(r.returncode,0); self.assertEqual(self.log.read_text(),'')

 def test_status_rejects_malformed_integer(self):
  for value in ('--1','1-2','-','08','012','9999999999999999999999999'):
   with self.subTest(value=value):
    (self.hw/'temp1_input').write_text(value+'\n')
    r=self.rpc('getStatus'); data=json.loads(r.stdout)
    self.assertIsNone(data['temp_board']); self.assertEqual(r.stderr,'')
 def test_cpu_matches_type_not_probe_order(self):
  for index,kind,temp in [(0,'unrelated','99000'),(7,'cpu-thermal','51000')]:
   zone=self.d/f'sys/class/thermal/thermal_zone{index}'
   zone.mkdir(parents=True)
   (zone/'type').write_text(kind+'\n'); (zone/'temp').write_text(temp+'\n')
  self.assertEqual(json.loads(self.rpc('getStatus').stdout)['temp_cpu'],51)
  (self.d/'sys/class/thermal/thermal_zone7/type').write_text('unrelated\n')
  self.assertIsNone(json.loads(self.rpc('getStatus').stdout)['temp_cpu'])

 def test_w1700k_sensor_names_are_preserved(self):
  for index,name,temp in [(1,'mdio:05',41000),(2,'mdio:08',42000),
                           (3,'mt7996_phy0.0',43000),(4,'mt7996_phy0_1',44000),
                           (5,'mt7996_phy0.2',45000),(6,'mt7996_phy1.0',99000)]:
   sensor=self.d/f'sys/class/hwmon/hwmon{index}'
   sensor.mkdir(parents=True)
   (sensor/'name').write_text(name+'\n')
   (sensor/'temp1_input').write_text(str(temp)+'\n')
  data=json.loads(self.rpc('getStatus').stdout)
  self.assertEqual([data[k] for k in ('temp_phy1','temp_phy2','wifi_24g','wifi_5g','wifi_6g')],
                   [41,42,43,44,45])

 def test_status_missing_is_null(self):
  (self.hw/'fan1_input').unlink()
  data=json.loads(self.rpc('getStatus').stdout)
  for key in ('fan_rpm','temp_cpu','temp_phy1','temp_phy2','wifi_24g','wifi_5g','wifi_6g'):
   self.assertIsNone(data[key],key)
 def test_status_complete_and_negative(self):
  (self.hw/'temp1_input').write_text('-12000\n')
  data=json.loads(self.rpc('getStatus').stdout)
  self.assertEqual(data['temp_board'],-12); self.assertEqual(data['fan_rpm'],1500)
  self.assertEqual(data['fan_pwm'],80); self.assertEqual(data['fan_mode'],2)
  self.assertEqual(data['fan_percentage'],31); self.assertTrue(data['available'])
 def test_removed_methods_cannot_modify_configuration(self):
  before=self.state.read_text()
  for method in ('getCurve','getAllCurves','setMode','setManualPwm','setPreset','setCustomCurve'):
   with self.subTest(method=method):
    result=self.rpc(method, {'mode':'manual','pwm':0})
    self.assertNotEqual(result.returncode,0)
    self.assertEqual(json.loads(result.stdout),{'error':'Invalid method'})
    self.assertEqual(self.state.read_text(),before)
    self.assertFalse((self.d/'uci.log').exists())

 def test_all_invalid_config_has_no_io(self):
  original=self.state.read_text()
  for key,value in [('fan.settings.mode','bad'),('fan.settings.curve_preset','../x'),('fan.balanced.point1_temp','1-2'),('fan.balanced.point1_temp','000'),('fan.balanced.point3_temp','44'),('fan.balanced.point3_pwm','1'),('fan.balanced.point2_temp','999999999999999999999')]:
   with self.subTest(key=key,value=value):
    self.state.write_text(original); self.config(**{key:value}); self.log.write_text('')
    r=self.run_init(); self.assertNotEqual(r.returncode,0); self.assertEqual(self.log.read_text(),'')
 def test_inactive_config_does_not_block_rescue(self):
  self.config(**{'fan.settings.mode':'manual','fan.settings.manual_pwm':'255','fan.settings.curve_preset':None,'fan.balanced.point5_pwm':'broken'})
  self.assertEqual(self.run_init().returncode,0)
  self.config(**{'fan.settings.mode':'auto','fan.settings.curve_preset':'quiet','fan.settings.manual_pwm':None})
  self.assertEqual(self.run_init().returncode,0)
 def test_auto_and_manual_apply(self):
  r=self.run_init(); self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual((self.hw/'pwm1_enable').read_text(),'2\n')
  self.assertEqual((self.hw/'pwm1_auto_point5_temp').read_text(),'80000\n')
  self.assertNotIn('point5_pwm',self.log.read_text())
  self.config(**{'fan.settings.mode':'manual','fan.settings.manual_pwm':'0'})
  r=self.run_init(); self.assertEqual(r.returncode,0,r.stderr)
  self.assertEqual((self.hw/'pwm1').read_text(),'0\n')
 def test_io_failure_attempts_full_speed(self):
  for fail in ('pwm1_auto_point3_temp:60000','pwm1_enable:2','pwm1_enable:1','pwm1:255'):
   with self.subTest(fail=fail):
    self.log.write_text(''); r=self.run_init(fail)
    self.assertNotEqual(r.returncode,0)
    self.assertTrue(self.log.read_text().endswith('pwm1 255\npwm1_enable 1\n'))
    self.assertNotIn('pwm1_enable 0',self.log.read_text())
 def test_real_write_boundary(self):
  p=self.script('root/etc/init.d/fan'); missing=self.d/'missing'
  r=subprocess.run(['busybox','ash','-c',f'. {p}; write_hwmon 255 {missing}'],capture_output=True)
  self.assertNotEqual(r.returncode,0); self.assertFalse(missing.exists())
 def test_frontend_and_package_contracts(self):
  js=(ROOT/'htdocs/luci-static/resources/view/fan/settings.js').read_text()
  self.assertIn('option.readonly = (i === 5)',js)
  self.assertIn('validateCurve',js)
  mk=(ROOT/'Makefile').read_text()
  self.assertIn('PKG_LICENSE:=GPL-2.0-or-later',mk)
  self.assertLess(mk.index('/conffiles'),mk.index('include $(TOPDIR)/feeds/luci/luci.mk'))

if __name__=='__main__': unittest.main(verbosity=2)
