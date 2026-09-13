# HomeProxy customization

Keep `luci-app-homeproxy/` and its translations as an unedited upstream mirror. Only MX4200 consumes this overlay; sing-box stays unchanged.

- `runtime.patch`: connection-test routing, DoH query preservation, URLTest node lookup and complete domain-list writes.
- `ui.patch`: page polling lifecycle, one connection test on entry, result retention, status presentation and responsive node controls.

The patches own separate files. Keep at most these two; remove local fixes when upstream incorporates them.

```sh
sh custom/homeproxy/apply.sh luci-app-homeproxy /tmp/homeproxy-custom
```

The output must not exist. Both patches are checked and applied to a temporary copy, published only on success. A conflict leaves the mirror and installed recipes untouched. Daily synchronization and MX4200 use this same preparation script.

Connection tests use the runtime mixed-in port when the client main node is enabled, or ordinary direct requests when disabled. TUN stack selection does not change that entry point. Entering Service Status triggers one test; Reset and resource updates do not repeat it. Manual tests remain available.

Publish packages before any incompatible consumer changes. Local fixtures do not replace firmware builds or device acceptance.
