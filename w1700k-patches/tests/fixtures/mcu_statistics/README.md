# MCU statistics fixture and verification boundary

- Official source: https://github.com/openwrt/mt76 at
  `0936617dc529ff9da0385221d3fa6de732231177`.
- `mt76-pristine.tar.gz` contains six unchanged real files (the five 912
  targets and `mt7996/main.c` for preceding 911 replay). The manifest pins
  archive SHA256, per-file SHA256 and Git blob IDs. All six were also
  checked against the immutable official raw URLs during implementation.
  Tests require only Python's standard library and GNU patch, no network,
  local Git history, private paths, compiler or firmware build.
- `donor-0003.fixture` preserves Joshua Klinesmith's v3 message
  `20260407104555.4342-1-joshuaklinesmith@gmail.com` as received.
- `vendor-0065.fixture` preserves MediaTek's ABI/semantics reference at
  feeds commit `00a8c1e85ec32003d9260ea34bc9ecbc15e8d4a8`; the exact URL and
  SHA256 are in `manifest.json`. Unlike ALL_STA, its PER_STA RSSI response
  has an **8-byte** fixed header with tag/len, no count or `more` field.
  The vendor accumulates each AIRTIME value directly and passes it to
  mac80211: this supports interval microseconds, not host-side subtraction
  of successive counters. It is source evidence, not W1700K FW telemetry.
- Reference diffs deliberately use `.fixture`, not `.patch`, so broad
  production payload enumeration cannot install them.

## TDD record

Actual terminal executions during implementation:

1. RED: missing 912 failed `test_airtime_reaches_element_dispatch_after_911`.
   GREEN: refreshed donor plus AIR_TIME element-size dispatch passed.
2. RED: response validation test failed for missing TLV length checks.
   GREEN: fixed PER_STA ABI, fixed/header/TLV/count/WLAN ID validation and
   pre-update duplicate validation passed.
3. RED: RSSI guard and single-device polling tests both failed.
   GREEN: invalid-chain/missing-link no-update guards and first-running-PHY
   polling passed.
4. Airtime semantics source check failed on missing explicit contract
   annotation, then passed; raw value mapping already matched the vendor.
   This cycle verifies the documented source contract, not a newly fixed
   firmware unit bug.
5. RED: ALL_STA whole-element contract failed for missing remainder check.
   GREEN: partial-element rejection passed.
6. Supplemental immutable-reference checks, Python wire-contract oracles,
   error-path source-order checks and fixture hash verification passed.

Final command:

    python3 w1700k-patches/tests/test_mcu_statistics.py -v

13 tests passed; standard unittest discovery also ran the same 13 cases.
911 -> 912 -> 913 applied in order using GNU patch `--fuzz=0`, with no
`.orig`/`.rej`; 912 did not alter 911's main.c output. The 913 offset is
expected after removing the WTBL polling function.

Prebuilt tree-sitter wheels (no source build) parsed all three affected
functions without syntax errors after parser-boundary removal of
`__packed` and replacement of type-taking `container_of` macro arguments.
Whole-file parsing without the kernel preprocessor is noisy on pristine
source too; this is not C type checking or compilation.

## Not verified

No C execution, kernel type/ABI compilation, firmware build, hardware boot,
RF/throughput measurement or device lifetime stress was performed. The
Python packet oracle does not execute the patched driver. W1700K firmware
header layout, interval/reset behavior and units, missing-response loss,
RSSI freshness and multi-radio/MLO behavior need device acceptance. A
malformed response is dropped without MMIO fallback; lost clear-on-read
airtime cannot be recovered by this host parser. RSSI batches completed
before a later batch failure retain their updates. No 0006 token reclamation
is introduced. No commit or push was performed.
