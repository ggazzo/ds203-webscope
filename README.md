# DS203 WebScope

Custom firmware for the Miniware DS203 that exposes a USB serial (CDC) port, plus a single-file browser UI using Web Serial.

- **Install and UI:** GitHub Pages (`docs/`): `install.html` has the flashing guide, `index.html` is the scope UI.
- **Firmware:** `docs/firmware/app1-cdc.hex` (HW 2.81+, built from Wildcat V6.5 plus `firmware/usb-cdc.patch`).
- **Patch:** `firmware/usb-cdc.patch` applies on [Mark-Booth/DS203-DSOQuad](https://github.com/Mark-Booth/DS203-DSOQuad) commit `ef08bdb`.
- **Protocol:** `docs/PROTOCOL.md`.
- **Tools:** `tools/ds203.py` is a stdlib command line client, `tools/test.js` tests the UI's parsing and measurement code (`node tools/test.js`).

Experimental, tested on one unit. Flash at your own risk and keep your original firmware.

## Build the firmware

```sh
git clone https://github.com/Mark-Booth/DS203-DSOQuad.git && cd DS203-DSOQuad
git checkout ef08bdb && git am /path/to/firmware/usb-cdc.patch
cd WildcatV6.5 && ./build.sh
```

`build.sh` expects an Arm GNU toolchain (`arm-none-eabi-gcc` with newlib) and uses `-std=gnu99`.

## Known issues

See the install page.
