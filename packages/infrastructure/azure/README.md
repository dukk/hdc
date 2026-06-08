# Azure Entra app registrations (`azure-entra`)

Discover Microsoft Entra application registrations, curate them in package config, then deploy missing apps and maintain redirect URIs and API permissions. Client IDs only — no application secrets or certificates.

## Prerequisites

- **Config:** copy [`config.example.json`](config.example.json) to `config.json` in hdc-private (same path).
- **Env:** `HDC_AZURE_TENANT_ID`, `HDC_AZURE_CLIENT_ID` in `.env` (automation app).
- **Vault:** `HDC_AZURE_CLIENT_SECRET` — automation app client secret.

See [`docs/manually-deployed/azure-entra.md`](../../../docs/manually-deployed/azure-entra.md) for bootstrap and Graph permissions.

## Commands

| Verb | Purpose |
|------|---------|
| `query` | Discover tenant apps, diff vs config, suggested config entries (JSON on stdout) |
| `deploy` | Create managed apps not found in the tenant |
| `maintain` | Patch managed apps when config drifts from live |

```bash
node tools/hdc/cli.mjs run infrastructure azure-entra query --
node tools/hdc/cli.mjs run infrastructure azure-entra deploy -- --dry-run
node tools/hdc/cli.mjs run infrastructure azure-entra maintain --
```

## Config

- **`application_filter`:** `all`, `include`, or `exclude` by `display_name_prefixes`.
- **`applications[]`:** only entries with `"managed": true` are created or updated.
- **`match.client_id`:** preferred binding after first `query`; fallback is `match.display_name`.

## hdc-private after merge

Copy `config.example.json` to `packages/infrastructure/azure-entra/config.json` and add `inventory/manual/targets/azure-entra.json` (`kind: target`, `automation_target: azure-entra`).

## Related

- [AGENTS.md](../../../AGENTS.md)
- Cloudflare DNS package (similar declarative sync pattern)
