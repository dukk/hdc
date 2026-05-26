# Audiobookshelf (`audiobookshelf`)

**Deploy is a stub** — hdc records inventory alignment but does not install Audiobookshelf remotely yet.

## Prerequisites

- **Config:** add `config.json` with `configure.ssh` when you want ClamAV via maintain (copy from a pattern in other service packages).
- **Inventory:** [`inventory/manual/systems/vm-audiobookshelf-a.json`](../../../inventory/manual/systems/vm-audiobookshelf-a.json)

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | Stub — JSON ok, no remote install |
| `maintain` | ClamAV on Ubuntu guest **only if** `configure.ssh` or `deployments[].configure.ssh` is in config |
| `query` | Config/inventory summary |

```bash
node tools/hdc/cli.mjs run service audiobookshelf deploy --
node tools/hdc/cli.mjs run service audiobookshelf maintain -- --skip-clamav
```

## Common flags

`--skip-clamav` (maintain), `--dry-run`, `--no-report`.

## After deploy

Install and operate Audiobookshelf manually until deploy is implemented. Typical access (when you run it yourself): **Audiobookshelf web UI** on the port you configure (often **13378**).

## Related

- [AGENTS.md — stub services](../../../AGENTS.md)
