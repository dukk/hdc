# CrowdSec (`crowdsec`)

CrowdSec Local API (LAPI) service on Proxmox LXC with optional **firewall** bouncer sync for `vm-nginx-waf-*` nodes (`crowdsec-firewall-bouncer-iptables`; lua `crowdsec-nginx-bouncer` is not used — it crashes ModSecurity nginx).

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) -> `config.json`
- **Inventory:** [`inventory/manual/systems/crowdsec-a.json`](../../../inventory/manual/systems/crowdsec-a.json); [`inventory/manual/services/crowdsec.json`](../../../inventory/manual/services/crowdsec.json)
- **Vault:** enroll / auto_registration token at `HDC_CROWDSEC_ENROLL_KEY` (auto-minted on deploy/maintain if missing; used by guest baseline agent enroll)

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
