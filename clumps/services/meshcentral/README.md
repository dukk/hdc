# MeshCentral (`meshcentral`)

Self-hosted [MeshCentral](https://meshcentral.com/) on a privileged Proxmox LXC with Docker Compose (MeshCentral + MongoDB). TLS is offloaded to **nginx-waf**; the CT serves HTTP on port 80.

## Prerequisites

- **Config:** copy [`config.example.json`](config.example.json) to `config.json` in hdc-private (`clumps/services/meshcentral/config.json`)
- **Inventory:** [`inventory/manual/systems/meshcentral-a.json`](../../../inventory/manual/systems/meshcentral-a.json), [`inventory/manual/services/meshcentral.json`](../../../inventory/manual/services/meshcentral.json)
- **Static IP** on the LXC (`proxmox.lxc.ip_config`)
- **Privileged LXC** (`unprivileged: 0`) with Docker nesting features
- **nginx-waf** site + BIND `meshcentral` CNAME to WAF (see deploy plan)
- **Vault:** `HDC_MESHCENTRAL_MONGO_PASSWORD` (auto-generated on first deploy if missing)

## Ports (LAN)

| Protocol | Port | Service |
|----------|------|---------|
| TCP | 80 | MeshCentral HTTP (behind nginx-waf TLS) |

MongoDB is not published on the host — Docker network only.

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC provision + Docker Compose (`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env`, `docker compose pull` + `up -d`; guest Linux baseline |
| `query` | Config summary; `--live` for docker status and HTTP probe |
| `teardown` | Optional compose down then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

```bash
node apps/hdc-cli/cli.mjs run service meshcentral deploy -- --instance a
node apps/hdc-cli/cli.mjs run service meshcentral query -- --live
node apps/hdc-cli/cli.mjs run service meshcentral maintain --
```

## After deploy

1. Run `bind maintain` and `nginx-waf maintain -- --site meshcentral` if not already applied.
2. Open `meshcentral.public_url` (e.g. `https://meshcentral.hdc.dukk.org`) and create the first admin account.
3. Install agents using the same public URL.

## Related

- Schema: [`apps/hdc-cli/schema/meshcentral.config.schema.json`](../../../apps/hdc-cli/schema/meshcentral.config.schema.json)
- [MeshCentral Docker docs](https://docs.meshcentral.com/install/container/)
