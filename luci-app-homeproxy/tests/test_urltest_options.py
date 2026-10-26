"""URLTest uint16 contract through the complete production ucode generator."""
import unittest

from client_generator_fixture import ClientGenerator


class URLTestOptions(unittest.TestCase):
    def configure(self, fixture):
        fixture.sections['config'].update(main_node='urltest', main_urltest_nodes=['node1'])

    def test_tolerance_rejects_non_uint16_values(self):
        with ClientGenerator() as fixture:
            self.configure(fixture)
            for value in ['-1', '65536', '99999', '999999999999999999999999999999999999',
                          '1.5', '1e3', 'NaN', 'Infinity', ' 60', '60ms', '000060']:
                with self.subTest(value=value):
                    fixture.sections['config']['main_urltest_tolerance'] = value
                    with self.assertRaisesRegex(AssertionError, 'tolerance must be an integer from 0 to 65535'):
                        fixture.generate()

    def test_tolerance_boundaries_and_preserved_interval(self):
        with ClientGenerator() as fixture:
            self.configure(fixture)
            for value, expected in [(None, 60), ('', 60), ('0', 0), ('1', 1),
                                    ('00060', 60), ('65535', 65535)]:
                with self.subTest(value=value):
                    fixture.sections['config']['main_urltest_tolerance'] = value
                    config = fixture.generate()
                    outbound = next(o for o in config['outbounds'] if o['type'] == 'urltest')
                    self.assertEqual(outbound['interval'], '120s')
                    self.assertEqual(outbound['tolerance'], expected, 'zero is an explicit valid tolerance')
            fixture.sections['config'].update(main_urltest_interval='3600', main_urltest_tolerance='12')
            outbound = next(o for o in fixture.generate()['outbounds'] if o['type'] == 'urltest')
            self.assertEqual(outbound['interval'], '3600s')
            self.assertEqual(outbound['idle_timeout'], '7200s')
            self.assertEqual(outbound['tolerance'], 12)


if __name__ == '__main__':
    unittest.main()
