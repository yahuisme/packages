# procd watchdog source fixture

`watchdog.c.fixture` is unchanged official procd source at `fb6116870115a66686709017ecabfd724804bbdf`, selected by both distribution recipes.

- URL: https://github.com/openwrt/procd/blob/fb6116870115a66686709017ecabfd724804bbdf/watchdog.c
- SHA256: `d58e6783c988dc5217cedbf2056ee647a8a5d8e25a69c79c9cbed25019a88f88`
- Git blob: `6d40d68b8aac03d494d291d1dcb40bc5af9838d8`

Tests apply the production patch and compare all source bytes outside the explicit changes. Private regular files additionally exercise host libc file/conversion primitives via ctypes. The Python glue is an oracle, not execution of compiled procd C, musl or watchdog ioctls. No host `/dev/watchdog` or sysfs files are accessed.
