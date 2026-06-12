# GCP compute (HDC)

HDC package `gcp-compute` provisions **Google Compute Engine VMs** and **Cloud Run** services.

## Prerequisites

1. GCP project with Compute Engine and Cloud Run APIs enabled.
2. **Service account** with roles such as Compute Admin, Cloud Run Admin, and Service Account User (tighten per your org policy).
3. Repo `.env`: `HDC_GCP_COMPUTE_PROJECT_ID`
4. Vault: `HDC_GCP_COMPUTE_SERVICE_ACCOUNT_JSON` (full key JSON from Console).
5. hdc-private `packages/infrastructure/gcp-compute/config.json` (seed from `config.example.json`).

## Cost confirmation

Deploy uses on-demand **fallback price tables** when the Cloud Billing Catalog API is unavailable. Estimates are shown on stderr and in operation reports; deploy prompts for confirmation unless `--yes`.

| Flag | Effect |
|------|--------|
| `--dry-run` | Estimate only |
| `--yes` | Skip prompt |
| `--accept-unknown-cost` | Proceed without a numeric estimate |

## Commands

```bash
node tools/hdc/cli.mjs run infrastructure gcp-compute query --
node tools/hdc/cli.mjs run infrastructure gcp-compute query -- --live
node tools/hdc/cli.mjs run infrastructure gcp-compute deploy -- --instance a --dry-run
node tools/hdc/cli.mjs run infrastructure gcp-compute deploy -- --instance a
node tools/hdc/cli.mjs run infrastructure gcp-compute maintain --
node tools/hdc/cli.mjs run infrastructure gcp-compute teardown -- --instance a --yes
```

Cloud VMs receive operator `~/.ssh` public keys via instance metadata.
