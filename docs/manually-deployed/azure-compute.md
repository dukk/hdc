# Azure compute (HDC)

HDC package `azure-compute` provisions **Azure Virtual Machines** and **Azure Container Instances** via Azure Resource Manager REST APIs.

## Prerequisites

1. **Service principal** with **Contributor** on the target resource group (not the Entra Graph app used by `infrastructure/azure`).
2. Repo `.env`:
   - `HDC_AZURE_COMPUTE_SUBSCRIPTION_ID`
   - `HDC_AZURE_COMPUTE_TENANT_ID`
   - `HDC_AZURE_COMPUTE_CLIENT_ID`
3. Vault: `HDC_AZURE_COMPUTE_CLIENT_SECRET`
4. hdc-private `clumps/infrastructure/azure-compute/config.json` (seed from `config.example.json`).
5. Optional inventory: `inventory/manual/targets/azure-compute.json`, system sidecars `virt-azure-compute-a.json`, etc.

## Cost confirmation

Before any billable `deploy`, hdc:

1. Fetches an estimate from the public [Azure Retail Prices API](https://prices.azure.com/api/retail/prices).
2. Prints line items on **stderr** and in the operation report **Cost estimate** section.
3. Prompts `Proceed with estimated $X/month? [y/N]` on a TTY.

Flags:

| Flag | Effect |
|------|--------|
| `--dry-run` | Estimate only; no ARM mutations |
| `--yes` | Skip prompt (CI / automation) |
| `--accept-unknown-cost` | Proceed when pricing API returns no estimate |

## Commands

```bash
node apps/hdc-cli/cli.mjs run infrastructure azure-compute query --
node apps/hdc-cli/cli.mjs run infrastructure azure-compute query -- --live
node apps/hdc-cli/cli.mjs run infrastructure azure-compute deploy -- --instance a --dry-run
node apps/hdc-cli/cli.mjs run infrastructure azure-compute deploy -- --instance a
node apps/hdc-cli/cli.mjs run infrastructure azure-compute maintain --
node apps/hdc-cli/cli.mjs run infrastructure azure-compute teardown -- --instance a --yes
```

Estimates exclude egress, snapshots, reserved-instance discounts, and tax.
