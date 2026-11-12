#!/usr/bin/env python3
"""Pinned-source watchdog contracts; no C/firmware compilation or device I/O.

Fixture: https://github.com/openwrt/procd/blob/
fb6116870115a66686709017ecabfd724804bbdf/{watchdog.c,system.c}
The same procd revision is used by both firmware recipes. The timer fixture
is libubox a396f38a8568a1d670c240465cd8d24fdfdf6463/uloop.c, also shared
by the two pinned firmware recipes. Tests apply the
production patch with native GNU patch, then inspect the actual C source.
Native libc primitives are additionally exercised on private files through
ctypes. The source-bound Python protocol oracle never executes the patched
C, timers, ioctls or kernel C; neither layer covers target musl/ILP32.
Run: python3 w1700k-patches/tests/test_watchdog_timeout.py -v
"""
import ctypes
import importlib.util
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATCH = ROOT / "tree/package/system/procd/patches/001-watchdog-clamp-default-to-device-limit.patch"
FIXTURE = Path(__file__).parent / "fixtures/watchdog/watchdog.c.fixture"
SHA256 = "d58e6783c988dc5217cedbf2056ee647a8a5d8e25a69c79c9cbed25019a88f88"
GIT_BLOB = "6d40d68b8aac03d494d291d1dcb40bc5af9838d8"


def function(source, name):
    """Return a complete top-level C function, not an earlier call site."""
    import re
    match = re.search(r"^(?:static )?(?:void|int|bool|char\*) " + re.escape(name)
                      + r"\([^\n]*\)\n\{", source, re.M)
    if not match:
        raise AssertionError(f"missing source function: {name}")
    end = source.index("\n}", match.end()) + 2
    return source[match.start():end]


class NativeLimitOracle:
    """Real host-libc I/O/conversion; Python glue, not compiled watchdog C."""
    def __init__(self):
        self.libc = ctypes.CDLL(None, use_errno=True)
        signatures = {
            "fopen": ([ctypes.c_char_p, ctypes.c_char_p], ctypes.c_void_p),
            "fgets": ([ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p], ctypes.c_void_p),
            "fgetc": ([ctypes.c_void_p], ctypes.c_int),
            "ferror": ([ctypes.c_void_p], ctypes.c_int),
            "fclose": ([ctypes.c_void_p], ctypes.c_int),
            "strtoul": ([ctypes.c_void_p, ctypes.POINTER(ctypes.c_char_p), ctypes.c_int],
                        ctypes.c_ulong),
        }
        for name, (args, result) in signatures.items():
            func = getattr(self.libc, name)
            func.argtypes, func.restype = args, result

    def limit(self, path, current=30):
        fp = self.libc.fopen(bytes(path), b"r")
        if not fp:
            return current
        try:
            buf = ctypes.create_string_buffer(32)
            if (not self.libc.fgets(buf, len(buf), fp) or
                    self.libc.fgetc(fp) != -1 or self.libc.ferror(fp)):
                return current
            end = ctypes.c_char_p()
            ctypes.set_errno(0)
            value = self.libc.strtoul(buf, ctypes.byref(end), 10)
            error = ctypes.get_errno()
            end_address = ctypes.cast(end, ctypes.c_void_p).value
            if end_address is None:
                raise AssertionError("strtoul did not return an end pointer")
            offset = end_address - ctypes.addressof(buf)
            if (not error and b"0" <= buf.raw[:1] <= b"9" and
                    buf.raw[offset:offset + 2] == b"\n\0" and 0 < value < current):
                return value
            return current
        finally:
            self.libc.fclose(fp)


