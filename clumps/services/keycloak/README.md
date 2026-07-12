# Keycloak (`keycloak`)

Keycloak on Proxmox LXC via Docker Compose, with either bundled PostgreSQL sidecar or external PostgreSQL.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json`
- **Inventory:** [`inventory/manual/systems/keycloak-a.json`](../../../inventory/manual/systems/keycloak-a.json), [`inventory/manual/services/keycloak.json`](../../../inventory/manual/services/keycloak.json)
- **Vault:** `HDC_KEYCLOAK_ADMIN_PASSWORD` and `HDC_KEYCLOAK_DB_PASSWORD` (for bundled DB; optional for external based on config)

## Database modes

- `database.mode: "bundled"`: compose includes `postgres` sidecar
- `database.mode: "external"`: compose only runs Keycloak and connects to external PostgreSQL from `database.external`

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Compose Keycloak |
| `maintain` | Re-push env/compose; optional image refresh |
| `query` | Config summary; `--live` for service/container health |
| `teardown` | Optional compose down, destroy LXC |

```bash
node apps/hdc-cli/cli.mjs secrets set HDC_KEYCLOAK_ADMIN_PASSWORD
node apps/hdc-cli/cli.mjs secrets set HDC_KEYCLOAK_DB_PASSWORD
node apps/hdc-cli/cli.mjs run service keycloak deploy --
node apps/hdc-cli/cli.mjs run service keycloak query -- --live
```

## Related

- [AGENTS.md — Keycloak section](../../../AGENTS.md)
- Schema: [`apps/hdc-cli/schema/keycloak.config.schema.json`](../../../apps/hdc-cli/schema/keycloak.config.schema.json)
