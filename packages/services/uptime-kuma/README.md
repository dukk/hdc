# Uptime Kuma (`uptime-kuma`)

Deploy Uptime Kuma on Proxmox LXC (Node 22, systemd, port 3001), upgrade releases, and probe health.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json`
- **Inventory:** [`inventory/manual/systems/uptime-kuma-a.json`](../../../inventory/manual/systems/uptime-kuma-a.json); service [`inventory/manual/services/uptime-kuma.json`](../../../inventory/manual/services/uptime-kuma.json)
- **Vault:** none required for v1

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + install from GitHub release tarball |
| `maintain` | Upgrade to pinned/latest release or health-only |
| `query` | `systemctl`, HTTP probe, version |
| `teardown` | Destroy LXC |

```bash
node tools/hdc/cli.mjs run service uptime-kuma deploy --
node tools/hdc/cli.mjs run service uptime-kuma query --
```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain), `--dry-run`, `--yes` (teardown).

## After deploy

1. Get IP from query output or inventory.
2. **Web UI:** `http://<guest-ip>:3001`
3. **First run:** create the admin account in the browser (no vault secret for v1).

## Related

- [AGENTS.md — Uptime Kuma](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/uptime-kuma.config.schema.json`](../../../tools/hdc/schema/uptime-kuma.config.schema.json)
