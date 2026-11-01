"""Execute the single-wiphy candidate selector; optional real LuCI view replay."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / 'patches/998-single-wiphy.patch'


class ChannelAnalysisTests(unittest.TestCase):
    def select(self, networks):
        # Execute the shipped addition, not a separate reimplementation.
        added = '\n'.join(line[1:] for line in PATCH.read_text().splitlines()
                          if line.startswith('+') and not line.startswith('+++'))
        start = added.index('tasks.push(d.getWifiNetworks()')
        end = added.index('}, this, d)));', start) + len('}, this, d)));')
        code = '''const networks = JSON.parse(process.argv[1]);
const nets = networks.map(n => ({getIfname: () => n.ifname,
 getID: () => n.id || 'radio1.network1', isUp: () => n.up}));
const d = {getName: () => 'radio1', getWifiNetworks: () => Promise.resolve(nets)};
const ret = {radio1: {ifname: 'radio1'}}, tasks = [];
const L = {bind: (fn, ctx, ...args) => fn.bind(ctx, ...args)};
''' + added[start:end] + '''
Promise.all(tasks).then(() => console.log(JSON.stringify(ret.radio1.ifname)))
 .catch(e => {console.error(e); process.exitCode = 1;});
'''
        result = subprocess.run(['node', '-e', code, json.dumps(networks)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_disabled_logical_interface_does_not_hide_active_netdev(self):
        self.assertEqual(self.select([
            dict(ifname='radio1.network1', up=False),
            dict(ifname='phy0.1-ap0', id='radio1.network2', up=True)]), 'phy0.1-ap0')

    def test_logical_fallback_is_not_a_netdev_even_when_reported_up(self):
        self.assertEqual(self.select([dict(ifname='radio1.network1', up=True)]), 'radio1')

    def test_down_netdev_is_skipped(self):
        self.assertEqual(self.select([
            dict(ifname='phy0.1-ap0', up=False),
            dict(ifname='phy0.1-ap1', up=True)]), 'phy0.1-ap1')

    def test_no_active_interface_keeps_radio_fallback(self):
        for nets in ([], [dict(ifname=None, up=False)], [dict(ifname='', up=True)]):
            with self.subTest(nets=nets):
                self.assertEqual(self.select(nets), 'radio1')

    def test_active_interface_order_is_preserved(self):
        self.assertEqual(self.select([
            dict(ifname='phy0.1-ap0', up=True),
            dict(ifname='phy0.1-ap1', up=True)]), 'phy0.1-ap0')

    @unittest.skipUnless(os.environ.get('LUCI_CHANNEL_SOURCE'), 'set immutable LuCI status source')
    def test_real_patched_view_loads_active_netdev(self):
        source = Path(os.environ['LUCI_CHANNEL_SOURCE'])
        relative = Path('htdocs/luci-static/resources/view/status/channel_analysis.js')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / relative
            target.parent.mkdir(parents=True)
            shutil.copyfile(source / relative, target)
            result = subprocess.run(['patch', '-p1', '--forward', '--fuzz=0', '-i', str(PATCH)],
                                    cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            # Only execute the caller-selected, immutable local LuCI fixture;
            # no browser, remote content or user strings enter this function.
            runner = '''const fs = require('fs'), assert = require('assert/strict');
const code = fs.readFileSync(process.argv[1], 'utf8'), calls = [];
const nets = [
 {getIfname:()=> 'radio1.network1', getID:()=> 'radio1.network1', isUp:()=>false},
 {getIfname:()=> 'phy0.1-ap0', getID:()=> 'radio1.network2', isUp:()=>true}];
const dev = {getName:()=> 'radio1', getWifiNetworks:()=>Promise.resolve(nets)};
const L = {bind:(fn,ctx,...args)=>fn.bind(ctx,...args), resource:s=>s};
const view = new Function('view','poll','request','network','ui','rpc','random','L',code)(
 {extend:x=>x},{stop:()=>{}},{},{getWifiDevices:()=>Promise.resolve([dev])},{},
 {declare:opts=>name=>{
  calls.push({method:opts.method,name});
  return Promise.resolve(opts.method == 'info' ? {} : []);
 }},{},L);
global.cbi_update_table=()=>{};
view.loadSVG=()=>Promise.resolve({});
view.load().then(async ([,radios])=>{
 assert.equal(radios.radio1.ifname,'phy0.1-ap0');
 view.active_tab='radio1';
 view.radios={radio1:{...radios.radio1,band:'5',graph:{},scanCache:{},
  dev:{get:()=> 'not-5g'}}};
 await view.handleScanRefresh();
 assert.deepEqual(calls,[{method:'freqlist',name:'radio1'},
  {method:'scan',name:'phy0.1-ap0'},{method:'info',name:'phy0.1-ap0'}]);
}).catch(e=>{console.error(e);process.exitCode=1});
'''
            result = subprocess.run(['node', '-e', runner, str(target)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
