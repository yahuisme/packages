# hostapd DFS source fixtures

- Source: hostapd `831364bf02710ad09c2f27d3efa92abeeb5634c0`.
- Official archive: `https://sources.openwrt.org/hostapd-2026.08.07~831364bf.tar.zst`.
- Archive SHA256: `d1b9ca0e6aaaba928fc5d5b02c0084083e745a38ae1214d0e2dc5d1ea6d50393`.
- `pristine-dfs.c.gz` is the archive's `src/ap/dfs.c`.
- `official-prepared-dfs.c.gz` is the same file after the official hostapd src overlay and 185 package patches. Those inputs are byte-identical in the two distribution revisions listed in `manifest.json`.
- Gzip metadata is fixed with mtime zero. Compressed and source SHA256 values are recorded in `manifest.json`.

The test applies the actual one-line package patch and evaluates the unchanged C boolean expression with JS operators. The `is_6ghz_freq` helper result is an explicit fixture input; the helper itself is not reimplemented. This verifies guard composition and exact source preservation, not compiled hostapd, a running service or RF behavior. No firmware or C compilation is performed.
