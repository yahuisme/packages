"""Non-compiling portability contracts through the maintained exact-file runner.

The separately retained C event matcher is deliberately not selected: this gate
must not compile code. Native procd serialization remains covered here.
"""
import unittest
import test_portability


METHODS = (
    'test_dnsmasq_dependency',
    'test_renamed_uplink_dns',
    'test_ipv6_uplink_dns',
    'test_lowest_metric_uplink_dns',
    'test_policy_table_and_down_interface_ignored',
    'test_no_default_route_fallback',
    'test_default_stack_uses_core_capability_selection',
    'test_interface_trigger_not_named_wan',
)


def load_tests(loader, _tests, _pattern):
    return unittest.TestSuite(test_portability.Portability(name) for name in METHODS)


if __name__ == '__main__':
    unittest.main()
