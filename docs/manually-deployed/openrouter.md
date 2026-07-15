# OpenRouter (hdc)

Credits and inference API keys for your [OpenRouter](https://openrouter.ai/) account are managed with the **openrouter** infrastructure package (`clumps/infrastructure/openrouter/`). Consumer services (e.g. **hermes**) use separate inference vault keys for chat completions.

## Management key vs inference keys

| Purpose | Vault key | Used by |
| --- | --- | --- |
| Management API | `HDC_OPENROUTER_MANAGEMENT_API_KEY` | `hdc run infrastructure openrouter` |
| Hermes inference | `HDC_HERMES_OPENROUTER_API_KEY` | `clumps/services/hermes` |

The management key is created in the OpenRouter dashboard under **Management API keys**. It cannot be used for `/chat/completions` — only for credits and key administration ([docs](https://openrouter.ai/docs/guides/overview/auth/management-api-keys)).

## Vault setup

```bash
hdc secrets set HDC_OPENROUTER_MANAGEMENT_API_KEY
hdc secrets set HDC_HERMES_OPENROUTER_API_KEY
```

You may also set these in repo `.env` (env takes precedence over vault).

## Config

Copy `clumps/infrastructure/openrouter/config.example.json` to **hdc-private** as `clumps/infrastructure/openrouter/config.json`, or bootstrap from the live account:

```bash
hdc run infrastructure openrouter query -- --import --yes
```

Set `managed: true` on `api_keys[]` entries hdc should create or update. Link each consumer with `inference_api_key_vault_key` and optional `consumer` (e.g. `hermes-a`).

## Query and import

```bash
hdc run infrastructure openrouter query --
hdc run infrastructure openrouter query -- --import --yes
hdc run infrastructure openrouter query -- --key-id hermes
```

`--import --yes` replaces `api_keys[]` from the live Management API. HDC-local fields (`id`, `consumer`, `notes`, `inference_api_key_vault_key`, `managed`) are preserved when `openrouter_hash` or `name` matches an existing config entry.

Query exits `1` when `has_drift` (including low account credits below `credits.low_balance_usd`).

## Maintain

```bash
hdc run infrastructure openrouter maintain --
hdc run infrastructure openrouter maintain -- --key-id hermes --dry-run
hdc run infrastructure openrouter maintain -- --prune
```

For each `managed: true` key:

- Missing in OpenRouter → `POST /keys` (new inference key saved to vault when `inference_api_key_vault_key` is set)
- Limit/metadata drift → `PATCH /keys/{hash}`

`--prune` deletes live API keys that are not present in config (by hash or name). Use with care.

After maintain creates a key, run **hermes** `maintain` or `deploy` so the container picks up the vault secret.

## Hermes

Hermes Agent uses `HDC_HERMES_OPENROUTER_API_KEY` as `OPENROUTER_API_KEY` in compose. Model selection remains post-deploy inside the container (`hermes model`). See [`clumps/services/hermes/README.md`](../../clumps/services/hermes/README.md).
