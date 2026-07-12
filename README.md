# Home Data Center (HDC)

Automation and documentation for a manually deployed home data center.

> **Public repo:** automation code and `config.example.json` templates live here. Live `config.json`, inventory, and operator notes belong in a separate private **hdc-private** checkout (`HDC_PRIVATE_ROOT`).

## Requirements

- **Node.js 18+** (uses built-in modules only; no `npm install` required for the CLI).

## CLI

From the repository root:

```bash
node apps/hdc-cli/cli.mjs list
node apps/hdc-cli/cli.mjs run service pi-hole query
node apps/hdc-cli/cli.mjs docs lint
node apps/hdc-cli/cli.mjs docs sync
```

`docs sync` validates the same JSON as `docs lint` and does not modify markdown.

On Windows you can use `hdc.cmd` instead of `node apps/hdc-cli/cli.mjs`. On macOS or Linux, use `./hdc` after `chmod +x hdc`.

Optional: copy [`.env.example`](.env.example) to `.env` and set values. `.env` is gitignored.

## Private operator data (hdc-private)

Clump `config.json` files and inventory JSON (except [`inventory/manual/systems/_example.json`](inventory/manual/systems/_example.json)) belong in a separate **hdc-private** repository with the same directory layout. Clone it beside this repo (`../hdc-private`) or set `HDC_PRIVATE_ROOT` in `.env`. Hdc loads **public hdc first**, then hdc-private. See [hdc-private README](../hdc-private/README.md) (sibling checkout).

## Layout

| Path | Role |
| --- | --- |
| [`apps/hdc-cli/`](apps/hdc-cli/) | Node.js CLI (`cli.mjs`) and helpers |
| [`clumps/`](clumps/README.md) | HDC plugins: see [`clumps/README.md`](clumps/README.md) for links to every package README, config, and access endpoints. Each package has `manifest.json`, optional `config.json`, plus `deploy/`, `maintain/`, `query/` (`run.mjs`). *Service* packages deploy apps; *infrastructure* packages expose shared capabilities (e.g. VM/CT provisioning). |
| [`inventory/manual/`](inventory/manual/) | Operator sidecars in **hdc-private**; public repo keeps `_example.json` only |
| [`inventory/automated/`](inventory/automated/) | Operator overlay in **hdc-private** (UniFi/Proxmox query snapshots) |
| [`docs/manually-deployed/`](docs/manually-deployed/) | Markdown notes for manually operated gear (structured inventory lives under `inventory/manual/`) |

Inventory JSON schemas (discriminated by `kind`): [`apps/hdc-cli/schema/inventory.schema.json`](apps/hdc-cli/schema/inventory.schema.json) (union), [`inventory.system.schema.json`](apps/hdc-cli/schema/inventory.system.schema.json), [`inventory.network.schema.json`](apps/hdc-cli/schema/inventory.network.schema.json), [`inventory.target.schema.json`](apps/hdc-cli/schema/inventory.target.schema.json), [`inventory.services.schema.json`](apps/hdc-cli/schema/inventory.services.schema.json).
