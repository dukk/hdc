# Paperclip (`paperclip`)

Self-hosted [Paperclip](https://github.com/paperclipai/paperclip) AI agent orchestration on Proxmox LXC (Docker Compose + PostgreSQL). LAN access uses **authenticated/private** mode by default; optional public HTTPS via **nginx-waf** when `paperclip.public_url` is set.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (hdc-private) — set `proxmox.host_id`, `proxmox.lxc.vmid`, optional static `ip_config`, and optional `paperclip.public_url` for nginx-waf
- **Inventory:** `inventory/manual/systems/paperclip-a.json`; `inventory/manual/services/paperclip.json`
- **Vault:** `HDC_PAPERCLIP_BETTER_AUTH_SECRET` and `HDC_PAPERCLIP_DB_PASSWORD` (auto-generated on first deploy if missing)

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Paperclip + PostgreSQL |
| `maintain` | Re-push compose + `.env`; `docker compose pull` + `up -d`; guest baseline |
| `query` | Config summary; `--live` for `/api/health` |
| `teardown` | Optional compose down, destroy LXC |

```bash
node tools/hdc/cli.mjs run service paperclip deploy -- --instance a
node tools/hdc/cli.mjs run service paperclip query -- --live
node tools/hdc/cli.mjs run service paperclip maintain --
```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain), `--skip-clamav` (maintain), `--live` (query), `--skip-compose-down`, `--dry-run`, `--yes` (teardown).

## After deploy

1. **CT IP:** from deploy/query `upstream_url` (e.g. `http://10.0.0.123:3100`).
2. **First admin:** open the LAN URL, sign in or register, then **Claim this instance** on the setup screen.
3. **Inventory:** set `access.nodes[0].ip` on `paperclip-a.json`.
4. **Optional HTTPS:** set `paperclip.public_url`, add BIND A record and nginx-waf upstream to the CT IP.
5. **Backup:** preserve vault keys and Docker volumes (`paperclip-pgdata`, `paperclip-data`).

## Image tags

Pin `paperclip.image_tag` to a [GitHub release tag](https://github.com/paperclipai/paperclip/releases) (e.g. `v2026.618.0`). `latest` works but is not recommended for production.

## Related

- [AGENTS.md — Paperclip](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/paperclip.config.schema.json`](../../../tools/hdc/schema/paperclip.config.schema.json)
