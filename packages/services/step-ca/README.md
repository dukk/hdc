# step-ca (`step-ca`)

Deploy Smallstep `step-ca` on Proxmox QEMU for internal certificate authority (ACME/API).

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json`
- **Inventory:** [`inventory/manual/systems/vm-step-ca-a.json`](../../../inventory/manual/systems/vm-step-ca-a.json); [`inventory/manual/services/step-ca.json`](../../../inventory/manual/services/step-ca.json)
- **Vault:** `HDC_STEP_CA_PASSWORD` (required); optional `HDC_STEP_CA_PASSWORD_A`

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | QEMU clone, `step ca init`, systemd under `/etc/step-ca` |
| `maintain` | Re-push `ca.json` and password file; optional package upgrade |
| `query` | CA service and health |

```bash
node tools/hdc/cli.mjs run service step-ca deploy --
node tools/hdc/cli.mjs run service step-ca maintain --
```

## Common flags

`--instance a`, `--destroy-existing`, `--skip-provision`, `--skip-install`, `--skip-existing`, `--skip-package-upgrade`, `--dry-run`.

## After deploy

1. **HTTPS:** step-ca listens per `ca.json` (typical ACME/API on the VM IP — check config and query output).
2. **Trust:** distribute `/etc/step-ca/certs/root_ca.crt` to clients manually after deploy.
3. Use step CLI or ACME clients against your CA URL once the service is up.

## Related

- [AGENTS.md — step-ca](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/step-ca.config.schema.json`](../../../tools/hdc/schema/step-ca.config.schema.json)
