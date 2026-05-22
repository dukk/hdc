# Home Data Center (HDC)

Automation and documentation for a manually deployed home data center. Agents operate and extend this repo via the **hdc** CLI and JSON inventory sidecars.

## Role

- Use structured facts from inventory and package configs — **do not invent** hostnames, IPs, bridges, VLANs, pool names, or credentials.
- Prefer tracked automation under `packages/` over one-off shell installs.
- Only create git commits when the user explicitly asks.

## Quick start

- **Node.js 18+** — the CLI uses built-in modules only; no `npm install` is required to run hdc.
- **Invoke hdc** (repo root):
  - Windows: `hdc.cmd <command>`
  - Cross-platform: `node tools/hdc/cli.mjs <command>`
  - macOS/Linux (after `chmod +x hdc`): `./hdc <command>`
- **Secrets:** copy [`.env.example`](.env.example) to `.env` (gitignored). API keys and passwords live in the encrypted vault at `~/.hdc/vault.enc` (see `secrets` commands below). Auth fields in inventory reference **env var names only**, never values.

## Repository map

| Path | Role |
| --- | --- |
| [`tools/hdc/`](tools/hdc/) | Node.js CLI (`cli.mjs`) and shared libraries |
| [`packages/<package>/`](packages/) | Plugins: `manifest.json` plus `deploy/`, `maintain/`, `query/` (`run.mjs`) |
| [`inventory/manual/`](inventory/manual/) | Authoritative sidecars: `systems/`, `networks/`, `services/`, `targets/` (`*.json`) |
| [`inventory/automated/`](inventory/automated/) | Overlay written by successful `run … query` / `deploy` (per-file under `systems/`, `networks/`, `policies/`) |
| [`docs/manually-deployed/`](docs/manually-deployed/) | Human-oriented markdown for gear hdc does not manage end-to-end |

Optional companion `*.md` next to inventory JSON is for humans/agents; **hdc does not read or write those files**.

## CLI (implemented)

Commands from [`tools/hdc/lib/cli-app.mjs`](tools/hdc/lib/cli-app.mjs):

| Command | Purpose |
| --- | --- |
| `help [topic …]` | Hierarchical usage |
| `list` | Packages and manifest metadata |
| `run <package> <verb> [-- <args>]` | Run a package script (`deploy`, `maintain`, `query`) |
| `secrets path \| init \| change-passphrase \| set \| list \| delete` | Encrypted vault for `HDC_*` secrets |
| `users bootstrap-hdc [--dry-run] [--sidecar <path> …]` | Ensure local `hdc` Linux user on bootstrap hosts |
| `env` | Print `HDC_*` variables (sensitive values redacted) |

Examples:

```bash
node tools/hdc/cli.mjs list
node tools/hdc/cli.mjs run proxmox query
node tools/hdc/cli.mjs run pi-hole deploy -- --help
node tools/hdc/cli.mjs help run proxmox maintain
```

**Not implemented in the CLI today:** `docs lint`, `docs sync`, and `inventory apply` appear in [README.md](README.md) and some `.cursor/rules/` files — treat as planned workflow until wired in `cli-app.mjs`. Validate inventory JSON against schemas under [`tools/hdc/schema/`](tools/hdc/schema/) instead.

## Inventory

- **Manual sidecars:** `inventory/manual/{systems,networks,services,targets}/*.json`, discriminated by `kind`: `system`, `network`, `target`, or `services`.
- **Systems** may list `services: [{ "id": "<id>", "nodes"?: ["…"] }]` pointing at `kind: "services"` records under `inventory/manual/services/` (by id only).
- **Targets:** `kind: "target"` with `automation_target` set to a package manifest id (e.g. `proxmox`, `unifi-network`).
- **Schemas:** [`inventory.schema.json`](tools/hdc/schema/inventory.schema.json) (union), plus `inventory.system.schema.json`, `inventory.network.schema.json`, `inventory.target.schema.json`, `inventory.services.schema.json`, `inventory.policy.schema.json`.
- **Automated overlay:** plugins may write under `inventory/automated/`; use `resolveSystemById` in code when merging manual and automated facts.

### System id naming

Filename stem must equal `id` (`<id>.json`). Follow [`.cursor/rules/hdc-inventory-naming.mdc`](.cursor/rules/hdc-inventory-naming.mdc):

| Workload | Prefix | Example |
| --- | --- | --- |
| Physical host / hypervisor | *(none)* | `pve-a`, `nas-primary` |
| VM | `vm-` | `vm-pi-hole-a` |
| LXC container | `ct-` | `ct-adguard-a` |
| Other virtual | `virt-` | `virt-vpn-endpoint-a` |

Multi-instance suffixes use **letters** (`-a`, `-b`), not numbers (`-1`, `-2`). Proxmox is authoritative for `system_class` when it disagrees with other sources.

