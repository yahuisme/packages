"""Execute shipped selector and, with LUCI_CHANNEL_SOURCE, the complete patched view."""
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


# Minimal DOM boundaries, while render(), graph generation and refresh all execute
# the caller-selected trusted LuCI module. RPC data never enters Function().
VIEW_RUNNER = r"""
const fs = require('fs');
const fixture = JSON.parse(process.argv[2]), calls = [];
String.prototype.format = function(...args) {
 let i = 0; return this.replace(/%[sdh]/g, () => String(args[i++]));
};
class Node {
 constructor(tag, attrs = {}, children = []) {
  this.tag = tag; this.attrs = {...attrs}; this.style = {};
  this.childNodes = []; this.offsetHeight = 400; this.offsetWidth = 1000;
  for (const child of (Array.isArray(children) ? children : [children]))
   if (child != null) this.appendChild(child);
 }
 appendChild(child) {
  if (!(child instanceof Node)) child = new Node('#text', {text: String(child)});
  this.childNodes.push(child); child.parentNode = this; return child;
 }
 removeChild(child) {
  this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null;
 }
 remove() { this.parentNode?.removeChild(this); }
 setAttribute(key, value) { this.attrs[key] = String(value); }
 addEventListener() {}
 get firstElementChild() { return this.childNodes[0]; }
 get lastElementChild() { return this.childNodes.at(-1); }
 get textContent() {
  return (this.attrs.text || '') + this.childNodes.map(c => c.textContent).join('');
 }
 cloneNode() { return new Node(this.tag, this.attrs, this.childNodes.map(c=>c.cloneNode())); }
}
global._ = text => text;
global.E = (tag, attrs = {}, children = []) => new Node(tag, attrs, children);
global.document = {
 createElementNS: (ns, tag) => new Node(tag),
 createTextNode: text => new Node('#text', {text: String(text)})
};
global.requestAnimationFrame = fn => fn();
global.cbi_update_table = (table, rows) => { table.rows = rows; };
const radioName = fixture.radio || 'radio2', configuredBand = fixture.band || '6g';
const nets = (fixture.nets || []).map((n, i) => ({
 getID: () => n.id || `${radioName}.network${i + 1}`,
 getIfname: () => n.ifname, isUp: () => n.up
}));
const dev = {getName: () => radioName, get: key => key == 'band' ? configuredBand : null,
 getWifiNetworks: () => Promise.resolve(nets)};
// Shared wiphy freqlist: overlapping channels 1 and 5 must not imply 2/6GHz identity.
const freqs = fixture.freqs || [
 ...Array.from({length:14}, (_,i) => ({band:2,channel:i+1,mhz:i==13?2484:2412+i*5})),
 ...[36,40,44,48,52,56,60,64,149,153,157,161,165].map(channel=>({band:5,channel,mhz:5000+5*channel})),
 {band:6,channel:2,mhz:5935},
 ...Array.from({length:59}, (_,i) => ({band:6,channel:1+4*i,mhz:5955+20*i}))
];
let frame;
const view = new Function('view','poll','request','network','ui','rpc','random','L',
 fs.readFileSync(process.argv[1], 'utf8'))(
 {extend: value => value}, {stop() {}, add() {}}, {},
 {getWifiDevices: () => Promise.resolve([dev])},
 {createHandlerFn: () => () => {}, tabs: {initTabGroup() {}}},
 {declare: opts => name => {
  calls.push({method:opts.method, name});
  const value = opts.method == 'freqlist' ? freqs : opts.method == 'scan' ? frame.scan || [] : frame.info || {};
  return Promise.resolve(structuredClone(value));
 }}, {derive_color: () => '#888888'},
 {bind: (fn, ctx, ...args) => fn.bind(ctx, ...args), resource: s => s});
view.loadSVG = () => Promise.resolve(new Node('svg', {}, [new Node('g')]));
const flatten = value => value instanceof Node ? value.textContent :
 Array.isArray(value) ? value.map(flatten).join('') : String(value);
(async () => {
 const loaded = await view.load();
 view.render(loaded);
 view.active_tab = radioName + configuredBand.replace('g', '');
 const radio = view.radios[view.active_tab], snapshots = [];
 for (frame of fixture.frames) {
  await view.handleScanRefresh();
  snapshots.push({
   rows: radio.table.rows.map(row => row.map(flatten)),
   cache: Object.fromEntries(Object.entries(radio.scanCache).map(([key, value]) =>
    [key, {data: structuredClone(value.data), hasGraph: !!value.graph}])),
   groups: radio.graph.graph.firstElementChild.childNodes.filter(n => n.tag == 'g').map(n => n.textContent),
   points: radio.graph.graph.firstElementChild.childNodes.filter(n => n.tag == 'g')
    .flatMap(n => n.childNodes.filter(c => c.tag == 'polyline').map(c => c.attrs.points))
  });
 }
 console.log(JSON.stringify({calls, selected:loaded[1][radioName].ifname,
  tabs:Object.keys(view.radios), snapshots}));
})().catch(error => {console.error(error);process.exitCode = 1;});
"""


