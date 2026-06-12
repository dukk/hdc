# Twenty CRM (`twenty`)

Open-source CRM ([twentyhq/twenty](https://github.com/twentyhq/twenty)) on Proxmox LXC via Docker Compose (server + worker + PostgreSQL + Redis). Public HTTPS is typically via **nginx-waf** using `twenty.public_url`; omit `public_url` for LAN-only access on the CT IP.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (hdc-private) — set `proxmox.host_id`, `proxmox.lxc.vmid`, optional static `ip_config`, and `twenty.public_url` when using nginx-waf
- **Inventory:** `inventory/manual/systems/twenty-a.json`; `inventory/manual/services/twenty.json`
- **Vault:** `HDC_TWENTY_ENCRYPTION_KEY` and `HDC_TWENTY_DB_PASSWORD` (auto-generated on first deploy if missing)
- **nginx-waf:** reverse-proxy site pointing at `http://<ct-ip>:3000` when using a public hostname

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Twenty stack |
| `maintain` | Re-push compose + `.env`; `docker compose pull` + `up -d`; guest baseline |
| `query` | Config summary; `--live` for `/healthz` |
| `teardown` | Optional compose down, destroy LXC |

```bash
node tools/hdc/cli.mjs run service twenty deploy -- --instance a
node tools/hdc/cli.mjs run service twenty query -- --live
node tools/hdc/cli.mjs run service twenty maintain --
```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain), `--skip-clamav` (maintain), `--live` (query), `--skip-compose-down`, `--dry-run`, `--yes` (teardown).

## After deploy

1. Wait 1–2 minutes for DB migrations; confirm `GET /healthz` returns OK.
2. **First-run signup:** open `SERVER_URL` in a browser and create the first account (becomes admin when `multi_workspace_enabled` is false).
3. **CT IP:** from deploy/query `upstream_url` (e.g. `http://10.0.0.x:3000`).
4. **Inventory:** set `access.nodes[0].ip` on `twenty-a.json`.
5. **HTTPS:** set `twenty.public_url` before first login when using nginx-waf; add BIND A record and nginx-waf upstream.
6. **LAN-only:** omit `public_url`; browse `http://<ct-ip>:3000`.
7. **Backup:** preserve vault keys and Docker volumes (`db-data`, `server-local-data`); Postgres database name is **`default`**.

## Related

- Schema: [`tools/hdc/schema/twenty.config.schema.json`](../../../tools/hdc/schema/twenty.config.schema.json)
- Upstream: [Twenty Docker Compose docs](https://docs.twenty.com/developers/self-host/capabilities/docker-compose)
