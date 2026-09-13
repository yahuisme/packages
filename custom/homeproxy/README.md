# HomeProxy customization

Keep `luci-app-homeproxy/` as an unedited upstream mirror. Maintain all necessary local differences in one `custom.patch`; remove differences when upstream fixes them. Only MX4200 consumes this overlay; sing-box stays unchanged.

```sh
sh custom/homeproxy/apply.sh luci-app-homeproxy /tmp/homeproxy-custom
```

Output must not exist. The script patches a temporary copy and publishes it only on success. Conflicts fail without changing the mirror or installing a partial package. Daily sync checks the same patch before committing; MX4200 prepares the customized copy before replacing package recipes.

The patch fixes view polling/reset, connection-test state, DoH query preservation, URLTest node lookup and incomplete domain-list writes. It also supplies green/red service status with a matching dot and removes the Powered by introduction line.

Publish packages before the MX4200 consumer change. Local patch checks are not firmware or device acceptance.
