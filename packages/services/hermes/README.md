# Hermes Agent (`hermes`)

[Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent) on Proxmox LXC via Docker Compose (`nousresearch/hermes-agent` image). OpenRouter LLM, LAN dashboard with basic auth.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (in hdc-private for production)
- **Inventory:** `inventory/manual/systems/hermes-a.json`; `inventory/manual/services/hermes.json`
- **Vault:** `HDC_HERMES_OPENROUTER_API_KEY`, `HDC_HERMES_DASHBOARD_PASSWORD`; `HDC_HERMES_DASHBOARD_AUTH_SECRET` auto-generated on first deploy if missing

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Compose (gateway + optional dashboard) |
| `maintain` | Re-push `.env`, `docker compose pull` + `up -d`; guest baseline |
| `query` | Config summary; `--live` for Docker/HTTP on dashboard port **9119** |
| `teardown` | Optional compose down, then destroy LXC |

```bash
node tools/hdc/cli.mjs run service hermes deploy -- --instance a
node tools/hdc/cli.mjs run service hermes maintain --
node tools/hdc/cli.mjs run service hermes query -- --live
```

## Ports

| Port | Service |
|------|---------|
| 9119 | Web dashboard (basic auth) |
| 8642 | Gateway API (optional LAN use; not internet-exposed in v1) |

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-clamav`, `--skip-admin-user`, `--skip-upgrade` (maintain), `--skip-compose-down` (teardown), `--dry-run`, `--yes`.

## After deploy

1. Get IP from `query --live` or inventory.
2. **Dashboard:** `http://<guest-ip>:9119` — sign in with `hermes.dashboard_username` and vault password.
3. **Model:** `docker exec -it hermes hermes model` — pick an OpenRouter model.
4. **Messaging (optional):** `docker exec -it hermes hermes gateway setup` — Telegram, Discord, Slack, etc.

## Security notes

- Hermes runs tools with terminal access inside the container; treat the CT as a sensitive workload.
- Do not expose the dashboard on the public internet without OAuth or a reverse proxy with auth.
- API server beyond localhost is not enabled by default.

## hdc-private setup

1. Copy `config.example.json` to `hdc-private/packages/services/hermes/config.json` (pick a free `vmid` and static IP).
2. Add inventory sidecars (see manifest `inventory_docs`).
3. Review `plan.md` before deploy.

## Related

- Schema: [`tools/hdc/schema/hermes.config.schema.json`](../../../tools/hdc/schema/hermes.config.schema.json)
- Upstream docs: [hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/)
