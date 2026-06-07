# Homepage (`homepage`)

Self-hosted [gethomepage.dev](https://gethomepage.dev/) dashboard on Proxmox LXC (Docker Compose). Service tiles are driven by `homepage.service_groups[]` in config and rendered to `config/services.yaml` on deploy/maintain.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` — set `homepage.allowed_hosts[]`, `homepage.public_url`, `proxmox.host_id`, `proxmox.lxc.vmid`, static `ip_config`
- **Inventory:** `inventory/manual/systems/homepage-a.json`; `inventory/manual/services/homepage.json`
- **nginx-waf (optional):** internal HTTPS at `https://hdc.dukk.org` with `internal_only` access policy
- **DNS:** BIND A `homepage-a`; apex `@` → nginx-waf-a for HTTPS entry

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Homepage (`ghcr.io/gethomepage/homepage`) |
| `maintain` | Re-push YAML config + `.env`; `docker compose pull` + `up -d`; guest Linux baseline |
| `query` | Config summary; `--live` for HTTP probe |
| `teardown` | Optional compose down, destroy LXC |

```bash
node tools/hdc/cli.mjs run service homepage deploy -- --instance a
node tools/hdc/cli.mjs run service homepage query -- --live
node tools/hdc/cli.mjs run service homepage maintain --
```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain), `--skip-clamav` (maintain), `--live` (query), `--skip-compose-down`, `--dry-run`, `--yes` (teardown).

## Config

- `homepage.service_groups[]` — groups with `name` and `services[]` (`name`, `href`, `icon`, `description`, `site_monitor`)
- `homepage.allowed_hosts[]` — required for `HOMEPAGE_ALLOWED_HOSTS` (comma-separated in container env)
- `homepage.public_url` — optional HTTPS URL shown in reports (e.g. `https://hdc.dukk.org`)

Edit `service_groups` in hdc-private config and run `maintain` to refresh the dashboard without manual CT edits.

## After deploy

1. **CT IP:** from deploy/query `upstream_url` (e.g. `http://10.0.0.49:3000`).
2. **Inventory:** set `access.nodes[0].ip` on `homepage-a.json`.
3. **BIND:** A `homepage-a`; A `@` → nginx-waf-a for apex HTTPS.
4. **nginx-waf:** site `hdc-homepage` upstream to CT IP; `internal_only` on `/`; `websocket: true`.
5. **Browse:** `http://10.0.0.49:3000` or `https://hdc.dukk.org` from LAN.

## Related

- Schema: [`tools/hdc/schema/homepage.config.schema.json`](../../../tools/hdc/schema/homepage.config.schema.json)
- [Homepage docs](https://gethomepage.dev/installation/)
