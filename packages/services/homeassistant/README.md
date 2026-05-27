# Home Assistant (`homeassistant`)

Deploy **Home Assistant OS** as a Proxmox QEMU VM with optional USB passthrough for Zigbee/Z-Wave coordinators.

## Prerequisites

- **Inventory:** [`inventory/manual/systems/vm-homeassistant-a.json`](../../../inventory/manual/systems/vm-homeassistant-a.json)
- **Config:** `packages/services/homeassistant/config.json` (copy from [`config.example.json`](config.example.json))
- **Proxmox:** `packages/infrastructure/proxmox/config.json` with target host (e.g. `pve-h`)
- **SSH** to the Proxmox node for image download (`unxz`) and USB preflight (`lsusb`)

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | Import HAOS OVA qcow2, create VM, USB passthrough, start, wait for HTTP `:8123` |
| `maintain` | HTTP health probe; `--reapply-usb` to refresh USB mapping |
| `query` | Config summary; `--live` for Proxmox guest + HTTP probe |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`) |

```bash
node tools/hdc/cli.mjs run service homeassistant deploy -- --instance a --destroy-existing
node tools/hdc/cli.mjs run service homeassistant query -- --live
```

## USB passthrough

- Prefer **vendor:product** IDs (`vvvv:pppp` from `lsusb` on the Proxmox host), not USB port numbers.
- Deploy auto-discovers when exactly one coordinator-like device is present; otherwise set `proxmox.qemu.usb[].id` or pass `--usb-id vvvv:pppp`.
- Use a **USB 2.0** port/extension cable for dongle stability.

## Static IP

HAOS does not use Ubuntu cloud-init. After first boot, set the configured static IP in **Settings → System → Network** if the deploy HTTP wait fails (default in private config: `10.0.0.30/24`, gw `10.0.0.1`, DNS BIND).

## Common flags

`--instance a`, `--system-id`, `--destroy-existing`, `--skip-provision`, `--usb-id`, `--no-wait-http`, `--reapply-usb`, `--no-report`.

No vault secrets for v1. Pair ZHA/Z-Wave in the Home Assistant UI after deploy.
