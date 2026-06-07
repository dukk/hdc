# Wazuh (`wazuh`)

Single-node Wazuh stack on privileged Proxmox LXC using Docker Compose.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) -> `config.json`
- **Inventory:** [`inventory/manual/systems/wazuh-a.json`](../../../inventory/manual/systems/wazuh-a.json); [`inventory/manual/services/wazuh.json`](../../../inventory/manual/services/wazuh.json)
- **Vault:** `HDC_WAZUH_API_PASSWORD`, `HDC_WAZUH_AGENT_PASSWORD`

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Compose Wazuh install |
| `maintain` | Refresh compose env/images + baseline |
| `query` | Config summary; `--live` for docker/dashboard checks |
| `teardown` | Optional compose down, then destroy LXC |

```bash
node tools/hdc/cli.mjs run service wazuh deploy --
node tools/hdc/cli.mjs run service wazuh query -- --live
```

## Related

- [AGENTS.md — Wazuh references](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/wazuh.config.schema.json`](../../../tools/hdc/schema/wazuh.config.schema.json)
