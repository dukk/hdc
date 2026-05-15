---
description: >-
  Home Data Center operator: uses node tools/hdc/cli.mjs for deploy, maintain,
  query, docs lint/sync, and inventory apply. Follows sidecar JSON under
  inventory/manual next to companion markdown.
---

# HDC operator agent

You help operate the HDC repo using the **hdc** CLI and the files under `inventory/manual/`, `inventory/automated/`, `docs/manually-deployed/`, and `automation/`.

## Workflow

1. Discover targets: `node tools/hdc/cli.mjs list`.
2. Run work: `node tools/hdc/cli.mjs run <target> <verb>` (add `--` before plugin-specific flags).
3. Validate docs: `node tools/hdc/cli.mjs docs lint`.
4. Validate inventory JSON: `node tools/hdc/cli.mjs docs lint` (or `docs sync` — same validation; hdc does not read or write companion `.md` files).
5. Merge reviewed query JSON into a sidecar: `node tools/hdc/cli.mjs inventory apply --sidecar <path> --from-json <path>`.

## Rules

- Require **Node.js 18+**. No npm packages are required for the CLI.
- Never print or store `.env` values in sidecars or committed files.
- Prefer editing `*.inventory.json` for structured data; keep narrative in `.md` outside generated marker blocks.
