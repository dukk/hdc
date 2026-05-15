# Home Data Center (HDC)

Automation and documentation for a manually deployed home data center.

## Requirements

- **Node.js 18+** (uses built-in modules only; no `npm install` required for the CLI).

## CLI

From the repository root:

```bash
node tools/hdc/cli.mjs list
node tools/hdc/cli.mjs run pi-hole query
node tools/hdc/cli.mjs docs lint
node tools/hdc/cli.mjs docs sync
```

`docs sync` validates the same JSON as `docs lint` and does not modify markdown.

On Windows you can use `hdc.cmd` instead of `node tools/hdc/cli.mjs`. On macOS or Linux, use `./hdc` after `chmod +x hdc`.

Optional: copy [`.env.example`](.env.example) to `.env` and set values. `.env` is gitignored.

## Layout

| Path | Role |
| --- | --- |
| [`tools/hdc/`](tools/hdc/) | Node.js CLI (`cli.mjs`) and helpers |
| [`automation/<target>/`](automation/) | `manifest.json`, `inventory.json` (query snapshot), plus `deploy/`, `maintain/`, `query/` (`run.mjs`) |
| [`inventory/manual/`](inventory/manual/) | `systems/`, `networks/`, `services/`, `targets/` — `*.inventory.json` sidecars; optional same-basename `*.md` for agents (hdc does not read or write those `.md` files) |
| [`inventory/automated/`](inventory/automated/) | `systems.json` updated by successful `hdc run … query` / `deploy` (automated overlay; use `resolveSystemById` in code) |
| [`docs/manually-deployed/`](docs/manually-deployed/) | Markdown notes for manually operated gear (structured inventory lives under `inventory/manual/`) |

Inventory JSON schemas (discriminated by `kind`): [`tools/hdc/schema/inventory.schema.json`](tools/hdc/schema/inventory.schema.json) (union), [`inventory.system.schema.json`](tools/hdc/schema/inventory.system.schema.json), [`inventory.network.schema.json`](tools/hdc/schema/inventory.network.schema.json), [`inventory.target.schema.json`](tools/hdc/schema/inventory.target.schema.json), [`inventory.services.schema.json`](tools/hdc/schema/inventory.services.schema.json).