class WatchdogTimeout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = FIXTURE.read_bytes()
        assert hashlib.sha256(data).hexdigest() == SHA256, "official source SHA256 mismatch"
        blob = b"blob " + str(len(data)).encode() + b"\0" + data
        assert hashlib.sha1(blob).hexdigest() == GIT_BLOB, "official Git blob mismatch"
        cls.original = data.decode()
        cls.temp = tempfile.TemporaryDirectory(prefix="watchdog-timeout-")
        cls.addClassCleanup(cls.temp.cleanup)
        target = Path(cls.temp.name) / "watchdog.c"
        target.write_bytes(data)
        # Missing production patch exposes the real upstream source for RED.
        if PATCH.exists():
            result = subprocess.run(
                ["patch", "-p1", "--batch", "--forward", "--fuzz=0",
                 "--no-backup-if-mismatch", "-i", str(PATCH)],
                cwd=cls.temp.name, text=True, capture_output=True)
            assert result.returncode == 0, result.stdout + result.stderr
            assert "fuzz" not in result.stdout.lower(), result.stdout
            assert "offset" not in result.stdout.lower(), result.stdout
        cls.source = target.read_text()
        directory = FIXTURE.parent
        system = (directory / "system.c.fixture").read_bytes()
        assert hashlib.sha256(system).hexdigest() == (
            "e8ca33a4c48d6d3fce27f54f6f2a55e6e1b4db01ccee8c8e31f5bd347523beb6"
        ), "official system.c SHA256 mismatch"
        blob = b"blob " + str(len(system)).encode() + b"\0" + system
        assert hashlib.sha1(blob).hexdigest() == "8c7fc071762e95ed002b3926ef9d454d9bddd31e"
        cls.system = system.decode()
        spec = importlib.util.spec_from_file_location(
            "watchdog_frequency_contract", directory / "frequency_contract.py")
        assert spec is not None and spec.loader is not None
        cls.contract = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.contract)

    def oracle(self, **kwargs):
        # An independent protocol oracle is useful only while the complete
        # production setter/callback and unmodified caller contracts match.
        self.assertEqual(function(self.source, "watchdog_timeout_cb"),
                         self.contract.TIMEOUT_CALLBACK)
        return self.contract.ProtocolOracle(self.source, function, **kwargs)

    def test_rejected_ubus_timeout_reconciles_actual_timeout_and_pending_timer(self):
        # Same immutable procd revision: system.c chooses frequency BEFORE
        # watchdog_timeout(). Only the latter can see a rejected driver's value.
        self.assertLess(self.system.index("\t\twatchdog_frequency(freq);"),
                        self.system.index("\t\twatchdog_timeout(timeout);"))
        oracle = self.oracle()
        oracle.ubus(timeout=60, frequency=30, accepted=None, readback=28)
        self.assertEqual(oracle.calls, [("SETTIMEOUT", 60), ("GETTIMEOUT",)])
        self.assertEqual((oracle.actual, oracle.timeout, oracle.frequency), (28, 28, 14))
        self.assertEqual((oracle.pings, oracle.delay_ms), (1, 14000))
        self.assertLess(oracle.delay_ms, oracle.actual * 1000)

    def test_one_second_driver_limit_uses_a_subsecond_ping(self):
        callback = function(self.source, "watchdog_timeout_cb")
        self.assertIn("wdt_drv_timeout == 1 ? 500 : wdt_frequency * 1000", callback,
                      "one second is the smallest frequency API value, not a safe 1s heartbeat")

    def test_timeout_only_acceptance_and_rejection_use_driver_value(self):
        for accepted, readback, expected_timeout, expected_frequency in [
                (8, None, 8, 4), (12, None, 12, 5),
                (None, 4, 4, 2), (None, 28, 28, 5)]:
            with self.subTest(accepted=accepted, readback=readback):
                oracle = self.oracle()
                oracle.ubus(timeout=12, accepted=accepted, readback=readback)
                self.assertEqual((oracle.timeout, oracle.frequency),
                                 (expected_timeout, expected_frequency))
                self.assertEqual(oracle.delay_ms, expected_frequency * 1000)
                self.assertEqual(oracle.pings, 1)
                self.assertLess(oracle.delay_ms, oracle.actual * 1000)

    def test_failed_or_nonpositive_readback_is_not_an_actual_timeout(self):
        for readback in [None, 0, -1]:
            with self.subTest(readback=readback):
                oracle = self.oracle()
                oracle.ubus(timeout=60, frequency=30, readback=readback)
                # Current hardware state remains unknown, but the failed
                # request must not replace the last confirmed timeout bound.
                self.assertIsNone(oracle.actual)
                self.assertEqual((oracle.timeout, oracle.frequency), (28, 14))
                self.assertEqual((oracle.pings, oracle.delay_ms), (1, 14000))
                self.assertEqual(oracle.calls, [("SETTIMEOUT", 60), ("GETTIMEOUT",)])

    def test_offline_explicit_request_survives_init_and_restart(self):
        for accepted, readback, expected in [(60, None, (60, 30)),
                                             (None, 28, (28, 14))]:
            with self.subTest(accepted=accepted, readback=readback):
                oracle = self.oracle()
                oracle.online, oracle.pending, oracle.delay_ms = False, False, None
                oracle.ubus(timeout=60, frequency=30)
                self.assertTrue(oracle.explicit)
                self.assertEqual(oracle.calls, [])
                self.assertEqual((oracle.timeout, oracle.frequency), (60, 30))
                # watchdog_limit_default_timeout's pinned explicit guard skips
                # the sysfs cap; both init and restart call the same setter.
                oracle.online = True
                oracle.driver_set(accepted, readback)
                self.assertEqual(oracle.pings, 0, "do not activate a stopped timer in the setter")
                oracle.ping_and_arm()  # unchanged init/restart callback
                self.assertEqual((oracle.timeout, oracle.frequency), expected)
                self.assertEqual(oracle.pings, 1)
                self.assertLess(oracle.delay_ms, oracle.actual * 1000)

    def test_default_28_5_and_small_device_limits_have_safe_intervals(self):
        for timeout, frequency, delay in [(28, 5, 5000), (5, 2, 2000),
                                          (4, 2, 2000), (3, 1, 1000),
                                          (2, 1, 1000), (1, 1, 500)]:
            with self.subTest(timeout=timeout):
                oracle = self.oracle(timeout=timeout, pending=False)
                oracle.driver_set(accepted=timeout)
                oracle.ping_and_arm()
                self.assertEqual((oracle.timeout, oracle.frequency, oracle.delay_ms),
                                 (timeout, frequency, delay))
                self.assertLess(oracle.delay_ms, timeout * 1000)

    def test_rearm_replaces_pending_uloop_timer(self):
        # Both shipped distro libubox recipes pin this same revision. The
        # callback pings first: merely resetting a deadline could postpone a
        # heartbeat relative to the previous write when timeout gets shorter.
        data = (FIXTURE.parent / "uloop.c.fixture").read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(),
                         "5810bf4dd7c1df588e62bc807d5b0858f1c15514547796714a47d7544e72ac77")
        setter = function(data.decode(), "uloop_timeout_set")
        self.assertIn("if (timeout->pending)\n\t\tuloop_timeout_cancel(timeout);", setter)
        self.assertLess(setter.index("uloop_timeout_cancel(timeout)"),
                        setter.index("uloop_gettime(time)"))
        self.assertIn("return uloop_timeout_add(timeout);", setter)
        self.assertLess(self.contract.TIMEOUT_CALLBACK.index("watchdog_ping();"),
                        self.contract.TIMEOUT_CALLBACK.index("uloop_timeout_set("))

    def test_frequency_only_request_keeps_the_pinned_caller_guard(self):
        # watchdog_frequency() is not a ubus method: system.c is its only
        # writer and bounds frequency-only calls against the cached timeout.
        # Do not clamp the low-level setter against the OLD timeout: system.c
        # also calls it before a combined request for a larger timeout.
        for frequency, expected in [(30, 14), (3, 3), (0, 5)]:
            with self.subTest(frequency=frequency):
                oracle = self.oracle()
                oracle.ubus(frequency=frequency)
                self.assertEqual(oracle.frequency, expected)
                self.assertEqual(oracle.calls, [], "frequency-only must not set a timeout")
                self.assertEqual((oracle.pings, oracle.delay_ms), (0, 5000))
                oracle.ping_and_arm()  # existing pending timer fires normally
                self.assertEqual(oracle.delay_ms, expected * 1000)
                self.assertLess(oracle.delay_ms, oracle.actual * 1000)
        oracle = self.oracle()
        oracle.ubus(timeout=60, frequency=30, accepted=60)
        self.assertEqual((oracle.timeout, oracle.frequency, oracle.delay_ms),
                         (60, 30, 30000), "preserve a valid larger explicit request")
        self.assertEqual(function(self.source, "watchdog_frequency"),
                         function(self.original, "watchdog_frequency"))

    def test_stop_resume_reconciles_without_losing_the_explicit_request(self):
        oracle = self.oracle()
        oracle.ubus(timeout=60, frequency=30, accepted=60)
        oracle.online, oracle.pending, oracle.delay_ms = False, False, None
        before = oracle.pings
        oracle.online = True
        oracle.driver_set(accepted=None, readback=28)
        self.assertEqual(oracle.pings, before)
        oracle.ping_and_arm()  # original resume callback, after setter
        self.assertEqual((oracle.timeout, oracle.frequency, oracle.delay_ms),
                         (28, 14, 14000))
        self.assertTrue(oracle.explicit)
        self.assertEqual(oracle.calls,
                         [("SETTIMEOUT", 60), ("SETTIMEOUT", 60), ("GETTIMEOUT",)])

    def test_unknown_timeout_uses_last_confirmed_bound_after_both_ioctls_fail(self):
        oracle = self.oracle()
        oracle.ubus(timeout=60, frequency=30, accepted=None, readback=None)
        self.assertIsNone(oracle.actual, "failed ioctls do not confirm the current hardware timeout")
        self.assertEqual(oracle.last_timeout, 28)
        oracle.ping_and_arm()
        self.assertEqual((oracle.timeout, oracle.frequency, oracle.delay_ms), (28, 14, 14000))
        oracle.ubus(frequency=30)
        self.assertEqual(oracle.frequency, 14, "failed request must not loosen frequency-only guard")

    def test_never_confirmed_timeout_stays_unknown(self):
        oracle = self.oracle(timeout=30, confirmed=False)
        oracle.ubus(timeout=60, frequency=30, accepted=None, readback=None)
        self.assertIsNone(oracle.actual)
        self.assertEqual(oracle.last_timeout, 0)
        self.assertEqual(oracle.pings, 0)
        # With no successful observation there is no hardware bound to invent.
        self.assertEqual((oracle.timeout, oracle.frequency), (60, 30))

    def test_negative_source_mutants_cannot_bypass_reconciliation(self):
        source = self.source
        mutants = {
            "omit-frequency-clamp": ("\tif (wdt_frequency > timeout / 2)\n\t\twdt_frequency = timeout / 2;\n", ""),
            "trust-request-after-readback-failure": (
                "\t\tif (ioctl(wdt_fd, WDIOC_GETTIMEOUT, &timeout) || timeout <= 0)\n\t\t\ttimeout = wdt_last_timeout;",
                "\t\tioctl(wdt_fd, WDIOC_GETTIMEOUT, &timeout);"),
            "forget-last-confirmed-timeout": ("\twdt_last_timeout = timeout;\n", ""),
            "accept-nonpositive-timeout": ("\tif (timeout <= 0)\n\t\treturn -1;\n", ""),
            "omit-pending-rearm": ("\tif (wdt_timeout.pending)\n\t\twatchdog_timeout_cb(&wdt_timeout);\n", ""),
            "restart-stopped-timer": ("\tif (wdt_timeout.pending)\n\t\twatchdog_timeout_cb(&wdt_timeout);",
                                      "\twatchdog_timeout_cb(&wdt_timeout);"),
            "one-second-ping-is-too-late": ("wdt_drv_timeout == 1 ? 500 : wdt_frequency * 1000",
                                             "wdt_frequency * 1000"),
        }
        for name, (old, new) in mutants.items():
            with self.subTest(mutant=name):
                self.assertEqual(source.count(old), 1)
                changed = source.replace(old, new, 1)
                with self.assertRaises(AssertionError):
                    self.assertEqual(function(changed, "watchdog_timeout_cb"),
                                     self.contract.TIMEOUT_CALLBACK)
                    self.contract.ProtocolOracle(changed, function)

    def test_default_is_limited_before_initial_settimeout(self):
        init = function(self.source, "watchdog_init")
        self.assertIn("watchdog_limit_default_timeout();", init,
                      "default must be limited before requesting 30s from the driver")
        self.assertLess(init.index("if (watchdog_open(!preinit) < 0)"),
                        init.index("watchdog_limit_default_timeout();"))
        self.assertLess(init.index("watchdog_limit_default_timeout();"),
                        init.index("watchdog_set_drv_timeout();"))
        limit = function(self.source, "watchdog_limit_default_timeout")
        self.assertIn('fopen("/sys/class/watchdog/watchdog0/max_timeout", "r")', limit)
        self.assertIn("wdt_drv_timeout = max_timeout;", limit)

    def test_explicit_request_survives_later_init_and_stop_start(self):
        self.assertIn("static bool wdt_timeout_set = false;", self.source,
                      "a deferred explicit request needs state separate from the cached timeout")
        requested = function(self.source, "watchdog_timeout")
        original = function(self.original, "watchdog_timeout")
        self.assertEqual(requested, original.replace(
            "\t\twdt_drv_timeout = timeout;",
            "\t\twdt_drv_timeout = timeout;\n\t\twdt_timeout_set = true;", 1))
        limit = function(self.source, "watchdog_limit_default_timeout")
        self.assertIn("if (wdt_timeout_set)\n\t\treturn;", limit)
        self.assertLess(limit.index("if (wdt_timeout_set)"), limit.index("fopen("))
        # Both deferred requests (fd < 0) and live requests take the official
        # setter path; restart must neither clear the flag nor re-clamp them.
        for name in ["watchdog_open", "watchdog_set_stopped"]:
            self.assertEqual(function(self.source, name), function(self.original, name))
        self.assertEqual(function(self.source, "watchdog_set_drv_timeout"),
                         self.contract.DRIVER_SETTER)
        self.assertEqual(self.source.count("wdt_timeout_set = true;"), 1)
        self.assertEqual(self.source.count("wdt_timeout_set = false;"), 1)

    def test_malformed_limit_cannot_wrap_or_partially_parse_into_a_short_timeout(self):
        limit = function(self.source, "watchdog_limit_default_timeout")
        self.assertNotIn("fscanf", limit,
                         "%u accepts signs and cannot report numeric overflow reliably")
        self.assertIn("char buf[32], *end;", limit)
        self.assertIn("unsigned long max_timeout;", limit)
        self.assertIn("fgets(buf, sizeof(buf), fp)", limit)
        self.assertIn("fgetc(fp) == EOF", limit)
        self.assertIn("!ferror(fp)", limit)
        self.assertIn("errno = 0;", limit)
        self.assertIn("max_timeout = strtoul(buf, &end, 10);", limit)
        self.assertIn("!errno && buf[0] >= '0' && buf[0] <= '9'", limit)
        self.assertIn("*end == '\\n' && !end[1]", limit)
        self.assertIn("max_timeout && max_timeout < wdt_drv_timeout", limit)
        self.assertLess(limit.index("errno = 0;"), limit.index("strtoul("))
        self.assertLess(limit.index("ferror(fp)"), limit.index("wdt_drv_timeout = max_timeout;"))
        self.assertIn(
            "\t\tif (fgets(buf, sizeof(buf), fp) && fgetc(fp) == EOF && !ferror(fp)) {\n"
            "\t\t\terrno = 0;\n"
            "\t\t\tmax_timeout = strtoul(buf, &end, 10);\n"
            "\t\t\tif (!errno && buf[0] >= '0' && buf[0] <= '9' &&\n"
            "\t\t\t    *end == '\\n' && !end[1] &&\n"
            "\t\t\t    max_timeout && max_timeout < wdt_drv_timeout)\n"
            "\t\t\t\twdt_drv_timeout = max_timeout;\n"
            "\t\t}\n\t\tfclose(fp);", limit)
        self.assertIn("#include <errno.h>", self.source)
        self.assertIn("#include <stdlib.h>", self.source)

    def test_all_other_source_bytes_remain_official(self):
        source = self.source
        helper = function(source, "watchdog_limit_default_timeout")
        self.assertEqual(source.count(helper), 1)
        source = source.replace(helper + "\n\n", "", 1)
        for added in ["#include <errno.h>\n", "#include <stdio.h>\n",
                      "#include <stdlib.h>\n", "static bool wdt_timeout_set = false;\n",
                      "static int wdt_last_timeout = 0;\n",
                      "\t\twdt_timeout_set = true;\n", "\twatchdog_limit_default_timeout();\n"]:
            self.assertEqual(source.count(added), 1, added)
            source = source.replace(added, "", 1)
        # Only these two complete, separately asserted functions may differ
        # in addition to the pre-existing default-limit/explicit-request delta.
        for name, expected in [("watchdog_set_drv_timeout", self.contract.DRIVER_SETTER),
                               ("watchdog_timeout_cb", self.contract.TIMEOUT_CALLBACK)]:
            actual = function(source, name)
            self.assertEqual(actual, expected)
            self.assertEqual(source.count(actual), 1)
            source = source.replace(actual, function(self.original, name), 1)
        # WDTFD adoption, stop/start and every other unlisted byte are immutable.
        self.assertEqual(source, self.original)


