# Isolated tests

Run from this package directory with host-built OpenWrt UCI/jsonfilter, Node.js,
jsdom and a trusted upstream LuCI checkout:

```sh
PYTHONDONTWRITEBYTECODE=1 UCI_BIN=/path/to/uci JSONFILTER_BIN=/path/to/jsonfilter \
  python3 -m unittest discover -s tests -v
NODE_PATH="$(npm root -g)" LUCI_RESOURCE_DIR=/path/to/luci/resources \
  node tests/test_dom.js
node tests/test_settings.js
NODE_PATH="$(npm root -g)" LUCI_RESOURCE_DIR=/path/to/luci/resources \
  node tests/test_settings_form.js
sh -n root/usr/libexec/rpcd/luci.airoha_npu
```

The RPC tests create temporary sysfs, DT and UCI fixtures. NPU_ROOT,
NPU_JSONFILTER, NPU_UCI and NPU_FIREWALL are process-environment test overrides,
not RPC arguments. Firewall reload is a temporary executable; real services,
network sysctls and hardware registers are never touched. /dev/null and
/dev/full simulate readback/write failures. A copied helper simulates kernel
clamping. DOM fixtures use real upstream LuCI DOM, RPC and poll with jsdom.
The status test uses a simulated clock to check 5-second sampling, the rolling
120-second window, failure/invalid-reading gaps, expiry during stalled requests,
no overlapping RPCs, and root-removal/pagehide cleanup. It never falls back to
mock DOM nodes. `NPU_DOM_EXPORT=/tmp/npu.dom.html` optionally exports the rendered
fixture for offline theme/browser checks (fixture readings are not hardware data).
The settings form regression requires jsdom and real upstream `luci.js`, `cbi.js`,
`validation.js`, `ui.js`, and `form.js`; it has no mock-form fallback. Optional
`LUCI_FORM` selects a separate trusted upstream form.js. It verifies all three
rendered widgets, RPC defaults, unchanged/changed saves, and unknown flow state.
RPC transport and top-level page bootstrap remain isolated; no router is contacted.

Limitations: fixtures do not prove target driver behavior or accelerated traffic.
CPU changes are runtime-only. Flow settings persist and synchronously reload the
firewall; reload success is not an offload health test. Other tools do not share
the app's lock, so avoid concurrent firewall edits. An uncatchable termination
can leave /var/lock/luci-airoha-npu until reboot; remove it only after confirming
no setter is active. There is no power-loss rollback guarantee.

The old keep.d entries intentionally preserve existing user sysctl files, but
installation and RPCs no longer create, delete or apply those files. Temperature
is left to the fan/thermal view; unverified reserved-memory and NPU-core estimates
were removed. PPE inspection is left to FlowSense. Firmware version is an
optional strings probe of the DT-selected file, never a running-version claim;
missing strings or missing files are shown as unknown.
