# Fleet automation rules (summary)

Full Cursor rules still live under `.cursor/rules/` for IDE sessions. Fleet agents follow these constraints:

- Never invent hostnames, IPs, bridges, VLANs, or credentials — use inventory, clump configs, and `operations/ip-allocations.md`.
- Secrets: env var **names** only; values stay in the vault.
- Prefer `hdc run` / tracked clumps over one-off scripts. No `tmp-*` at hdc or hdc-private repo roots (ephemeral only under `tools/scripts/tmp-*`).
- System ids: physical/LXC unprefixed; QEMU VMs use `vm-`; multi-instance letters (`-a`, `-b`), not numbers.
- Package progress on stderr; stdout clean for JSON when the CLI parses it.
- After `apps/hdc-cli/` changes: `npm run test` (engineer's responsibility).
