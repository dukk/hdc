# HDC agent runtime fleet (`hdc-agents`)

Proxmox LXC + Docker Compose: one container per roster role (`hdc-manager` … `hdc-engineer`)
using the shared `hdc/agent-runtime` image and `apps/hdc-agent-server`. Model calls go through
LiteLLM; discovery/publishing uses LiteLLM agent entries (not a standalone registry).

See [docs/multi-agent-ops.md](../../../docs/multi-agent-ops.md).

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (hdc-private) — set `proxmox.host_id`, `proxmox.lxc.vmid`, static `ip_config`, `hdc_agents.litellm_base_url`, and optional `hdc_agents.public_url` for future nginx-waf
- **Inventory:** `inventory/manual/systems/hdc-agents-a.json`; `inventory/manual/services/hdc-agents.json`
- **Sizing:** defaults 4 vCPU / 8192 MB / 32 GB rootfs
- **Vault:** per-agent LiteLLM keys (`HDC_AGENT_LITELLM_KEY_<ROLE>`) when enforcing auth

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker build/run agent fleet (`hdc_agents.image_tag`) |
| `maintain` | Re-push Dockerfile + compose; `docker compose build` + `up -d`; guest Linux baseline |
| `query` | Config summary; `--live` for Docker + `/health` on manager port |
| `teardown` | Optional compose down, destroy LXC |

```bash
node apps/hdc-cli/cli.mjs run service hdc-agents deploy -- --instance a
node apps/hdc-cli/cli.mjs run service hdc-agents query -- --live
node apps/hdc-cli/cli.mjs run service hdc-agents maintain --
```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain; skips image rebuild), `--skip-clamav` (maintain), `--live` (query), `--skip-compose-down`, `--dry-run`, `--yes` (teardown).

## After deploy

1. **CT IP:** from deploy/query `upstream_url` (manager, e.g. `http://192.0.2.150:9200`).
2. **Inventory:** set `access.nodes[0].ip` on `hdc-agents-a.json`.
3. **Health:** `GET /health` on ports 9200–9207 (one per role).
4. **LiteLLM:** keep `hdc_agents.litellm_base_url` accurate; register agent URLs via litellm maintain.
5. **HTTPS (optional):** set `hdc_agents.public_url`, add BIND + nginx-waf upstream manually.

## Related

- [docs/multi-agent-ops.md](../../../docs/multi-agent-ops.md)
- Schema: [`apps/hdc-cli/schema/hdc-agents.config.schema.json`](../../../apps/hdc-cli/schema/hdc-agents.config.schema.json)
- Agent server: [`apps/hdc-agent-server/`](../../../apps/hdc-agent-server/)
