# FlowSense Aurora UI verification

## Coverage

Real application DOM generated through upstream LuCI view/RPC modules, explicit offline counter fixtures, Chinese application PO lookup, unmodified Aurora main CSS/fonts, template-derived static header/sidebar, original light/dark theme script. No router RPC or firmware build claim.

- Summary: all four cards, long localized labels.
- Ethernet: four physical-port fixtures plus excluded eth0; up/down, two-sample RX/TX rates, ordinary and MAX_SAFE_INTEGER error counters.
- Link quality: all five fields.
- Probe settings: hostname input, enabled checkbox and Save & Apply button; native label associations covered by DOM regression.
- PPE: separate closed and expanded rendered DOM; count and actual fixture entry present when expanded. Opening/closing, lazy RPC, errors and detach covered by existing real-LuCI DOM suite.
- Widths: 1440, 1024, 900, 820, 768, 520, 390, 320 px; light and dark with opposite system scheme; both PPE stages. 32 final cases passed. Sidebar remains in desktop/tablet shell.
- Every case measures visible page elements for clipping/overflow, port field alignment, document/content width, all settings control rectangles, theme state/colors, browser/resource errors. Screenshots inspected at desktop/mobile and expanded tablet dark.

## Reproduction and correction

Before: Aurora `.cbi-value + .cbi-value` adds 12px margin to second/third grid cells and `.cbi-value-title` right-aligns labels above left-aligned values. Vertically centered unequal heights add drift. Ten of sixteen original width/theme cases failed port alignment.

After: read-only port telemetry uses scoped semantic dl/dt/dd, not form rows; top-aligned grid, 8/16px spacing, no added cards/colors/bold decoration. Container-width breakpoints account for sidebar; phones use compact label/value rows, wrapping long counters without overflow. Other native form sections retained.

## Evidence and reproduction

External harness and full raw JSON/screenshots: `/tmp/flowsense-layout/` (`export.cjs`, `verify.cjs`, `before.json`, `final.json`, `details.json`). Source/DOM/CSS SHA256 hashes are recorded in JSON. Each final JSON contains 16 distinct width/theme cases, final=closed and details=expanded.

```
NODE_PATH="$(npm root -g)" LUCI_RESOURCE_DIR=/tmp/mlo-luci/modules/luci-base/htdocs/luci-static/resources EXPORT_PATH=/tmp/flowsense-layout/final.dom.html node /tmp/flowsense-layout/export.cjs
NODE_PATH="$(npm root -g)" node /tmp/flowsense-layout/verify.cjs final
# Add EXPORT_DETAILS=1 and use details.dom.html/details for expanded coverage.
```

Real view/RPC DOM regression passed. Python: four passed, one real-UCI/jsonfilter transaction test skipped because binaries unavailable. JS/BusyBox syntax and git diff --check passed. msgfmt --check passed with existing incomplete-header warnings. No commit, push, build or backend behavior changes.

RX / TX errors are sysfs cumulative receive/transmit error-packet counters, not instantaneous alarms or dropped-packet counters; Chinese wording now explicitly says 错误包.