class NativeLibcLimits(unittest.TestCase):
    def test_native_file_conversion_valid_invalid_and_overflow_limits(self):
        oracle = NativeLimitOracle()
        ulong_max = ctypes.c_ulong(-1).value
        cases = [(b"28\n", 28), (b"1\n", 1), (b"29\n", 29),
                 (b"30\n", 30), (b"60\n", 30), (b"0\n", 30),
                 (b"", 30), (b"\n", 30), (b"28", 30),
                 (b"-1\n", 30), (b"-4294967268\n", 30), (b"+28\n", 30),
                 (b" 28\n", 30), (b"28 \n", 30), (b"28junk\n", 30),
                 (b"28\nextra", 30), (b"28\n\n", 30), (b"28\r\n", 30),
                 (b"4294967324\n", 30), (str(ulong_max).encode() + b"\n", 30),
                 (str(ulong_max + 1).encode() + b"\n", 30), (b"9" * 128 + b"\n", 30)]
        with tempfile.TemporaryDirectory(prefix="watchdog-native-libc-") as tmp:
            path = Path(tmp) / "max_timeout"
            for data, expected in cases:
                with self.subTest(data=data):
                    path.write_bytes(data)
                    self.assertEqual(oracle.limit(path), expected)
            self.assertEqual(oracle.limit(Path(tmp) / "missing"), 30)
            # fopen may succeed on a directory; the subsequent read fails.
            self.assertEqual(oracle.limit(Path(tmp)), 30)
            path.write_bytes(b"28\n")
            self.assertEqual(oracle.limit(path, current=24), 24)


if __name__ == "__main__":
    unittest.main(verbosity=2)
