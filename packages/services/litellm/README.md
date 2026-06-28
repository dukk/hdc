# LiteLLM (`litellm`)

OpenAI-compatible AI gateway on Proxmox LXC (Docker Compose + bundled Postgres, port from `litellm.host_port`, default **4000**).

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` — set `ollama_backends[].url` and `model_list[]`
- **Inventory:** [`inventory/manual/systems/litellm-a.json`](../../../inventory/manual/systems/litellm-a.json); [`inventory/manual/services/litellm.json`](../../../inventory/manual/services/litellm.json)
- **Vault:** `HDC_LITELLM_MASTER_KEY`, `HDC_LITELLM_SALT_KEY`, `HDC_LITELLM_DB_PASSWORD` (auto-generated on first deploy if missing)
- **Optional:** `HDC_OPENROUTER_API_KEY` when any `model_list[]` entry uses `provider: openrouter`
- **Ollama:** deploy [ollama](../ollama/README.md) separately; reference backend URLs in `ollama_backends[]`

**Important:** `HDC_LITELLM_SALT_KEY` encrypts provider credentials stored in the database. Do not rotate it after models are added — set it once before first deploy.

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker LiteLLM + Postgres |
| `maintain` | Re-push `config.yaml` + `.env`; `docker compose pull` + `up -d`; guest baseline |
| `query` | Config summary; `--live` for Docker + `/health/liveliness` |
| `teardown` | Optional compose down, destroy LXC |

```bash
node tools/hdc/cli.mjs run service litellm deploy --
node tools/hdc/cli.mjs run service litellm query -- --live
```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain), `--skip-compose-down`, `--dry-run`, `--yes`.

## After deploy

1. **Admin UI:** `http://<guest-ip>:4000/ui` (master key from vault for API auth).
2. **Health:** `curl http://<guest-ip>:4000/health/liveliness`
3. **Consumers:** OpenAI-compatible base URL `http://<guest-ip>:4000/v1` with `Authorization: Bearer <virtual-key-or-master-key>`.
4. **Virtual keys:** create per-app keys in the admin UI for spend tracking and rate limits.
5. **HTTPS (optional):** add nginx-waf upstream with extended proxy timeouts for long completions; set `litellm.public_url` when wiring a hostname.

## Related

- Schema: [`tools/hdc/schema/litellm.config.schema.json`](../../../tools/hdc/schema/litellm.config.schema.json)
- [ollama README](../ollama/README.md)
- [openrouter infrastructure package](../../infrastructure/openrouter/README.md)
