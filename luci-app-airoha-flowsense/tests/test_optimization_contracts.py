"""Regression guards for low-risk FlowSense efficiency improvements."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
DAEMON = (ROOT / 'root/usr/libexec/npu-jitter-daemon').read_text()
RPC = (ROOT / 'root/usr/libexec/rpcd/luci.airoha_flowsense').read_text()


class OptimizationContracts(unittest.TestCase):
    def test_jitter_history_is_replaced_by_bounded_window(self):
        self.assertIn('values=${result#*|}', DAEMON)
        self.assertIn('line=${result%%|*}', DAEMON)

    def test_interface_index_is_read_once_per_interface(self):
        self.assertIn('ifindex=$(fs_read "$dev/ifindex")', RPC)
        self.assertNotIn('fs_uint "$(fs_read "$dev/ifindex")" && fs_read "$dev/ifindex"', RPC)


if __name__ == '__main__':
    unittest.main()
