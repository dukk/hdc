# {title} (`{id}`)

{one_line_description}

## Prerequisites

- **Config:** copy [`config.example.json`](config.example.json) to `config.json` (gitignored) when this package uses one.
- **Inventory:** {inventory_paths}
- **Vault / env:** {vault_keys} — store values with `node apps/hdc-cli/cli.mjs secrets set <NAME>`; never commit secrets.

## Commands

| Verb | Purpose |
|------|---------|
| {verb_table_rows} |

From the repo root (Windows: `hdc.cmd` instead of `node apps/hdc-cli/cli.mjs`):

```bash
node apps/hdc-cli/cli.mjs run {id} <verb> --
node apps/hdc-cli/cli.mjs help run {id}
```

## Common flags

Pass flags after `--`:

{flags_list}

Shared: `--dry-run`, `--no-report`, `--report <path>` (deploy/maintain/teardown write markdown under `clumps/{id}/reports/` in hdc-private when present, else public hdc).

## After deploy

{after_deploy_section}

## Related

- [AGENTS.md](../../AGENTS.md) — agent-oriented index
- [`apps/hdc-cli/schema/`](../../apps/hdc-cli/schema/) — JSON schemas when present
