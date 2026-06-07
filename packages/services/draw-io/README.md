# draw.io (`draw-io`)

Self-hosted [diagrams.net / draw.io](https://github.com/jgraph/docker-drawio) on Proxmox LXC (Docker Compose). Public HTTPS access is via **nginx-waf** using `draw_io.public_url` in config.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` — set `draw_io.public_url` (`https://…`), `proxmox.host_id`, `proxmox.lxc.vmid`, static `ip_config`
- **Inventory:** `inventory/manual/systems/draw-io-a.json`; `inventory/manual/services/draw-io.json`
- **nginx-waf:** reverse-proxy site pointing at `http://<ct-ip>:8080` after deploy
- **DNS:** Cloudflare CNAME `draw` → `waf.dukk.org`; BIND A `draw-io-a` + CNAME `draw` → WAF

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker draw.io (`jgraph/drawio`) |
| `maintain` | Re-push `.env`; `docker compose pull` + `up -d`; guest Linux baseline |
| `query` | Config summary; `--live` for HTTP probe |
| `teardown` | Optional compose down, destroy LXC |

```bash
node tools/hdc/cli.mjs run service draw-io deploy -- --instance a
node tools/hdc/cli.mjs run service draw-io query -- --live
node tools/hdc/cli.mjs run service draw-io maintain --
```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain), `--skip-clamav` (maintain), `--live` (query), `--skip-compose-down`, `--dry-run`, `--yes` (teardown).

## After deploy

1. **CT IP:** from deploy/query `upstream_url` (e.g. `http://10.0.0.155:8080`).
2. **Inventory:** set `access.nodes[0].ip` on `draw-io-a.json`.
3. **nginx-waf:** add site with upstream to the CT IP; `client_ip: cloudflare`; `websocket: true` on `/`.
4. **Cloudflare:** CNAME `draw` → `waf.dukk.org` (proxied).
5. **BIND:** A `draw-io-a`; CNAME `draw` → `nginx-waf-a.hdc.dukk.org.`
6. **Browse:** `https://draw.dukk.org`

## Related

- Schema: [`tools/hdc/schema/draw-io.config.schema.json`](../../../tools/hdc/schema/draw-io.config.schema.json)
- [nginx-waf README](../nginx-waf/README.md)
