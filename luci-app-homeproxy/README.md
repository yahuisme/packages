# HomeProxy local regression notes

Run from the repository root:

```sh
python3 luci-app-homeproxy/tests/run.py
```

No package build, commit, push, router service, firewall, or external connection is
performed by this suite. `normalize-po.py` is an explicit maintenance command,
not part of the test runner. It keeps the later corrected translation and retains
earlier duplicates as standard gettext `#~` obsolete entries.

## Verified locally

- Five JavaScript files pass `node --check`; eight shell entry points pass `bash -n`.
- Extracted portable ucode guards execute in Node: blank/whitespace dashboard
  secrets fail even when dashboard assets are unavailable; listener ports must
  be decimal 1..65535, and client listener collisions fail. Dashboard `::` is unchanged.
- Real LuCI `luci.js` DOM + jsdom render hostile version/node strings as text.
  The jsdom and LuCI source paths can be supplied with `JSDOM_PATH` and
  `LUCI_RESOURCES`; defaults use existing local audit dependencies.
- Actual resource updater executes with isolated transport/core-check fixtures:
  failed dashboard replacement retains old files, subsequent installation works.
- Extracted init promotion block retains old JSON on generation/check failure.
- Actual subscription wrapper executes with isolated ucode/service fixtures:
  failure restores persisted UCI and saved runtime JSON, attempts recovery restart,
  and still returns failure. Backups are retained on failure for recovery.
- Multiline PO/POT parsing: duplicate active entries removed, source strings
  covered, and PO/POT IDs match. Catalog-only URL/Website are retained for
  compatibility; ACL description is intentionally not a JavaScript string.

## Boundaries requiring target verification

- No ucode or sing-box executable is installed on this host. Guard execution is
  **not** a full ucode configuration-generation test; actual UCI/ubus integration,
  `validate_data ipaddr`, sing-box schema and rule-set CLI checks remain unverified.
- Directory replacement uses staged same-filesystem renames with a backup and
  rollback, not rename-exchange: there is a short path-absence window and no
  crash/power-loss atomicity guarantee. Validate on the target filesystem.
- Subscription recovery is best-effort, not an atomic transaction with concurrent
  LuCI edits; it cannot prove daemon health, and failed recovery retains backups.
- The log RPC bounds output to 128 KiB via tail and frontend truncation. A complete
  rpcd runtime log fixture and full form dependency/save tests remain outstanding.
- Fake-IP/private-address bypass rules were intentionally left unchanged: without
  the target sing-box runtime, changing native pre-match semantics is unsafe.
- Existing static translated description HTML and node latency colors remain;
  this patch does not claim to eliminate all HTML/color usage in the application.
