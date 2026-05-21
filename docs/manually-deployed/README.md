# Manually Deployed

Human-oriented notes live in the `*.md` files under this tree.

## Inventory sidecars

Structured machine inventory lives under **`inventory/manual/<category>/`** as `*.json` (`systems/`, `networks/`, `services/`, `targets/`). Kinds are **system** (optional `services` array: `{ "id": "<services-sidecar-id>", "nodes"?: ["nodeName"] }` refs only), **network**, **target**, and **services** (service definitions referenced by systems). See `tools/hdc/schema/inventory.*.schema.json`. Optional same-basename `*.md` files are for human or agent notes only — **hdc does not read or write them**; use `node tools/hdc/cli.mjs docs lint` (or `docs sync` for the same JSON validation) after changing JSON.

Live or plugin-generated facts accumulate in **`inventory/automated/systems.json`** (updated on successful `hdc run <package> query|deploy`). Resolve a system id with automated overlay first, then manual: use `resolveSystemById` from `tools/hdc/inventory.mjs` or merge behavior documented in `hdc help run`.

## Optional companion markdown

Agents may keep free-form notes in a sibling `*.md` file; tables or markers are not synchronized by hdc from JSON.

## Systems

Narrative-only system pages may remain here; structured inventory for systems is under [`inventory/manual/systems/`](../../inventory/manual/systems/).

## Network