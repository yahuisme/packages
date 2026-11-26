"""Real ucode current_node_get, full production tag registry, private UCI/curl.

No proxy, network, compilation or host configuration. The legacy full filter is
an executable oracle; instrumentation only counts label probes and comparisons.
HP_NODE_EVIDENCE preserves counts and the exact executed ucode source.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from client_generator_fixture import ClientGenerator

APP = Path(__file__).resolve().parents[1]
EVIDENCE = []


def node(id, label, **fields):
    return {'.name': id, '.type': 'node', 'label': label, 'type': 'socks',
            'address': '192.0.2.10', 'port': '1080', **fields}


def exercise(cases):
    helper = (APP / 'root/etc/homeproxy/scripts/homeproxy.uc').read_text()
    helpers = helper[helper.index('export function reserveUniqueLabel'):
                     helper.index('export function synchronizeNodeLabels')].replace('export function', 'function')
    rpc = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
    start = rpc.index('\tcurrent_node_get:')
    method = rpc[rpc.index('\t\tcall: function() {', start):rpc.index('\n\t},', start)].strip()[len('call: '):]
    start = method.index("const node_tags = createNodeOutboundTags(uci, 'homeproxy');")
    end = method.index('\n\t\t\treturn {', start)
    legacy = method[:start] + "const node_tags = createNodeOutboundTags(uci, 'homeproxy');\nconst section_id = filter(keys(node_tags), (id) => node_tags[id] === tag)[0];\n" + method[end:]
    assert method.count('node_tags[id] === tag') == 1, 'review comparison instrumentation after source change'
    helpers = helpers.replace('while (used[candidate])', 'while ((stats.label_probes++, used[candidate]))')
    helpers = helpers.replace('return tags;', 'stats.tags = tags; return tags;')
    prelude = '''
let stats, input, nodes;
function cursor() { return {
 load: () => stats.load++,
 get: function(c, s, o) { stats.get++; return o === 'main_node' ? (input.mode || 'urltest') : (input.port ?? '9090'); },
 get_all: function(c, s) { stats.get_all++; return nodes[s]; },
 foreach: function(c, t, cb) { if (t === 'domain_route') { for (let group in (input.groups || [])) cb(group); return; } for (let n in input.nodes) { stats.node_visits++; push(stats.order, n['.name']); cb(n); } }
}; }
function popen(command) {
 stats.curl++;
 if (input.failure === 'popen') return null;
 let read = false;
 return { read: function() { if (read) return ''; read = true;
  return input.failure === 'malformed' ? '{invalid' : input.failure === 'empty' ? '' : sprintf('%J', {now:input.tag}); },
  close: () => input.status ?? 0 };
}
function compare(value, tag) {
 if (stats.node_visits !== length(input.nodes) * stats.curl) die('comparison before full registration');
 stats.reverse_comparisons++;
 return value === tag;
}
function reset() {
 stats = {load:0, get:0, get_all:0, curl:0, node_visits:0, label_probes:0, reverse_comparisons:0, order:[], tags:null};
}
'''
    source = prelude + helpers + '\nconst plain = ' + method + ';\n'
    source += 'const counted = ' + method.replace('node_tags[id] === tag', 'compare(node_tags[id], tag)') + ';\n'
    source += 'const legacy = ' + legacy.replace('node_tags[id] === tag', 'compare(node_tags[id], tag)') + ';\n'
    source += 'const inputs = ' + json.dumps(cases, ensure_ascii=False) + ';\n'
    source += '''
let results = [];
for (input in inputs) {
 nodes = {}; for (let n in input.nodes) nodes[n['.name']] = n;
 reset(); let original = plain();
 reset(); let actual; for (let i=0; i<(input.repeats || 1); i++) actual = counted();
 const current_counts = stats;
 reset(); let expected; for (let i=0; i<(input.repeats || 1); i++) expected = legacy();
 push(results, {name:input.name, actual, original, expected, current:current_counts, legacy:stats});
}
print(sprintf('%J', results));
'''
    with tempfile.TemporaryDirectory(prefix='homeproxy-current-node-') as tmp:
        script = Path(tmp) / 'current-node.uc'
        script.write_text(source)
        proc = subprocess.run(['ucode', str(script)], capture_output=True, text=True, timeout=90)
        if os.environ.get('HP_NODE_EVIDENCE'):
            target = Path(os.environ['HP_NODE_EVIDENCE'])
            target.with_name(target.stem + '-' + cases[0]['name'] + '.uc').write_text(source)
        if proc.returncode or proc.stderr:
            raise AssertionError(proc.stderr or proc.returncode)
        result = json.loads(proc.stdout)
    EVIDENCE.extend(result)
    if os.environ.get('HP_NODE_EVIDENCE'):
        Path(os.environ['HP_NODE_EVIDENCE']).write_text(json.dumps(EVIDENCE, indent=2, ensure_ascii=False))
    return result


class CurrentNode(unittest.TestCase):
    def test_generated_diversion_tag_reservations_match_current_node_rpc(self):
        nodes = [node('node1', 'domain-route_test-urltest'), node('node2', 'Ordinary')]
        groups = [{'.name': 'route_test', '.type': 'domain_route', 'enabled': '1',
                   'node': 'urltest', 'urltest_nodes': ['node1', 'node2'], 'domain_list': 'route.example\n'}]
        with ClientGenerator() as fixture:
            fixture.sections['config'].update(main_node='urltest', main_urltest_nodes=['node1', 'node2'])
            for n in nodes + groups:
                fixture.sections[n['.name']] = n
            generated = fixture.generate()
            tags = next(o['outbounds'] for o in generated['outbounds'] if o['tag'] == 'main-out')
        self.assertEqual(tags, ['domain-route_test-urltest (2)', 'Ordinary'])
        results = exercise([{'name': 'diversion-tag-' + str(i), 'nodes': nodes, 'groups': groups, 'tag': tag}
                            for i, tag in enumerate(tags)])
        self.assertEqual([r['actual']['active']['id'] for r in results], ['node1', 'node2'])
        for result in results:
            self.assert_equivalent(result)

    def assert_equivalent(self, result):
        self.assertEqual(result['actual'], result['original'], 'instrumented and untouched production method')
        self.assertEqual(result['actual'], result['expected'], 'legacy filter result')
        for field in ['load', 'get', 'get_all', 'curl', 'node_visits', 'label_probes', 'order', 'tags']:
            self.assertEqual(result['current'][field], result['legacy'][field], field)

    def test_first_middle_last_missing_count_and_full_registration(self):
        cases = []
        for size in [10, 1000, 5000]:
            nodes = [node('n' + str(i), 'Node ' + str(i)) for i in range(size)]
            for location, index in [('first', 0), ('middle', size // 2), ('last', size - 1), ('missing', None)]:
                cases.append({'name': f'{size}-{location}', 'nodes': nodes, 'repeats': 20,
                              'tag': 'unknown' if index is None else nodes[index]['label'],
                              'index': index})
        results = exercise(cases)
        for case, result in zip(cases, results):
            with self.subTest(case=case['name']):
                self.assert_equivalent(result)
                size, repeats, index = len(case['nodes']), case['repeats'], case['index']
                self.assertEqual(result['current']['node_visits'], size * repeats)
                self.assertEqual(result['current']['label_probes'], size * repeats)
                self.assertEqual(result['current']['load'], repeats)
                self.assertEqual(result['current']['curl'], repeats)
                self.assertEqual(result['legacy']['reverse_comparisons'], size * repeats)
                if not os.environ.get('HP_NODE_ALLOW_FULL_SCAN'):
                    self.assertEqual(result['current']['reverse_comparisons'],
                                     (size if index is None else index + 1) * repeats,
                                     'stop reverse lookup immediately at first matching key')

    def test_collision_reserved_special_fallback_and_fresh_registry(self):
        # Deliberately nonlexical/numeric IDs, unselected predecessors, suffix
        # collisions and labels resembling real section IDs / fallback tags.
        nodes = [node('10', 'direct-out'), node('2', 'direct-out (2)'),
                 node('z', 'direct-out'), node('a', 'main-out'),
                 node('later', 'tailscale-out'), node('empty', '  '),
                 node('fallback', 'cfg-empty-out'), node('same1', 'Duplicate'),
                 node('same2', 'Duplicate (2)'), node('same3', 'Duplicate'),
                 node('n1', '2'), node('n2', 'cfg-2-out'),
                 node('n3', '__proto__'), node('n4', 'constructor'),
                 node('n5', 'nil'), node('n6', 'same'),
                 node('n7', '<img src=x onerror="evil()"> & 中文')]
        tags = ['direct-out (2)', 'direct-out (2) (2)', 'direct-out (3)',
                'main-out (2)', 'tailscale-out (2)', 'cfg-empty-out',
                'cfg-empty-out (2)', 'Duplicate', 'Duplicate (2)', 'Duplicate (3)',
                '2', 'cfg-2-out', '__proto__', 'constructor', 'nil', 'same',
                '<img src=x onerror="evil()"> & 中文']
        cases = [{'name': 'special-' + str(i), 'nodes': nodes, 'tag': tag} for i, tag in enumerate(tags)]
        cases += [{'name': 'reserved-' + tag, 'nodes': nodes, 'tag': tag} for tag in ['direct-out', 'main-out', 'tailscale-out', 'missing']]
        # Updating between calls must construct a fresh registry, not a cache.
        cases += [{'name': 'fresh-rename', 'nodes': [node('10', 'Renamed')], 'tag': 'Renamed'},
                  {'name': 'fresh-remove', 'nodes': [], 'tag': 'Renamed'}]
        results = exercise(cases)
        for i, result in enumerate(results):
            with self.subTest(case=result['name']):
                self.assert_equivalent(result)
                if i < len(tags):
                    self.assertEqual(result['actual']['active']['id'], nodes[i]['.name'])
                    self.assertEqual(result['current']['tags'], dict(zip([n['.name'] for n in nodes], tags)))
                    if not os.environ.get('HP_NODE_ALLOW_FULL_SCAN'):
                        key_order = list(result['current']['tags'])
                        self.assertEqual(result['current']['reverse_comparisons'], key_order.index(nodes[i]['.name']) + 1)
        self.assertEqual(results[-2]['actual']['active']['id'], '10')
        self.assertIsNone(results[-1]['actual']['active']['id'])

    def test_static_disabled_api_failures_and_generator_tags(self):
        nodes = [node('unselected', 'same'), node('node1', 'same'), node('node2', 'main-out')]
        # Obtain controller labels from the complete production generator, not
        # a second hand-written tag builder. Include an unselected predecessor.
        with ClientGenerator() as fixture:
            fixture.sections.pop('node1')
            for n in nodes:
                fixture.sections[n['.name']] = n
            fixture.sections['config'].update(main_node='urltest', main_urltest_nodes=['node1', 'node2'])
            config = fixture.generate()
            controller_tags = next(o['outbounds'] for o in config['outbounds'] if o['tag'] == 'main-out')
        cases = [{'name': 'generated-' + str(i), 'nodes': nodes, 'tag': tag} for i, tag in enumerate(controller_tags)]
        cases += [{'name': 'static-' + mode, 'nodes': nodes, 'mode': mode} for mode in ['node1', 'nil', 'same', 'absent']]
        cases += [{'name': 'failure-' + failure, 'nodes': nodes, 'failure': failure, 'tag': 'same'} for failure in ['popen', 'malformed']]
        cases += [{'name': 'empty-tag', 'nodes': nodes, 'tag': ''}, {'name': 'no-port', 'nodes': nodes, 'port': '0', 'tag': 'same'}]
        results = exercise(cases)
        for result in results:
            self.assert_equivalent(result)
            if not result['name'].startswith('generated-'):
                self.assertEqual(result['current']['node_visits'], 0)
                self.assertEqual(result['current']['reverse_comparisons'], 0)
        self.assertEqual([r['actual']['active']['id'] for r in results[:len(controller_tags)]], ['node1', 'node2'])

    def test_waiting_for_selection_requires_a_successful_controller_reply(self):
        inputs = [
            ('controller down', {'failure': 'empty', 'status': 7}, 'clash_api_unavailable'),
            ('partial response', {'status': 18, 'tag': 'Selected'}, 'clash_api_unavailable'),
            ('invalid JSON', {'failure': 'malformed'}, 'clash_api_unavailable'),
            ('wrong value type', {'tag': 42}, 'clash_api_unavailable'),
            ('waiting', {'tag': ''}, 'missing_current_proxy'),
            ('selected', {'tag': 'Selected'}, None),
        ]
        cases = [{'name': name, 'nodes': [node('node1', 'Selected')], **fields}
                 for name, fields, _ in inputs]
        for result, (_, _, error) in zip(exercise(cases), inputs):
            with self.subTest(case=result['name']):
                self.assertEqual(result['actual']['error'], error)
                self.assertEqual(result['actual']['active']['id'], 'urltest' if error else 'node1')


if __name__ == '__main__':
    unittest.main()
