# Mailcow (HDC service package)

Deploy [mailcow-dockerized](https://github.com/mailcow/mailcow-dockerized) on Proxmox **LXC** or **QEMU VM** with Docker. Manages mail **domains** (not mailboxes) via the Mailcow API, documents DNS (MX/SPF/DKIM/DMARC), and supports per-domain outbound delivery:

| `outbound.mode` | Behavior |
| --- | --- |
| `direct` | Mailcow sends mail directly from its public IP |
| `postfix-relay` | Outbound via the internal hdc [postfix-relay](../postfix-relay/) smarthost (no SMTP auth; same LAN trust as guest satellites) |

## Deploy modes

| Mode | System id | Guest access |
| --- | --- | --- |
| `proxmox-lxc` | `mailcow-a` | `pct exec` (privileged LXC + Docker nesting) |
| `proxmox-qemu` | `vm-mailcow-a` | SSH + optional `data_disk_gb` on `data_disk_storage` (e.g. `local-lvm-data`) |

QEMU sizing example: 32 GiB root on `local-lvm`, 64 GiB data disk for mail + Docker (`install_dir` under `/data/mailcow/…`, Docker `data-root` on the data mount).

## Config

Copy [`config.example.json`](config.example.json) to hdc-private `packages/services/mailcow/config.json`.

Key blocks:

- `mailcow.hostname` — `MAILCOW_HOSTNAME` FQDN (e.g. `mailcow-a.hdc.dukk.org`), **not** a mail domain
- `mailcow.domains[]` — domains to add in Mailcow; each has `outbound.mode` and `dns` templates
- `install.install_dir` — default `/opt/mailcow-dockerized` (LXC); use `/data/mailcow/mailcow-dockerized` on QEMU with a data disk

LXC defaults: 6 GiB RAM, 4 vCPU, 40 GiB rootfs (privileged LXC + Docker nesting).

QEMU defaults (typical): 8 GiB RAM, 4 vCPU, 32 GiB rootfs + optional `data_disk_gb` / `data_disk_storage`.

## Vault secrets

| Key | When |
| --- | --- |
| `HDC_MAILCOW_DBPASS` | Auto-generated on first deploy if missing |
| `HDC_MAILCOW_DBROOT` | Auto-generated on first deploy if missing |
| `HDC_MAILCOW_REDISPASS` | Auto-generated on first deploy if missing |
| `HDC_MAILCOW_API_KEY` | Required for `maintain` domain reconciliation (create in Mailcow UI after deploy) |

```bash
node tools/hdc/cli.mjs secrets set HDC_MAILCOW_API_KEY
```

## Commands

```bash
node tools/hdc/cli.mjs run service mailcow deploy -- --instance a
node tools/hdc/cli.mjs run service mailcow deploy -- --instance a --destroy-existing
node tools/hdc/cli.mjs run service mailcow maintain --
node tools/hdc/cli.mjs run service mailcow query -- --live
node tools/hdc/cli.mjs run service mailcow teardown -- --dry-run
```

### Flags

| Verb | Flags |
| --- | --- |
| `deploy` | `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--destroy-existing`, `--skip-provision` (QEMU) |
| `maintain` | `--skip-upgrade`, `--skip-domains`, `--skip-baseline`, `--skip-clamav`, … |
| `query` | `--live` |
| `teardown` | `--dry-run`, `--yes`, `--skip-compose-down` |

## DNS (v1)

HDC **does not** push DNS to BIND or Cloudflare. `maintain` and `query --live` print a checklist:

- **MX** → `mailcow.hostname`
- **SPF** / **DMARC** — from `domains[].dns` in config
- **DKIM** — fetched live from Mailcow API after key generation
- **Autodiscover** CNAME (optional)

For `postfix-relay` outbound domains, SPF in the example uses SMTP2GO-style includes; add provider DKIM CNAMEs per your relay upstream (see existing `dukk.org` Cloudflare records when using SMTP2GO).

## Guest baseline

`maintain` runs the standard Linux baseline (hdc user, admin, ClamAV) with **`--skip-mail-relay`** — Mailcow is the mail server, not a satellite client.

## Dependencies (manual)

- **BIND / Cloudflare** — publish DNS checklist records
- **nginx-waf** — optional HTTPS for admin UI
- **postfix-relay** — must exist when any domain uses `outbound.mode: postfix-relay`
