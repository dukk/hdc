# UniFi Network (`unifi-network`)

Pull sites, clients, networks, and firewall policies from the UniFi Network API into JSON on stdout (automated inventory overlay).

## Prerequisites

- **Config:** copy [`config.example.json`](config.example.json) to `config.json`.
- **Inventory:** [`inventory/manual/targets/unifi-network.json`](../../../inventory/manual/targets/unifi-network.json).
- **Vault / env:** UniFi API credentials per config (env var names only in config; set values in vault).

## Commands

| Verb | Purpose |
|------|---------|
| `query` | Network snapshot (JSON on stdout) |

```bash
node tools/hdc/cli.mjs run infrastructure unifi-network query --
node tools/hdc/cli.mjs help run infrastructure unifi-network
```

### Capability

| Service id | Verb | Summary |
|------------|------|---------|
| `network-snapshot` | query | Sites, clients, networks, firewall policies |

## Common flags

Pass after `--` as documented in `query/run.mjs`. No deploy or maintain verbs.

## After deploy / Using the service

1. **UniFi controller UI:** URL from your UniFi deployment (inventory target / manual docs), not invented by hdc.
2. **hdc output:** parse JSON from stdout after `query`; successful runs may update `inventory/automated/`.
3. This package does not change controller configuration.

## Related

- [`inventory/manual/targets/unifi-network.json`](../../../inventory/manual/targets/unifi-network.json)
