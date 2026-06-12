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
| `maintain` | Sync nginx-waf `trusted_proxies` when `public_url` is HTTPS; HTTP health probe; `--reapply-usb` to refresh USB mapping |
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

HAOS does not use Ubuntu cloud-init. After first boot, set the configured static IP in **Settings → System → Network** if the deploy HTTP wait fails (match `proxmox.qemu.ip` in `config.json`, e.g. `10.0.0.39/24`, gw `10.0.0.1`, DNS BIND).

## nginx-waf / Cloudflare (public URL)

When `homeassistant.public_url` is `https://…` and **nginx-waf** proxies to port `8123`, Home Assistant must trust the WAF nodes or proxied requests return **400 Bad Request** (not 502). nginx-waf sends `X-Forwarded-For` and `X-Forwarded-Proto`; add the WAF VM LAN IPs from inventory (`vm-nginx-waf-a`, `vm-nginx-waf-b`) to `configuration.yaml`:

```yaml
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 10.0.0.40   # vm-nginx-waf-a
    - 10.0.0.41   # vm-nginx-waf-b

homeassistant:
  external_url: https://ha.dukk.org
  internal_url: http://10.0.0.39:8123
```

**Automation:** `deploy` and `maintain` (default) write the block above to HAOS `configuration.yaml` via the Proxmox host when `public_url` starts with `https://`. WAF IPs resolve from inventory `vm-nginx-waf-a` / `vm-nginx-waf-b`, or set `homeassistant.trusted_proxies[]` in package config. Skip with `--skip-reverse-proxy`. Manual fallback: **Terminal & SSH** add-on, or edit `supervisor/homeassistant/configuration.yaml` on HAOS data partition 8 while the VM is stopped.

## Common flags

`--instance a`, `--system-id`, `--destroy-existing`, `--skip-provision`, `--usb-id`, `--no-wait-http`, `--reapply-usb`, `--skip-reverse-proxy`, `--no-report`.

No vault secrets for v1. Pair ZHA/Z-Wave in the Home Assistant UI after deploy.
