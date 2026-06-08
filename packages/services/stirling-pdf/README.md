# Stirling PDF (`stirling-pdf`)

[Stirling PDF](https://docs.stirlingpdf.com/) — self-hosted web PDF toolkit on Proxmox LXC (Docker Compose). Default LAN access: `http://<ct-ip>:8080` with login enabled.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (hdc-private) — set `proxmox.host_id`, `proxmox.lxc.vmid`, static `ip_config`, and optional `stirling_pdf.public_url` for future nginx-waf
- **Inventory:** `inventory/manual/systems/stirling-pdf-a.json`; `inventory/manual/services/stirling-pdf.json`
- **Vault:** `HDC_STIRLING_PDF_ADMIN_PASSWORD` (initial admin login password)

```bash
node tools/hdc/cli.mjs secrets set HDC_STIRLING_PDF_ADMIN_PASSWORD
```

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Stirling PDF (`stirlingtools/stirling-pdf:latest`) |
| `maintain` | Re-push `docker-compose.yml` + `.env`; `docker compose pull` + `up -d`; guest Linux baseline |
| `query` | Config summary; `--live` for API health on host port |
| `teardown` | Optional compose down, destroy LXC |

```bash
node tools/hdc/cli.mjs run service stirling-pdf deploy -- --instance a
node tools/hdc/cli.mjs run service stirling-pdf query -- --live
node tools/hdc/cli.mjs run service stirling-pdf maintain --
```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain), `--skip-clamav` (maintain), `--live` (query), `--skip-compose-down`, `--dry-run`, `--yes` (teardown).

## After deploy

1. **CT IP:** from deploy/query `upstream_url` (e.g. `http://10.0.0.139:8080`).
2. **Inventory:** set `access.nodes[0].ip` on `stirling-pdf-a.json`.
3. **Login:** username from `stirling_pdf.security.initial_username` (default `admin`); password from vault.
4. **HTTPS (optional):** set `stirling_pdf.public_url`, add BIND + nginx-waf upstream manually (consider larger `client_max_body_size` for uploads).

## Image variants

Override `stirling_pdf.image` for other tags:

- `stirlingtools/stirling-pdf:latest` — standard (default)
- `stirlingtools/stirling-pdf:latest-fat` — extra fonts/conversion tools (bump `memory_mb` / `memory_limit_mb`)
- `stirlingtools/stirling-pdf:latest-ultra-lite` — minimal footprint

## Related

- [AGENTS.md — Stirling PDF](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/stirling-pdf.config.schema.json`](../../../tools/hdc/schema/stirling-pdf.config.schema.json)
- Docker guide: [docs.stirlingpdf.com](https://docs.stirlingpdf.com/Installation/Docker%20Install/)
