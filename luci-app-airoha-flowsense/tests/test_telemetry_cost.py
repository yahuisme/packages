"""Bound collection work without reducing freshness; real tools, private paths."""
import json
import subprocess
import unittest
import test_settings as settings
import test_acceleration as acceleration


class TelemetryCostTest(unittest.TestCase):
    script = settings.SettingsTest.script
    knob = settings.SettingsTest.knob
    conf = settings.SettingsTest.conf
    call = settings.SettingsTest.call
    snapshot = settings.SettingsTest.snapshot
    setUp = settings.SettingsTest.setUp

    def test_jitter_single_parse_preserves_fields(self):
        log = self.d / 'parsers'
        for command, real in [('jsonfilter', 'jsonpath'), ('jshn', 'jshn')]:
            self.script(command, '#!/bin/sh\nprintf "%s\\n" "' + command + '" >> "' + str(log) + '"\nexec "' + str(acceleration.TOOLS / 'bin' / real) + '" "$@"\n')
        self.script('date', '#!/bin/sh\nprintf "1000\\n"\n')
        path = self.d / 'var/run/npu-jitter.json'
        value = dict(timestamp=1000, target='example.com', last_ping=0, deviation=0.25, samples=10, received=9, loss=10)
        path.write_text(json.dumps(value))
        before = self.snapshot()
        self.assertEqual(self.call('getOverview')['jitter'], value)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(len(log.read_text().splitlines()), 1, 'one JSON parse per sample')
        for field in ('last_ping', 'deviation', 'samples', 'received', 'loss'):
            for invalid in (None, True, {}, [], '01', '1\n2', '$(touch nope)', 'bad\"value'):
                path.write_text(json.dumps(dict(value, **{field: invalid})))
                result = self.call('getOverview')['jitter']
                self.assertIsNone(result[field], (field, invalid, result))
        for stamp in (979, 1001, None, 'invalid'):
            path.write_text(json.dumps(dict(value, timestamp=stamp)))
            self.assertIsNone(self.call('getOverview')['jitter'])
        for target in ('bad\"target', "a'; touch nope; #", 'a\nb'):
            path.write_text(json.dumps(dict(value, target=target)))
            self.assertEqual(self.call('getOverview')['jitter']['target'], 'unknown')
        path.write_text('{broken')
        self.assertIsNone(self.call('getOverview')['jitter'])
        path.unlink()
        self.assertIsNone(self.call('getOverview')['jitter'])


if __name__ == '__main__':
    unittest.main()
