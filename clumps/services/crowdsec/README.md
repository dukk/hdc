# CrowdSec (`crowdsec`)

CrowdSec Local API (LAPI) service on Proxmox LXC with optional nginx bouncer sync for `vm-nginx-waf-*` nodes.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) -> `config.json`
- **Inventory:** [`inventory/manual/systems/crowdsec-a.json`](../../../inventory/manual/systems/crowdsec-a.json); [`inventory/manual/services/crowdsec.json`](../../../inventory/manual/services/crowdsec.json)
- **Vault:** optional enrollment key at `HDC_CROWDSEC_ENROLL_KEY` (used by guest baseline agent enrollment)

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC provision + apt install CrowdSec LAPI |
| `maintain` | Re-apply LAPI config; optional `--sync-bouncers` on nginx-waf nodes |
| `query` | Config summary; `--live` for service status and LAPI probe |
| `teardown` | Destroy LXC |

```bash
node apps/hdc-cli/cli.mjs run service crowdsec deploy --
node apps/hdc-cli/cli.mjs run service crowdsec maintain -- --sync-bouncers
```

## Related

- [AGENTS.md — CrowdSec references](../../../AGENTS.md)
- Schema: [`apps/hdc-cli/schema/crowdsec.config.schema.json`](../../../apps/hdc-cli/schema/crowdsec.config.schema.json)
