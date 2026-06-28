# Uptime Kuma (`uptime-kuma`)

Deploy Uptime Kuma on Proxmox LXC or Oracle Cloud VM (Node 22, systemd, port 3001), upgrade releases, probe health, and reconcile monitors and Discord notifications from config.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (schema v5: per-deployment `monitors[]`, `notifications[]`, `uptime_kuma_auth`)
- **Inventory:** `uptime-kuma-a` (Proxmox); optional `uptime-kuma-b` (OCI); service [`inventory/manual/services/uptime-kuma.json`](../../../inventory/manual/services/uptime-kuma.json)
- **Auth:** per-deployment `HDC_UPTIME_KUMA_USERNAME` / vault password (e.g. `HDC_UPTIME_KUMA_PASSWORD`, `HDC_UPTIME_KUMA_PASSWORD_B`). API keys are read-only upstream.

## Two-instance pattern

| Instance | Mode | Monitors | Alerts |
|----------|------|----------|--------|
| `uptime-kuma-a` | `proxmox-lxc` | Root `monitors/` (LAN + infra) | Manual / email |
| `uptime-kuma-b` | `oci-vm` | `monitors-public/` (HTTPS edge) | Discord `#hdc-ops` via `notifications[]` |

OCI UK API is reached over SSH (`api_via_ssh: true`); do not expose port 3001 on the public NSG.

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC or OCI VM + install from GitHub release tarball |
| `maintain` | Upgrade/restart guest + sync `notifications[]` and `monitors[]` per deployment |
| `query` | Guest health + monitor drift; import from homepage or live API |
| `teardown` | Destroy LXC or OCI VM |

```bash
node tools/hdc/cli.mjs run service uptime-kuma deploy -- --instance a
node tools/hdc/cli.mjs run service uptime-kuma deploy -- --instance b
node tools/hdc/cli.mjs run service uptime-kuma maintain -- --instance b
node tools/hdc/cli.mjs run service uptime-kuma query -- --live
```

## Monitor bootstrap

1. Seed `monitors[]` from homepage dashboard targets:

   ```bash
   node tools/hdc/cli.mjs run service uptime-kuma query -- --import-from-homepage --yes
   ```

2. Review/edit monitors in hdc-private `config.json` (`managed: true` on hdc-owned entries). Use `$hdc.include` for split files under `monitors/` or `monitors-public/`.

3. Apply to live Uptime Kuma:

   ```bash
   node tools/hdc/cli.mjs run service uptime-kuma maintain -- --dry-run
   node tools/hdc/cli.mjs run service uptime-kuma maintain -- --instance b
   ```

## Discord notifications

Add to config (root or per-deployment):

```json
"notifications": [
  {
    "id": "hdc-ops-discord",
    "name": "HDC Ops Discord",
    "type": "discord",
    "managed": true,
    "discord_webhook_vault_key": "HDC_OPS_DISCORD_WEBHOOK_URL",
    "discord_username": "Uptime Kuma",
    "apply_to_monitors": true
  }
]
```

`maintain` syncs notifications before monitors. Use `--skip-notifications` to skip.

## OCI deploy (`oci-vm`)

1. Configure [`oci-compute`](../../infrastructure/oci-compute/) (VCN, NSG, instance `uptime-kuma-b`).
2. `node tools/hdc/cli.mjs run infrastructure oci-compute deploy -- --resource uptime-kuma-b --yes`
3. Set `deployments[].configure.ssh.host` to the public IP; deploy UK: `--instance b`
4. First-run admin via SSH tunnel; then `maintain --instance b` to sync public monitors + Discord.

See hdc-private `packages/services/uptime-kuma/plan.md` for Console setup and rollback.

## Common flags

`--instance a|b`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade`, `--skip-monitors`, `--skip-notifications`, `--prune`, `--dry-run`, `--monitor <id>`, `--yes` (teardown/import).

`maintain daily` passes `--skip-monitors` for this package (guest upgrade only).

## After deploy

1. Get IP from query output or inventory.
2. **Web UI:** `http://<guest-ip>:3001` (LAN) or SSH port-forward for OCI.
3. **First run:** create the admin account matching vault credentials.

## Email notifications (manual)

For `uptime-kuma-a`, configure SMTP in the UK UI (Settings → Notifications → Email). Use internal postfix-relay (`postfix-relay.hdc.dukk.org:25`, no auth). Guest baseline configures OS mail on Proxmox LXCs.

## Related

- [AGENTS.md — Uptime Kuma](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/uptime-kuma.config.schema.json`](../../../tools/hdc/schema/uptime-kuma.config.schema.json)
- OCI: [`docs/manually-deployed/oci-compute.md`](../../../docs/manually-deployed/oci-compute.md)
