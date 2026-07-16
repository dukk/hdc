# Home Data Center (HDC)

Automation and documentation for a manually deployed home data center.

> **Public repo:** automation code and `config.example.json` templates live here. Live `config.json`, inventory, and operator notes belong in a separate private **hdc-private** checkout (`HDC_PRIVATE_ROOT`).

**Build your own from scratch:** [Getting Started](docs/getting-started.md) takes you from nothing to a running lab with an agent fleet, in five steps.

**How the repos fit together:** [Three repositories](docs/three-repos.md) — hdc, hdc-private, and hdc-clumps, and how to set up your site.

**Want the big picture first?** [ARCHITECTURE.md](ARCHITECTURE.md) explains what HDC is and how it works end-to-end — the CLI and package runtime, the agent fleet, APIs, and deployment topology — with diagrams.

## What are clumps?

A **clump** is just a package or bundle of related scripts — a `manifest.json` plus `deploy/`, `maintain/`, and `query/` automation for one service or capability. You could call it a plugin or a module; those words are fine and accurate, but they are also everywhere. This project had fun with the naming instead of adding one more generic label.

![Dung beetles rolling server clumps through the woods](assets/b85c275b-8e32-491d-a77f-59ad56886f16.jpg)

HDC is about leveraging AI-assisted code — however sloppy it might be — to support a home-lab hobby that is **always learning** and **always growing**. The stereotype is part of the point: embrace messy iteration, ship automation, learn from what breaks, and **fail forward** rather than waiting for polish that never ships.

For how the three repos fit together, see [Three repositories](docs/three-repos.md). To bootstrap package code on your machine, see [Clump packages (hdc-clumps)](#clump-packages-hdc-clumps) below.

## Agent ownership

This repository is the **platform** home — CLI, schemas, shared package runtime, agent fleet, tests, and public docs — owned by the **human/operator**. Fleet agents must not write hdc. Package automation scripts live in [**hdc-clumps**](../hdc-clumps/README.md) (`hdc-sre-engineer`); live operator state lives in [**hdc-private**](../hdc-private/README.md) (`hdc-sre-ops`). See [multi-agent operations](docs/multi-agent-ops.md) for the full roster and handoff rules.

| Repository | Owner | Owns |
| --- | --- | --- |
| **hdc** (this repo) | Human / operator | `apps/hdc-cli/`, schemas, `hdc/package/*`, `apps/hdc-agent-server/`, tests |
| [**hdc-clumps**](../hdc-clumps/README.md) | `hdc-sre-engineer` | Package manifests, deploy/maintain/query scripts, `config.example.json` |
| [**hdc-private**](../hdc-private/README.md) | `hdc-sre-ops` | Live `config.json`, inventory, `operations/` (tasks, digests, plans) |

## Requirements

- **Node.js 18+** (uses built-in modules only; no `npm install` required for the CLI).

## CLI

From the repository root use `hdc <command>` (`hdc.cmd` on Windows, `./hdc` on Unix after `chmod +x hdc`):

```bash
hdc list
hdc run service pi-hole query
hdc docs lint
hdc docs sync
```

`docs sync` validates the same JSON as `docs lint` and does not modify markdown.

Optional: copy [`.env.example`](.env.example) to `.env` and set values. `.env` is gitignored.

## Private operator data (hdc-private)

Clump `config.json` files and inventory JSON (except [`operations/inventory/systems/_example.json`](operations/inventory/systems/_example.json)) belong in a separate **hdc-private** repository with the same directory layout — owned by **`hdc-sre-ops`** for live ops. Clone it beside this repo (`../hdc-private`) or set `HDC_PRIVATE_ROOT` in `.env`. Hdc loads **public hdc first**, then hdc-private. See [hdc-private README](../hdc-private/README.md) (sibling checkout).

## Clump packages (hdc-clumps)

See [What are clumps?](#what-are-clumps) above. Service and infrastructure packages live in the separate **[hdc-clumps](https://github.com/dukk/hdc-clumps)** repository — owned by **`hdc-sre-engineer`** for package scripts. Bootstrap on a new machine:

```bash
hdc clumps init
hdc clumps list
```

Package scripts import shared runtime via `hdc/package/*` (resolved by the CLI import hook). See [`hdc-clumps` README](../hdc-clumps/README.md) for per-package docs.

## Layout

| Path | Role | Owner |
| --- | --- | --- |
| [`apps/hdc-cli/`](apps/hdc-cli/) | Node.js CLI (`cli.mjs`), package runtime (`lib/package/`), and helpers | Human / operator |
| [`apps/hdc-agent-server/`](apps/hdc-agent-server/) | Fleet agent definitions, skills, dispatcher runtime | Human / operator |
| **hdc-clumps** (external) | HDC plugins: run `hdc clumps init` then see [hdc-clumps README](../hdc-clumps/README.md) for every package | `hdc-sre-engineer` |
| [`operations/inventory/`](operations/inventory/) | Operator sidecars in **hdc-private**; public repo keeps [`systems/_example.json`](operations/inventory/systems/_example.json) only | `hdc-sre-ops` |
| [`operations/automated/`](operations/automated/) | Operator overlay in **hdc-private** (UniFi/Proxmox query snapshots) | `hdc-sre-ops` |
| [`docs/manually-deployed/`](docs/manually-deployed/) | Markdown notes for manually operated gear (structured inventory lives under `operations/inventory/`) | — |
| [`.cursor/`](.cursor/) | Canonical agent rules, skills, subagents, and automations (read directly by Cursor) | — |
| [`.claude/`](.claude/) | Claude Code support: thin pointers into `.cursor/` skills and agents; [CLAUDE.md](CLAUDE.md) imports `.cursor/rules/` | — |

Inventory JSON schemas (discriminated by `kind`): [`apps/hdc-cli/schema/inventory.schema.json`](apps/hdc-cli/schema/inventory.schema.json) (union), [`inventory.system.schema.json`](apps/hdc-cli/schema/inventory.system.schema.json), [`inventory.network.schema.json`](apps/hdc-cli/schema/inventory.network.schema.json), [`inventory.target.schema.json`](apps/hdc-cli/schema/inventory.target.schema.json), [`inventory.services.schema.json`](apps/hdc-cli/schema/inventory.services.schema.json).
