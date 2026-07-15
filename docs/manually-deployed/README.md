# Manually Deployed

Human-oriented notes live in the `*.md` files under this tree.

## Inventory sidecars

Structured machine inventory lives under **`inventory/manual/<category>/`** as `*.json` (`systems/`, `networks/`, `services/`, `targets/`). Kinds are **system** (optional `services` array: `{ "id": "<services-sidecar-id>", "nodes"?: ["nodeName"] }` refs only), **network**, **target**, and **services** (service definitions referenced by systems). See `apps/hdc-cli/schema/inventory.*.schema.json`. Optional same-basename `*.md` files are for human or agent notes only — **hdc does not read or write them**; use `hdc docs lint` (or `docs sync` for the same JSON validation) after changing JSON.

Live or plugin-generated facts accumulate in **`inventory/automated/systems.json`** (updated on successful `hdc run <tier> <clump> query|deploy`). Resolve a system id with automated overlay first, then manual: use `resolveSystemById` from `apps/hdc-cli/inventory.mjs` or merge behavior documented in `hdc help run`.

## Optional companion markdown

Agents may keep free-form notes in a sibling `*.md` file; tables or markers are not synchronized by hdc from JSON.

## Systems

Narrative-only system pages may remain here; structured inventory for systems is under [`inventory/manual/systems/`](../../inventory/manual/systems/).

## Network

## Operator tools

- [Bitwarden CLI (`bw`) for hdc secrets](bitwarden-cli.md) — Vaultwarden unlock and secret storage when `HDC_SECRET_BACKEND` is `vaultwarden` or `auto`.
- [Cloudflare DNS](cloudflare.md) — API token and public zone management via `hdc run infrastructure cloudflare`.
- [SMTP2GO sender domains](smtp2go.md) — API key and verified sender domain inventory via `hdc run infrastructure smtp2go`.