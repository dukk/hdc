# OpenVAS (`openvas`)

Greenbone Community Edition deployment on privileged Proxmox LXC via Docker Compose.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json`
- **Inventory:** [`inventory/manual/systems/openvas-a.json`](../../../inventory/manual/systems/openvas-a.json), [`inventory/manual/services/openvas.json`](../../../inventory/manual/services/openvas.json)
- **Vault:** `HDC_OPENVAS_ADMIN_PASSWORD`

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Compose OpenVAS |
| `maintain` | Re-push env/compose and refresh images |
| `query` | Config summary; `--live` for compose and HTTP probe |
| `teardown` | Optional compose down, destroy LXC |

```bash
node tools/hdc/cli.mjs secrets set HDC_OPENVAS_ADMIN_PASSWORD
node tools/hdc/cli.mjs run service openvas deploy --
node tools/hdc/cli.mjs run service openvas query -- --live
```

## Bootstrap note

The first bootstrap can take a long time because Greenbone feeds and scanner data initialize in the background.
Keep the service running and re-check with `query -- --live` until health checks stabilize.

## Related

- [AGENTS.md — OpenVAS section](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/openvas.config.schema.json`](../../../tools/hdc/schema/openvas.config.schema.json)
