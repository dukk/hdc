# Uptime Kuma (`uptime-kuma`)

Deploy Uptime Kuma on Proxmox LXC (Node 22, systemd, port 3001), upgrade releases, probe health, and reconcile LAN monitors from config.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (schema v3 adds `monitors[]` and `uptime_kuma_auth`)
- **Inventory:** [`inventory/manual/systems/uptime-kuma-a.json`](../../../inventory/manual/systems/uptime-kuma-a.json); service [`inventory/manual/services/uptime-kuma.json`](../../../inventory/manual/services/uptime-kuma.json)
- **Auth:** `HDC_UPTIME_KUMA_USERNAME` in `.env`; vault `HDC_UPTIME_KUMA_PASSWORD` for monitor sync (Socket.IO). API keys (`HDC_UPTIME_KUMA_API_KEY`) are read-only upstream.

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + install from GitHub release tarball |
| `maintain` | Upgrade/restart guest + sync `monitors[]` to live Uptime Kuma |
| `query` | Guest health + monitor drift; import from homepage or live API |
| `teardown` | Destroy LXC |

```bash
node tools/hdc/cli.mjs run service uptime-kuma deploy --
node tools/hdc/cli.mjs run service uptime-kuma query -- --import-from-homepage --yes
node tools/hdc/cli.mjs run service uptime-kuma maintain --
node tools/hdc/cli.mjs run service uptime-kuma query --
```

## Monitor bootstrap

1. Seed `monitors[]` from homepage dashboard targets (`siteMonitor` → HTTP, `ping` → ICMP):

   ```bash
   node tools/hdc/cli.mjs run service uptime-kuma query -- --import-from-homepage --yes
   ```

2. Review/edit `monitors[]` in hdc-private `config.json` (`managed: true` on entries hdc should own).

3. Apply to live Uptime Kuma:

   ```bash
   node tools/hdc/cli.mjs run service uptime-kuma maintain -- --dry-run
   node tools/hdc/cli.mjs run service uptime-kuma maintain --
   ```

4. After first sync, import live IDs for drift detection:

   ```bash
   node tools/hdc/cli.mjs run service uptime-kuma query -- --import --yes
   ```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain), `--skip-monitors`, `--prune`, `--dry-run`, `--monitor <id>`, `--yes` (teardown/import).

`maintain daily` passes `--skip-monitors` for this package (guest upgrade only).

## After deploy

1. Get IP from query output or inventory.
2. **Web UI:** `http://<guest-ip>:3001`
3. **First run:** create the admin account in the browser; set `HDC_UPTIME_KUMA_USERNAME` / vault password to match.

## Email notifications (manual)

Uptime Kuma stores SMTP settings in its SQLite database (Settings → Notifications → Email). hdc does not automate this in v1. Point notifications at the internal relay:

| Field | Value |
| --- | --- |
| SMTP Host | `postfix-relay.hdc.dukk.org` (or `10.0.0.60`) |
| SMTP Port | `25` |
| Security | None / STARTTLS off |
| Username / Password | leave empty (relay trusts LAN via `mynetworks`) |
| From | `noreply@hdc.dukk.org` (or your configured `client_defaults.default_from`) |

Ensure the Uptime Kuma LXC subnet is listed in [`postfix-relay` config](../postfix-relay/config.example.json) `postfix.mynetworks`. OS-level mail on the guest is configured automatically via guest baseline (`mail_relay` on maintain).

## Related

- [AGENTS.md — Uptime Kuma](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/uptime-kuma.config.schema.json`](../../../tools/hdc/schema/uptime-kuma.config.schema.json)
