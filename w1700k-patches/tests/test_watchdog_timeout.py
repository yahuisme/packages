#!/usr/bin/env python3
"""Pinned-source watchdog contracts; no C/firmware compilation or device I/O.

Fixture: https://github.com/openwrt/procd/blob/
fb6116870115a66686709017ecabfd724804bbdf/watchdog.c
The same procd revision is used by both firmware recipes. Tests apply the
production patch with native GNU patch, then inspect the actual C source.
Native libc primitives are additionally exercised on private files through
ctypes; the Python glue is an oracle, NOT execution of the patched C.
Neither layer executes procd, its ioctls or kernel C (including musl/ILP32).
Run: python3 w1700k-patches/tests/test_watchdog_timeout.py -v
"""
import ctypes
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
        for name in ["watchdog_open", "watchdog_set_stopped", "watchdog_set_drv_timeout"]:
            self.assertEqual(function(self.source, name), function(self.original, name))
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
                      "\t\twdt_timeout_set = true;\n", "\twatchdog_limit_default_timeout();\n"]:
            self.assertEqual(source.count(added), 1, added)
            source = source.replace(added, "", 1)
        # Includes frequency/heartbeat, WDTFD adoption, stop/start, all ioctls
        # and official GETTIMEOUT readback after a rejected explicit request.
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
