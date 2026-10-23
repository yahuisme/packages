"""Regression guards for audited HomeProxy safety boundaries."""
from pathlib import Path
import unittest


APP = Path(__file__).resolve().parents[1]
RPC = (APP / 'root/usr/share/rpcd/ucode/luci.homeproxy').read_text()
RESOURCES = (APP / 'root/etc/homeproxy/scripts/update_resources.sh').read_text()
FIREWALL = (APP / 'root/etc/homeproxy/scripts/firewall_pre.uc').read_text()
INIT = (APP / 'root/etc/init.d/homeproxy').read_text()


class AuditRegressions(unittest.TestCase):
    def test_latency_probe_allocates_unique_session_directory(self):
        self.assertIn("mkdtemp(`${runtime_root}/session.XXXXXX`)", RPC)
        self.assertIn("if (!session_dir)", RPC)

    def test_resource_downloads_have_a_size_limit(self):
        self.assertIn('--max-filesize', RESOURCES)
        self.assertIn('DOWNLOAD_MAX_BYTES', RESOURCES)

    def test_firewall_generation_validates_persisted_server_values(self):
        self.assertIn("/^[0-9]+$/", FIREWALL)
        self.assertIn("server.port", FIREWALL)
        self.assertIn("server.network", FIREWALL)

    def test_clear_firewall_propagates_file_truncate_failure(self):
        self.assertIn(': > "$RUN_DIR/fw4_input.nft" || return 1', INIT)


if __name__ == '__main__':
    unittest.main()