@unittest.skipUnless(os.environ.get('LUCI_CHANNEL_SOURCE'), 'set immutable LuCI status source')
class RealChannelAnalysisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = Path(os.environ['LUCI_CHANNEL_SOURCE'])
        relative = Path('htdocs/luci-static/resources/view/status/channel_analysis.js')
        directory = tempfile.TemporaryDirectory(prefix='channel-analysis-')
        cls.addClassCleanup(directory.cleanup)
        root = Path(directory.name)
        cls.target = root / relative
        cls.target.parent.mkdir(parents=True)
        shutil.copyfile(source / relative, cls.target)
        result = subprocess.run(['patch', '-p1', '--forward', '--batch', '--fuzz=0',
                                 '--no-backup-if-mismatch', '-i', str(PATCH)],
                                cwd=root, capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    def replay(self, **fixture):
        result = subprocess.run(['node', '-e', VIEW_RUNNER, str(self.target), json.dumps(fixture)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_disabled_6g_cross_band_info_keeps_scan_and_valid_neighbors(self):
        neighbor = dict(bssid='02:00:00:00:06:01', ssid='Neighbor 6GHz', band=6,
                        channel=5, frequency=5975, signal=-67, mode='Master')
        wrong_band = dict(bssid='02:00:00:00:02:01', ssid='Neighbor 2GHz', band=2,
                          channel=1, frequency=2412, signal=-44, mode='Master')
        result = self.replay(nets=[dict(ifname='radio2.network1', up=False)], frames=[{
            'scan': [neighbor, wrong_band],
            'info': dict(bssid='00:58:28:0E:47:BA', channel=1, frequency=2412,
                         center_chan1=1, htmode='EHT20', mode='Master')}])
        self.assertEqual(result['selected'], 'radio2')
        self.assertEqual(result['tabs'], ['radio26'])
        self.assertEqual(result['calls'], [dict(method='freqlist', name='radio2'),
                         dict(method='scan', name='radio2'), dict(method='info', name='radio2')])
        snapshot = result['snapshots'][0]
        self.assertEqual([row[1] for row in snapshot['rows']], ['⬤ Neighbor 6GHz'])
        self.assertEqual(snapshot['groups'], ['Neighbor 6GHz'])
        self.assertNotIn('00:58:28:0E:47:BA', snapshot['cache'])
        self.assertNotIn('undefined', snapshot['cache'])

    def test_info_without_bssid_is_not_a_local_interface(self):
        for bssid in (None, ''):
            with self.subTest(bssid=bssid):
                result = self.replay(frames=[{'info': dict(bssid=bssid, channel=1,
                    frequency=5955, center_chan1=1, htmode='HE20', mode='Master')}])
                snapshot = result['snapshots'][0]
                self.assertEqual(snapshot['rows'], [])
                self.assertEqual(snapshot['groups'], [])
                self.assertEqual(snapshot['cache'], {})

    def test_incomplete_local_info_is_ignored_without_breaking_refresh(self):
        complete = dict(bssid='02:00:00:00:06:00', channel=1, frequency=5955,
                        center_chan1=1, htmode='HE20', mode='Master')
        for missing in ('center_chan1', 'htmode'):
            with self.subTest(missing=missing):
                info = {key: value for key, value in complete.items() if key != missing}
                result = self.replay(frames=[{'info': info}])
                snapshot = result['snapshots'][0]
                self.assertEqual(snapshot['rows'], [])
                self.assertEqual(snapshot['groups'], [])
                self.assertEqual(snapshot['cache'], {})

    def test_empty_and_unknown_frequency_info_do_not_create_local_cache(self):
        base = dict(bssid='02:00:00:00:06:00', channel=1, frequency=5955,
                    center_chan1=1, htmode='HE20', mode='Master')
        infos = [{}, {key: value for key, value in base.items() if key != 'frequency'},
                 {**base, 'frequency': None}, {**base, 'frequency': 0},
                 {**base, 'frequency': 2412}, {**base, 'frequency': 5975},
                 {**base, 'channel': 0}, {**base, 'channel': 234}]
        result = self.replay(frames=[{'info': info} for info in infos])
        self.assertEqual(len(result['snapshots']), len(infos))
        for snapshot in result['snapshots']:
            self.assertEqual(snapshot['rows'], [])
            self.assertEqual(snapshot['groups'], [])
            self.assertEqual(snapshot['cache'], {})

    def test_real_view_selects_active_netdev_after_disabled_logical_interface(self):
        result = self.replay(radio='radio1', band='5g', nets=[
            dict(ifname='radio1.network1', up=False),
            dict(ifname='phy0.1-ap0', id='radio1.network2', up=True)], frames=[{}])
        self.assertEqual(result['selected'], 'phy0.1-ap0')
        self.assertEqual(result['tabs'], ['radio15'])
        self.assertEqual(result['calls'], [dict(method='freqlist', name='radio1'),
                         dict(method='scan', name='phy0.1-ap0'), dict(method='info', name='phy0.1-ap0')])

    def test_normal_local_interfaces_keep_native_signal_width_and_graph(self):
        cases = [
            ('radio0', '2g', 1, 2412, 1, 'HT20', '20 MHz'),
            ('radio0', '2g', 14, 2484, 14, 'HT20', '20 MHz'),
            ('radio1', '5g', 36, 5180, 42, 'VHT80', '80 MHz'),
            ('radio2', '6g', 1, 5955, 1, 'HE20', '20 MHz'),
            ('radio2', '6g', 2, 5935, 2, 'HE20', '20 MHz'),
            ('radio2', '6g', 37, 6135, 31, 'EHT320', '320 MHz')]
        for radio, band, channel, frequency, center, htmode, width in cases:
            with self.subTest(band=band, channel=channel, htmode=htmode):
                bssid = '02:00:00:00:00:01'
                result = self.replay(radio=radio, band=band,
                    nets=[dict(ifname='phy0-ap0', up=True)], frames=[{'info': dict(
                        bssid=bssid, channel=channel, frequency=frequency,
                        center_chan1=center, htmode=htmode, mode='Master')}])
                snapshot = result['snapshots'][0]
                self.assertEqual(snapshot['rows'], [['-10\u00a0dBm', '⬤ Local Interface',
                    str(channel), width, 'Master', bssid]])
                self.assertEqual(snapshot['groups'], ['Local Interface'])
                self.assertEqual(list(snapshot['cache']), [bssid])
                self.assertTrue(snapshot['cache'][bssid]['hasGraph'])
                self.assertTrue(snapshot['points'])
                self.assertNotRegex(' '.join(snapshot['points']), r'NaN|undefined')

    def test_repeated_info_does_not_duplicate_local_graph_or_cache(self):
        local = dict(bssid='02:00:00:00:06:00', channel=37, frequency=6135,
                     center_chan1=31, htmode='EHT320', mode='Master')
        neighbor = dict(bssid='02:00:00:00:06:01', ssid='Neighbor', band=6,
                        channel=5, frequency=5975, signal=-67, mode='Master')
        result = self.replay(frames=[{'info': local, 'scan': [neighbor]},
                                   {'info': local, 'scan': [neighbor]}, {'info': local}])
        for index, snapshot in enumerate(result['snapshots']):
            self.assertEqual([row[1] for row in snapshot['rows']],
                             ['⬤ Local Interface', '⬤ Neighbor'])
            self.assertEqual(snapshot['groups'], ['Local Interface', 'Neighbor'])
            self.assertEqual(set(snapshot['cache']), {local['bssid'], neighbor['bssid']})
            self.assertEqual(snapshot['cache'][local['bssid']]['data']['signal'], -10)
            self.assertEqual(snapshot['cache'][neighbor['bssid']]['data']['signal'], -67)
            self.assertTrue(snapshot['cache'][neighbor['bssid']]['data']['stale'])
            if index == 2:
                self.assertEqual(snapshot['rows'][1][0], '-67\u00a0dBm')

    def test_rejected_info_does_not_overwrite_same_bssid_scan_cache(self):
        bssid = '02:00:00:00:06:01'
        neighbor = dict(bssid=bssid, ssid='Real neighbor', band=6, channel=1,
                        frequency=5955, signal=-67, mode='Master')
        unrelated = dict(bssid=bssid, channel=1, frequency=2412,
                         center_chan1=1, htmode='EHT20', mode='Master')
        result = self.replay(frames=[{'info': unrelated, 'scan': [neighbor]},
                                   {'info': unrelated}, {'info': {}}])
        for snapshot in result['snapshots']:
            self.assertEqual([row[1] for row in snapshot['rows']], ['⬤ Real neighbor'])
            self.assertEqual(snapshot['groups'], ['Real neighbor'])
            self.assertEqual(list(snapshot['cache']), [bssid])
            self.assertEqual(snapshot['cache'][bssid]['data']['frequency'], 5955)
            self.assertEqual(snapshot['cache'][bssid]['data']['signal'], -67)

    def test_missing_freqlist_mhz_cannot_validate_unknown_local_frequency(self):
        result = self.replay(freqs=[dict(band=6, channel=1)], frames=[{'info': dict(
            bssid='02:00:00:00:06:00', channel=1, center_chan1=1,
            htmode='HE20', mode='Master')}])
        snapshot = result['snapshots'][0]
        self.assertEqual(snapshot['rows'], [])
        self.assertEqual(snapshot['groups'], [])
        self.assertEqual(snapshot['cache'], {})

    def test_local_graph_is_removed_when_later_info_is_wrong_band_or_empty(self):
        local = dict(bssid='02:00:00:00:06:00', channel=1, frequency=5955,
                     center_chan1=1, htmode='HE20', mode='Master')
        neighbor = dict(bssid='02:00:00:00:06:01', ssid='Neighbor', band=6,
                        channel=5, frequency=5975, signal=-67, mode='Master')
        wrong_band = dict(bssid='02:00:00:00:02:00', channel=1, frequency=2412,
                          center_chan1=1, htmode='HE20', mode='Master')
        for later in (wrong_band, {}):
            with self.subTest(later=later):
                result = self.replay(frames=[{'info': local, 'scan': [neighbor]},
                                            {'info': later}])
                self.assertEqual(result['snapshots'][0]['groups'], ['Local Interface', 'Neighbor'])
                snapshot = result['snapshots'][1]
                self.assertEqual([row[1] for row in snapshot['rows']], ['⬤ Neighbor'])
                self.assertEqual(snapshot['groups'], ['Neighbor'])
                self.assertEqual(list(snapshot['cache']), [neighbor['bssid']])

    def test_local_bssid_change_replaces_graph_without_duplicating_neighbors(self):
        local = dict(bssid='02:00:00:00:06:00', channel=1, frequency=5955,
                     center_chan1=1, htmode='HE20', mode='Master')
        replacement = {**local, 'bssid': '02:00:00:00:06:02', 'channel': 5,
                       'frequency': 5975, 'center_chan1': 5}
        neighbor = dict(bssid='02:00:00:00:06:01', ssid='Neighbor', band=6,
                        channel=9, frequency=5995, signal=-67, mode='Master')
        result = self.replay(frames=[{'info': local, 'scan': [neighbor]},
                                   {'info': replacement, 'scan': [neighbor]}])
        snapshot = result['snapshots'][1]
        self.assertEqual(snapshot['groups'].count('Local Interface'), 1)
        self.assertEqual(snapshot['groups'].count('Neighbor'), 1)
        self.assertEqual(set(snapshot['cache']), {replacement['bssid'], neighbor['bssid']})
        self.assertEqual([row[2] for row in snapshot['rows']], ['5', '9'])

    def test_scan_with_previous_local_bssid_is_preserved_after_info_rejection(self):
        local = dict(bssid='02:00:00:00:06:00', channel=1, frequency=5955,
                     center_chan1=1, htmode='HE20', mode='Master')
        scanned = dict(bssid=local['bssid'], ssid='Now scanned', band=6, channel=1,
                       frequency=5955, signal=-67, mode='Master')
        result = self.replay(frames=[{'info': local}, {'info': {}, 'scan': [scanned]}])
        snapshot = result['snapshots'][1]
        self.assertEqual(snapshot['groups'], ['Now scanned'])
        self.assertEqual([row[1] for row in snapshot['rows']], ['⬤ Now scanned'])
        self.assertEqual(snapshot['cache'][local['bssid']]['data']['signal'], -67)

    def test_normal_scan_neighbors_remain_band_filtered_with_local_info(self):
        cases = [('2g', 1, 2412), ('5g', 36, 5180), ('6g', 1, 5955)]
        for band, channel, frequency in cases:
            with self.subTest(band=band):
                local = dict(bssid='02:00:00:00:00:00', channel=channel,
                             frequency=frequency, center_chan1=channel,
                             htmode='HE20', mode='Master')
                scan = [dict(bssid=f'02:00:00:00:00:0{index + 1}', ssid=other,
                             band=int(other[0]), channel=chan, frequency=freq,
                             signal=-67, mode='Master')
                        for index, (other, chan, freq) in enumerate(cases)]
                result = self.replay(band=band, frames=[{'info': local, 'scan': scan}])
                snapshot = result['snapshots'][0]
                self.assertEqual([row[1] for row in snapshot['rows']],
                                 ['⬤ Local Interface', '⬤ ' + band])
                self.assertEqual(snapshot['groups'], ['Local Interface', band])


if __name__ == '__main__':
    unittest.main(verbosity=2)
