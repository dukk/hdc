# Keycloak (`keycloak`)

Keycloak on Proxmox LXC via Docker Compose, with either bundled PostgreSQL sidecar or external PostgreSQL.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json`
- **Inventory:** [`inventory/manual/systems/keycloak-a.json`](../../../inventory/manual/systems/keycloak-a.json), [`inventory/manual/services/keycloak.json`](../../../inventory/manual/services/keycloak.json)
- **Vault:** `HDC_KEYCLOAK_ADMIN_PASSWORD` and `HDC_KEYCLOAK_DB_PASSWORD` (for bundled DB; optional for external based on config)

## Hostname / reverse proxy

Set `keycloak.external_url` to the public HTTPS URL served by nginx-waf (e.g. `https://keycloak.hdc.dukk.org`). Deploy/maintain map that to `KC_HOSTNAME` and set `KC_HTTP_ENABLED=true` + `KC_PROXY_HEADERS=xforwarded` for edge TLS. Optional `public_url` should match `external_url`; a mismatch is logged as a warning.

## Database modes

- `database.mode: "bundled"`: compose includes `postgres` sidecar
- `database.mode: "external"`: compose only runs Keycloak and connects to external PostgreSQL from `database.external`

## Realms and users

Declare managed realms under `defaults.keycloak.realms[]` (or per deployment). Use `$hdc.include` to split one file per realm under `realms/`:

```json
"realms": [
  { "$hdc.include": "realms/hdc.json" }
]
```

Each realm file sets `id`, `realm` (Keycloak name; not `master`), login flags, optional `mail`, and `users[]`. Every user needs `password_vault_key` (auto-generated into the vault on first maintain when missing).

### Email (postfix-relay)

Set `mail.enabled: true` on a realm to push Keycloak `smtpServer` from [postfix-relay](../postfix-relay/) `client_defaults` (hostname + port 25, no auth). Optional overrides: `mail.from`, `mail.from_display_name`, `mail.reply_to`. When `mail` is omitted or disabled, live SMTP is left unchanged.

```json
"mail": {
  "enabled": true,
  "from_display_name": "Example SSO"
}
```

Deploy/maintain reconcile via the Admin REST API after the stack is healthy:

| Flag | Effect |
|------|--------|
| `--skip-realms` | Skip Admin API reconcile |
| `--realm <id\|name>` | Only that realm |
| `--prune` | Delete unmanaged users in managed realms; delete non-`master` realms not listed in config |
| `--rotate-user-passwords` | Reset passwords from vault for existing users |
| `--dry-run` | Log planned changes without applying |

Empty or omitted `realms` is a no-op (does not wipe live realms). Clients and identity providers remain console-managed.

Optional `keycloak.api_url` overrides the Admin API base (else `external_url` / `public_url`, else `http://<ct-ip>:<host_port>`).

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Compose Keycloak; reconcile realms/users |
| `maintain` | Re-push env/compose; optional image refresh; reconcile realms/users |
| `query` | Config summary; `--live` for service health + realm/user drift |
| `teardown` | Optional compose down, destroy LXC |

```bash
node apps/hdc-cli/cli.mjs secrets set HDC_KEYCLOAK_ADMIN_PASSWORD
node apps/hdc-cli/cli.mjs secrets set HDC_KEYCLOAK_DB_PASSWORD
node apps/hdc-cli/cli.mjs run service keycloak deploy --
node apps/hdc-cli/cli.mjs run service keycloak maintain -- --dry-run
node apps/hdc-cli/cli.mjs run service keycloak query -- --live
```

## Related

- [AGENTS.md — Keycloak section](../../../AGENTS.md)
- Schema: [`apps/hdc-cli/schema/keycloak.config.schema.json`](../../../apps/hdc-cli/schema/keycloak.config.schema.json)
- Example realm: [`realms/example.json`](realms/example.json)
