# OpenRouter (hdc)

Manage [OpenRouter](https://openrouter.ai/) account credits and inference API keys from hdc. Consumers such as **hermes** use separate inference vault keys; this package owns inventory and key lifecycle.

## Vault keys

| Purpose | Vault key | Used by |
| --- | --- | --- |
| Management API | `HDC_OPENROUTER_MANAGEMENT_API_KEY` | `hdc run infrastructure openrouter` |
| Hermes inference | `HDC_HERMES_OPENROUTER_API_KEY` | `packages/services/hermes` |

Create the management key in the OpenRouter dashboard (Management API keys). Store with:

```bash
node tools/hdc/cli.mjs secrets set HDC_OPENROUTER_MANAGEMENT_API_KEY
```

## Config

Copy `config.example.json` to **hdc-private** as `packages/infrastructure/openrouter/config.json`, or bootstrap:

```bash
node tools/hdc/cli.mjs run infrastructure openrouter query -- --import --yes
```

Set `managed: true` on `api_keys[]` entries hdc should create or update.

## Commands

```bash
node tools/hdc/cli.mjs run infrastructure openrouter query --
node tools/hdc/cli.mjs run infrastructure openrouter query -- --import --yes
node tools/hdc/cli.mjs run infrastructure openrouter maintain --
node tools/hdc/cli.mjs run infrastructure openrouter maintain -- --key-id hermes --dry-run
```

See [docs/manually-deployed/openrouter.md](../../../docs/manually-deployed/openrouter.md) for full operator workflow.