## Packages

- Each package: [`packages/<folder>/manifest.json`](packages/) with `id`, optional `inventory_docs`, and `verbs` mapping to `deploy/run.mjs`, `maintain/run.mjs`, or `query/run.mjs`.
- **Infrastructure** (shared capabilities): `proxmox`, `unifi-network`, `ubuntu`.
- **Services** (apps on guests): e.g. `pi-hole`, `nagios`, `homeassistant`, `bind`, `jenkins`, `minecraft`, `ollama`, `postfix-relay`, `audiobookshelf`.

### Package script logging

When changing `packages/**/*.mjs`:

- **stderr** — user-visible progress, prompts, warnings.
- **stdout** — machine-only; on `query` / `deploy`, often a single JSON object at exit.
- **Secrets** — use `readLineQuestion(prompt, { mask: true })` from [`tools/hdc/lib/readline-masked.mjs`](tools/hdc/lib/readline-masked.mjs); never log tokens or passphrases.

See [`.cursor/rules/hdc-automation-logging.mdc`](.cursor/rules/hdc-automation-logging.mdc).

## Proxmox in this repo

- **Config:** [`packages/infrastructure/proxmox/config.json`](packages/infrastructure/proxmox/config.json) (copy from [`config.example.json`](packages/infrastructure/proxmox/config.example.json); keep local config out of git).
- **Inventory:** hypervisors in `inventory/manual/systems/` (tag `proxmox` or `automation_targets: ["proxmox"]`), plus [`inventory/manual/targets/proxmox.json`](inventory/manual/targets/proxmox.json).
- **Schema:** [`tools/hdc/schema/proxmox.config.schema.json`](tools/hdc/schema/proxmox.config.schema.json).

| hdc service id | Verb | Summary |
| --- | --- | --- |
| `lxc-create` | deploy | Create LXC via API (`create-container`) |
| `qemu-clone` | deploy | Clone QEMU VM from template (`create-vm`) |
| `qemu-list-templates` | deploy | List QEMU templates |
| `verify-templates` | maintain | SSH keys, API token ACL, templates, NAS storage, host OS updates |
| `bootstrap-hdc-user` | maintain | Local `hdc` user on bootstrap hosts |
| `cluster-snapshot` | query | Cluster/guest inventory JSON on stdout |

**Resource planning** (CPU, RAM, storage, bridges): follow [`.cursor/skills/proxmox-resource-planning/SKILL.md`](.cursor/skills/proxmox-resource-planning/SKILL.md) and [`.cursor/rules/proxmox-resource-planning.mdc`](.cursor/rules/proxmox-resource-planning.mdc).

## External reference: Proxmox VE Helper-Scripts

[community-scripts/ProxmoxVE](https://github.com/community-scripts/ProxmoxVE) — community one-command installers for LXC containers and VMs on Proxmox VE ([community-scripts.org](https://community-scripts.org)).

Use this collection as a **reference** when:

- Choosing self-hosted services or comparing default resource allocations.
- Understanding post-install helpers and common CT/VM patterns.
- Drafting new HDC service packages or manual runbooks.

**Do not** treat pasted install curls from that project as hdc automation. Prefer tracked packages under `packages/`, inventory sidecars, and `hdc run` for operations you want repeatable and documented in-repo.

## Secrets and safety

- Never commit `.env`, vault files, or secret values in chat, sidecars, or markdown.
- Store secrets in the vault via `node tools/hdc/cli.mjs secrets set <ENV_NAME>`; document only env var **names** in JSON `auth` fields.
- See [`.env.example`](.env.example) for Proxmox, Nagios, Postfix relay, and vault variables.

## Testing

After changes under `tools/hdc/`:

```bash
npm install   # devDependencies only (Vitest)
npm run test
```

Before merging substantive CLI changes, run `npm run test:coverage` and keep thresholds green ([`vitest.config.mjs`](vitest.config.mjs)).

## Deeper context (pointers)

| Topic | Location |
| --- | --- |
| Automation conventions | [`.cursor/rules/hdc-automation.mdc`](.cursor/rules/hdc-automation.mdc) |
| Inventory naming | [`.cursor/rules/hdc-inventory-naming.mdc`](.cursor/rules/hdc-inventory-naming.mdc) |
| Nagios + manual docs | [`.cursor/rules/hdc-nagios-monitoring.mdc`](.cursor/rules/hdc-nagios-monitoring.mdc) |
| Operator workflow | [`.cursor/skills/hdc-ops/SKILL.md`](.cursor/skills/hdc-ops/SKILL.md), [`.cursor/agents/hdc-ops.md`](.cursor/agents/hdc-ops.md) |
| Human README | [README.md](README.md) |
