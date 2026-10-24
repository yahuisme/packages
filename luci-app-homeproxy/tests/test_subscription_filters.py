"""Production subscription filters in real ucode; count actual regexp builds."""
import json
import subprocess
from pathlib import Path
import unittest


APP = Path(__file__).resolve().parents[1]


class SubscriptionFilters(unittest.TestCase):
    def test_compile_each_pattern_once_per_update(self):
        source = (APP / 'root/etc/homeproxy/scripts/update_subscriptions.uc').read_text()
        filters = source[source.index('const invalid_filter_patterns ='):source.index('/* String helper end */')]
        # Only instrument the native compilation boundary; matching stays real.
        filters = filters.replace('regexp(', 'countedRegexp(')
        for mode, expected in [('blacklist', [True, False, True, False] * 4),
                               ('whitelist', [False, True, False, True] * 4),
                               ('disabled', [False] * 16)]:
            with self.subTest(mode=mode):
                program = '''const filter_mode=''' + json.dumps(mode) + ''';
const filter_keywords=['HK', '[invalid', '^US'];
let builds=0, logs=[];
function countedRegexp(pattern) { builds++; return regexp(pattern); }
function log(message) { push(logs,message); }
function isEmpty(value) { return !value || length(value)===0; }
''' + filters + '''
let results=[];
for(let i=0;i<4;i++) for(let name in ['HK fast','JP fast','US fast','SG fast'])
 push(results,filter_check(name));
print(sprintf('%J',{builds,logs,results}));
'''
                result = subprocess.run(['ucode', '-e', program], capture_output=True,
                                        text=True, check=True, timeout=10)
                data = json.loads(result.stdout)
                self.assertEqual(data['results'], expected)
                self.assertEqual(len(data['logs']), 0 if mode == 'disabled' else 1, data)
                self.assertEqual(data['builds'], 0 if mode == 'disabled' else 3,
                                 'compile valid and invalid patterns once, not per node')

    def test_repeated_patterns_and_empty_inputs(self):
        source = (APP / 'root/etc/homeproxy/scripts/update_subscriptions.uc').read_text()
        filters = source[source.index('const invalid_filter_patterns ='):source.index('/* String helper end */')]
        filters = filters.replace('regexp(', 'countedRegexp(')
        cases = [(['HK', 'HK', '[invalid', '[invalid'], ['HK fast', 'JP fast'], [True, False], 2, 1),
                 ([], ['HK fast'], [False], 0, 0),
                 (['HK'], ['', None], [False, False], 0, 0)]
        for keywords, names, expected, builds, logs in cases:
            with self.subTest(keywords=keywords, names=names):
                program = 'const filter_mode="blacklist"; const filter_keywords=' + json.dumps(keywords) + ''';
let builds=0, logs=[];
function countedRegexp(pattern) { builds++; return regexp(pattern); }
function log(message) { push(logs,message); }
function isEmpty(value) { return !value || length(value)===0; }
''' + filters + '\nprint(sprintf("%J",{results:map(' + json.dumps(names) + ', filter_check),builds,logs}));'
                result = subprocess.run(['ucode', '-e', program], capture_output=True,
                                        text=True, check=True, timeout=10)
                data = json.loads(result.stdout)
                self.assertEqual(data['results'], expected)
                self.assertEqual(data['builds'], builds)
                self.assertEqual(len(data['logs']), logs)


if __name__ == '__main__':
    unittest.main()
