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

- Cross-platform: `node tools/hdc/cli.mjs <command>`
- Windows (repo root): `hdc.cmd <command>`
- macOS / Linux (repo root, after `chmod +x hdc`): `./hdc <command>`

Load secrets from a repo-root `.env` file (gitignored). See `.env.example` for documented variable names.

## Commands

1. **List** hdc packages and inventory sidecars:

   `node tools/hdc/cli.mjs list`

2. **Run** a package verb (`deploy`, `maintain`, `query`). Extra args after `--` go to the package script:

   `node tools/hdc/cli.mjs run pi-hole query`

   `node tools/hdc/cli.mjs run pi-hole query -- --verbose`

3. **Lint** inventory JSON (`docs lint`). Optional **`docs sync`** runs the same validation; hdc does not read or write companion `.md` files.

   `node tools/hdc/cli.mjs docs lint`

   `node tools/hdc/cli.mjs docs sync --dry-run`

   `node tools/hdc/cli.mjs docs sync`

4. **Apply** query JSON output into a sidecar (explicit merge of `query_last` and `last_verified`):

   `node tools/hdc/cli.mjs inventory apply --sidecar inventory/manual/systems/foo.json --from-json /path/to/query.json`

## After query output

1. Save plugin stdout JSON to a file if needed.
2. Run `inventory apply` only after human review.
3. Run `docs lint` after inventory JSON changes (companion `.md` is for agents only; hdc does not update it).

## Secrets

Do not put secret values in sidecars, markdown, or chat. Only env var **names** in `auth` and similar fields.

## System naming

When creating or renaming `kind: "system"` inventory ids, follow **`.cursor/rules/hdc-inventory-naming.mdc`**:

- Physical: no class prefix (`pve-h`, `nas-primary`)
- VMs: `vm-<role>-<letter>` (e.g. `vm-nginx-proxy-a`)
- Containers: `ct-<role>-<letter>`
- Use alphabet instance suffixes (`-a`, `-b`), not numbers (`-1`, `-2`)
