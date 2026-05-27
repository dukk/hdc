# {title} (`{id}`)

{one_line_description}

## Prerequisites

- **Config:** copy [`config.example.json`](config.example.json) to `config.json` (gitignored) when this package uses one.
- **Inventory:** {inventory_paths}
- **Vault / env:** {vault_keys} — store values with `node tools/hdc/cli.mjs secrets set <NAME>`; never commit secrets.

## Commands

| Verb | Purpose |
|------|---------|
| {verb_table_rows} |

From the repo root (Windows: `hdc.cmd` instead of `node tools/hdc/cli.mjs`):

```bash
node tools/hdc/cli.mjs run {id} <verb> --
node tools/hdc/cli.mjs help run {id}
```

## Common flags

Pass flags after `--`:

{flags_list}

Shared: `--dry-run`, `--no-report`, `--report <path>` (deploy/maintain/teardown write markdown under `packages/{id}/reports/` in hdc-private when present, else public hdc).

## After deploy

{after_deploy_section}

## Related

- [AGENTS.md](../../AGENTS.md) — agent-oriented index
- [`tools/hdc/schema/`](../../tools/hdc/schema/) — JSON schemas when present
