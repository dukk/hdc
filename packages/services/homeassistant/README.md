# Home Assistant (`homeassistant`)

**Deploy is a stub** — no automated Home Assistant install yet.

## Prerequisites

- **Inventory:** [`inventory/manual/systems/vm-homeassistant-a.json`](../../../inventory/manual/systems/vm-homeassistant-a.json)
- **Config:** optional `config.json` with SSH for ClamAV-only maintain

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | Stub — no remote changes |
| `maintain` | ClamAV when `configure.ssh` is configured |
| `query` | Summary stub |

```bash
node tools/hdc/cli.mjs run service homeassistant maintain --
```

## Common flags

`--skip-clamav`, `--dry-run`, `--no-report`.

## After deploy

Run Home Assistant via your chosen method (OS image, VM, container). Default UI is usually **`http://<host>:8123`** once you install it outside hdc.

## Related

- [AGENTS.md — stub services](../../../AGENTS.md)
