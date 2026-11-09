#!/usr/bin/env python3
"""No compilation: pinned-source patch replay and source contracts.

This suite does NOT execute kernel C or firmware. Wire-contract tests below
are independent Python oracles; source checks bind the C to those contracts.
Run: python3 w1700k-patches/tests/test_mcu_statistics.py -v
"""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "mcu_statistics"
PATCHES = ROOT / "tree/package/kernel/mt76/patches"
PATCH = PATCHES / "912-mt76-mt7996-use-mcu-station-statistics.patch"
COMMIT = "0936617dc529ff9da0385221d3fa6de732231177"


def function(source, name):
    start = source.index(name + "(")
    brace = source.index("{", start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[brace:end]


def decode_rssi(data, requested, wtbl_size=1088):
    """Independent vendor-ABI oracle, NOT execution of patched C."""
    if len(data) < 8:
        raise ValueError("short header")
    tag, length = struct.unpack_from("<HH", data, 4)
    if tag != 0 or length < 4 or length > len(data) - 4:
        raise ValueError("tag/length")
    payload = data[8:4 + length]
    if len(payload) % 8 or len(payload) // 8 > len(requested):
        raise ValueError("count/element")
    result = []
    seen = set()
    for offset in range(0, len(payload), 8):
        idx = struct.unpack_from("<H", payload, offset)[0]
        if idx >= min(wtbl_size, 1088) or idx not in requested or idx in seen:
            raise ValueError("WLAN ID")
        seen.add(idx)
        result.append((idx, tuple(payload[offset + 4:offset + 8])))
    return result


def rssi_wire(ids, rcpi=(100, 101, 255, 221)):
    entries = b"".join(struct.pack("<H2x4B", idx, *rcpi) for idx in ids)
    return bytes(4) + struct.pack("<HH", 0, 4 + len(entries)) + entries


class WireContract(unittest.TestCase):
    def test_per_sta_eight_byte_header_and_reordered_subset(self):
        self.assertEqual(decode_rssi(rssi_wire([91, 1]), [1, 40, 91]),
                         [(91, (100, 101, 255, 221)), (1, (100, 101, 255, 221))])
        self.assertEqual(decode_rssi(rssi_wire([]), [1]), [])
        self.assertEqual(decode_rssi(rssi_wire([0, 1087]), [0, 1087]),
                         [(0, (100, 101, 255, 221)), (1087, (100, 101, 255, 221))])

    def test_short_header_and_each_truncated_element_fail_closed(self):
        full = rssi_wire([1])
        for size in range(len(full)):
            with self.subTest(size=size), self.assertRaises(ValueError):
                decode_rssi(full[:size], [1])
        for length in [0, 1, 3, 5, 11, 13, 65535]:
            bad = full[:6] + struct.pack("<H", length) + full[8:]
            with self.subTest(length=length), self.assertRaises(ValueError):
                decode_rssi(bad, [1])

    def test_wrong_tag_duplicate_unsolicited_oversized_ids_and_count(self):
        bad_tag = rssi_wire([1])[:4] + struct.pack("<H", 7) + rssi_wire([1])[6:]
        for data, requested in [(bad_tag, [1]), (rssi_wire([1, 1]), [1, 2]),
                                (rssi_wire([2]), [1]), (rssi_wire([1088]), [1088]),
                                (rssi_wire([65535]), [65535]), (rssi_wire([1, 2]), [1])]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                decode_rssi(data, requested)

    def test_maximum_batch_and_zero_station_case(self):
        ids = list(range(90))
        self.assertEqual([idx for idx, _ in decode_rssi(rssi_wire(ids), ids)], ids)
        self.assertEqual(decode_rssi(rssi_wire([]), []), [])

    def test_raw_airtime_deltas_and_ac_mapping_oracle(self):
        # mac80211 VO, VI, BE, BK -> LMAC 3, 2, 1, 0 -> TID 6, 4, 0, 1.
        periods = [(10, 20, 30, 40), (3, 7, 0, 1), (0, 0, 0, 0)]
        totals = {6: 0, 4: 0, 0: 0, 1: 0}
        for values in periods:
            for ac, tid in enumerate([6, 4, 0, 1]):
                totals[tid] += values[3 - ac]
        self.assertEqual(totals, {6: 41, 4: 30, 0: 27, 1: 13})
        # The second interval can be smaller: subtracting the first is wrong.


class McuStatistics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="mt76-mcu-statistics-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.tree = Path(cls.temp.name)
        manifest = json.loads((FIXTURES / "manifest.json").read_text())
        assert manifest["commit"] == COMMIT
        for name, digest in manifest["references"].items():
            assert hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest() == digest
        archive = (FIXTURES / "mt76-pristine.tar.gz").read_bytes()
        assert hashlib.sha256(archive).hexdigest() == manifest["archive_sha256"]
        with tarfile.open(fileobj=io.BytesIO(gzip.decompress(archive))) as tf:
            assert set(tf.getnames()) == set(manifest["files"])
            for name, info in manifest["files"].items():
                stream = tf.extractfile(name)
                assert stream is not None
                data = stream.read()
                assert hashlib.sha256(data).hexdigest() == info["sha256"]
                blob = b"blob " + str(len(data)).encode() + b"\0" + data
                assert hashlib.sha1(blob).hexdigest() == info["git_blob"]
                path = cls.tree / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        cls.pristine = {name: (cls.tree / name).read_text() for name in manifest["files"]}
        cls.apply(next(PATCHES.glob("911-*.patch")))
        cls.power = (cls.tree / "mt7996/main.c").read_bytes()
        if PATCH.exists():
            cls.apply(PATCH)
        cls.source = {name: (cls.tree / name).read_text() for name in manifest["files"]}

    @classmethod
    def apply(cls, patch):
        result = subprocess.run(["patch", "--batch", "--fuzz=0",
                                 "--no-backup-if-mismatch", "-p1", "-i", str(patch)],
                                cwd=cls.tree, text=True, capture_output=True)
        assert result.returncode == 0, result.stdout + result.stderr
        assert "fuzz" not in result.stdout.lower(), result.stdout

    def test_mcu_errors_do_not_touch_rssi_and_cleanup_precedes_error_return(self):
        source = function(self.source["mt7996/mcu.c"], "mt7996_mcu_get_per_sta_info")
        send = source.index("ret = mt76_mcu_send_and_get_msg")
        header = source.index("res = (struct mt7996_mcu_per_sta_info_event *)")
        self.assertIn("if (ret)\n\t\t\treturn ret;", source[send:header])
        validation = source.index("bitmap_zero(seen, PER_STA_INFO_MAX_NUM)")
        update = source.index("msta_link->ack_signal = signal")
        self.assertLess(validation, update)
        self.assertIn("ret = 0;\nout:", source)
        self.assertRegex(source, r"out:\s*dev_kfree_skb\(skb\);\s*if \(ret\)\s*return ret;")
        self.assertEqual(source.count("mt76_mcu_send_and_get_msg"), 1)
        self.assertNotIn("mt76_rr", source)
        self.assertIn("wcid_idx = i", source)
        self.assertLess(source.index("rcu_read_unlock();"), send)

    def test_vendor_abi_evidence_and_donor_regression_are_preserved(self):
        vendor = (FIXTURES / "vendor-0065.fixture").read_text()
        header = vendor.split("+struct mt7996_mcu_per_sta_info_event {")[1].split("+\tunion {")[0]
        self.assertIn("+\t__le16 tag;", header)
        self.assertIn("+\t__le16 len;", header)
        self.assertNotIn("sta_num", header)
        self.assertNotIn("more", header)
        self.assertIn("wcid->stats.tx_airtime += tx_airtime", vendor)
        self.assertIn("tx_airtime = le32_to_cpu(res->airtime[i].tx[lmac_ac])", vendor)
        donor = (FIXTURES / "donor-0003.fixture").read_text()
        self.assertIn("+\t\tresp_sta_num = le16_to_cpu(res->sta_num)", donor)
        self.assertNotIn("+\t\telem_size = sizeof(res->airtime[0])", donor)
        self.assertIn("Joshua Klinesmith <joshuaklinesmith@gmail.com>", PATCH.read_text())
        self.assertIn("20260407104555.4342-1-joshuaklinesmith@gmail.com", PATCH.read_text())

    def test_all_sta_validates_whole_elements_before_rcu_updates(self):
        source = function(self.source["mt7996/mcu.c"], "mt7996_mcu_rx_all_sta_info_event")
        self.assertIn("(tag_len - sizeof(*res) + 4) % elem_size", source)
        self.assertIn("idx >= MT76_N_WCIDS", source)
        self.assertIn("test_and_set_bit(idx, seen)", source)
        self.assertLess(source.index("test_and_set_bit(idx, seen)"), source.index("rcu_read_lock()"))
        self.assertLess(source.index("rcu_read_lock()"), source.index("mt76_wcid_ptr"))
        self.assertGreater(source.index("rcu_read_unlock()"), source.index("ieee80211_sta_register_airtime"))

    def test_airtime_is_firmware_delta_microseconds_without_rescaling(self):
        all_sta = function(self.source["mt7996/mcu.c"], "mt7996_mcu_rx_all_sta_info_event")
        airtime = all_sta.split("case UNI_ALL_STA_TXRX_AIR_TIME: {")[1].split("default:")[0]
        self.assertIn("Firmware reports interval airtime in microseconds", airtime)
        self.assertIn("mt76_connac_lmac_mapping(ac)", airtime)
        self.assertIn("wcid_to_sta(wcid)", airtime)
        for ac, tid in [("BE", 0), ("BK", 1), ("VI", 4), ("VO", 6)]:
            self.assertIn(f"[IEEE80211_AC_{ac}] = {tid}", airtime)
        self.assertRegex(airtime, r"tx_cur = le32_to_cpu\(res->airtime\[i\].tx\[lmac_ac\]\);")
        self.assertRegex(airtime, r"rx_cur = le32_to_cpu\(res->airtime\[i\].rx\[lmac_ac\]\);")
        self.assertRegex(airtime, r"ieee80211_sta_register_airtime\(sta, ac_to_tid\[ac\],\s*tx_cur, rx_cur\);")
        self.assertNotIn("airtime_ac", airtime)
        self.assertNotRegex(airtime, r"tx_cur\s*[*/+-]=|rx_cur\s*[*/+-]=")
        self.assertIn("if (!tx_cur && !rx_cur)", airtime)

    def test_rssi_invalid_chains_and_missing_link_preserve_ewma(self):
        per_sta = function(self.source["mt7996/mcu.c"], "mt7996_mcu_get_per_sta_info")
        for token in ["wcid->link_id >= IEEE80211_MLD_MAX_NUM_LINKS", "if (!mlink)",
                      "if (!mphy)", "res->rssi[i].rcpi[j] > 220", "chain_mask &= ~BIT(j)",
                      "if (!chain_mask)", "signal > 0 || signal <= -128"]:
            self.assertIn(token, per_sta)
        self.assertLess(per_sta.index("if (!mphy)"), per_sta.index("ewma_avg_signal_add"))
        self.assertIn("(res->rssi[i].rcpi[j] - 220) / 2", per_sta)
        self.assertIn("mt76_rx_signal(chain_mask, rssi)", per_sta)

    def test_no_mmio_polling_and_single_device_query_per_period(self):
        mac = self.source["mt7996/mac.c"]
        self.assertNotIn("mt7996_mac_sta_poll", mac)
        self.assertNotIn("mt76_wcid_add_poll", mac)
        self.assertNotIn("airtime_ac", self.source["mt7996/mt7996.h"])
        work = function(mac, "mt7996_mac_work")
        self.assertIn("++mphy->mac_work_count == 5", work)
        self.assertIn("if (i == mphy->band_idx)", work)
        self.assertIn("test_bit(MT76_STATE_RUNNING, &other->state)", work)
        self.assertLess(work.index("mutex_lock"), work.index("UNI_ALL_STA_TXRX_AIR_TIME"))
        self.assertLess(work.index("UNI_PER_STA_RSSI"), work.index("mutex_unlock"))
        self.assertEqual(work.count("UNI_ALL_STA_TXRX_AIR_TIME"), 1)
        self.assertEqual(work.count("UNI_PER_STA_RSSI"), 1)
        self.assertIn("sta_num < PER_STA_INFO_MAX_NUM", self.source["mt7996/mcu.c"])

    def test_response_headers_lengths_counts_and_identity(self):
        all_sta = function(self.source["mt7996/mcu.c"], "mt7996_mcu_rx_all_sta_info_event")
        self.assertIn("tag_len = le16_to_cpu(res->len)", all_sta)
        self.assertIn("tag_len > skb->len - 4", all_sta)
        self.assertIn("sta_num > (tag_len - sizeof(*res) + 4) / elem_size", all_sta)
        self.assertIn("sta_num > mt7996_wtbl_size(dev)", all_sta)
        self.assertLess(all_sta.index("skb->len < sizeof(*res)"), all_sta.index("res->sta_num"))
        per_sta = function(self.source["mt7996/mcu.c"], "mt7996_mcu_get_per_sta_info")
        self.assertLess(per_sta.index("skb->len < sizeof(*res)"), per_sta.index("res->len"))
        for token in ["le16_to_cpu(res->tag) != tag", "resp_sta_num > sta_num",
                      "payload_len % sizeof(res->rssi[0])", "test_and_set_bit(j, seen)",
                      "req.wlan_idx[j]", "wlan_idx >= mt7996_wtbl_size(dev)"]:
            self.assertIn(token, per_sta)
        self.assertNotIn("res->sta_num", per_sta)
        header = self.source["mt7996/mcu.h"].split("struct mt7996_mcu_per_sta_info_event {")[1].split("union {")[0]
        self.assertNotIn("sta_num", header, "PER_STA RSSI uses an 8-byte TLV header, not ALL_STA's 16-byte header")
        self.assertNotIn("more", header)
        self.assertIn("goto out", per_sta)
        self.assertIn("dev_kfree_skb(skb)", per_sta)

    def test_airtime_reaches_element_dispatch_after_911(self):
        self.assertTrue(PATCH.exists(), "912 MCU statistics patch is missing")
        source = function(self.source["mt7996/mcu.c"], "mt7996_mcu_rx_all_sta_info_event")
        dispatch = source[:source.index("for (i = 0;")]
        self.assertRegex(dispatch, r"case UNI_ALL_STA_TXRX_AIR_TIME:\s*elem_size = sizeof\(res->airtime\[0\]\);")
        self.assertEqual((self.tree / "mt7996/main.c").read_bytes(), self.power)


if __name__ == "__main__":
    unittest.main()
