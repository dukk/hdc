---
name: hdc-ops
description: >-
  Runs Home Data Center (HDC) operations via the Node.js hdc CLI: list packages,
  run deploy/maintain/query for a package, lint inventory JSON, or validate with docs sync. Use when the user asks to deploy, maintain, query, discover state,
  lint inventory, or update manually-deployed docs.
disable-model-invocation: true
---

# HDC ops (project)

## Human-first

Humans run the same commands as the agent. Never assume AI-only workflows.

## Entry points

- Cross-platform: `node apps/hdc-cli/cli.mjs <command>`
- Windows (repo root): `hdc.cmd <command>`
- macOS / Linux (repo root, after `chmod +x hdc`): `./hdc <command>`

Load secrets from a repo-root `.env` file (gitignored). See `.env.example` for documented variable names.

## Commands

1. **List** hdc packages and inventory sidecars:

   `node apps/hdc-cli/cli.mjs list`

2. **Run** a package verb (`deploy`, `maintain`, `query`). Tier is `client`, `infrastructure`, or `service` (maps to `clumps/clients`, `clumps/infrastructure`, `clumps/services`). Extra args after `--` go to the package script:

   `node apps/hdc-cli/cli.mjs run service pi-hole query`

   `node apps/hdc-cli/cli.mjs run service pi-hole query -- --verbose`

3. **Daily maintain** — cross-package orchestrator (safe updates, health checks, no prune/reboot):

   `node apps/hdc-cli/cli.mjs maintain daily`

   `node apps/hdc-cli/cli.mjs maintain daily --dry-run`

   `node apps/hdc-cli/cli.mjs maintain daily -- --only service/bind`

   Writes `apps/hdc-cli/reports/daily-maintain-<timestamp>.md`. Schedule via Task Scheduler or cron on the operator host.

4. **Lint** inventory JSON (`docs lint`). Optional **`docs sync`** runs the same validation; hdc does not read or write companion `.md` files.

   `node apps/hdc-cli/cli.mjs docs lint`

   `node apps/hdc-cli/cli.mjs docs sync --dry-run`

   `node apps/hdc-cli/cli.mjs docs sync`

5. **Apply** query JSON output into a sidecar (explicit merge of `query_last` and `last_verified`):

   `node apps/hdc-cli/cli.mjs inventory apply --sidecar inventory/manual/systems/foo.json --from-json /path/to/query.json`

## After query output

1. Save plugin stdout JSON to a file if needed.
2. Run `inventory apply` only after human review.
3. Run `docs lint` after inventory JSON changes (companion `.md` is for agents only; hdc does not update it).

## Secrets

Do not put secret values in sidecars, markdown, or chat. Only env var **names** in `auth` and similar fields.

## System naming

When creating or renaming `kind: "system"` inventory ids, follow **`.cursor/rules/hdc-inventory-naming.mdc`**:

- Physical: no class prefix (`hypervisor-h`, `nas-primary`)
- VMs: `vm-<role>-<letter>` (e.g. `vm-nginx-proxy-a`)
- Containers: `<role>-<letter>` (e.g. `ollama-a`)
- Use alphabet instance suffixes (`-a`, `-b`), not numbers (`-1`, `-2`)
