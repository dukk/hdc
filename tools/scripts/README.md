# tools/scripts

Operator and agent helper scripts that are **not** hdc clump verbs.

## Policy

1. **Prefer** `hdc run <tier> <clump> <verb>` and extending packages under `clumps/`.
2. **Never** put scratch or one-off scripts at the hdc / hdc-private **repo root** (`tmp-*` or similar).
3. **Ephemeral diagnostics** (gitignored): `tools/scripts/tmp-<short-purpose>.mjs` (or `.py`). Delete when the gap is closed or folded into a clump.
4. **Durable utilities** (tracked): `tools/scripts/<descriptive-name>.mjs` — no `tmp-` prefix (e.g. `rename-ct-inventory.mjs`).

See `.cursor/rules/hdc-automation.mdc`.
