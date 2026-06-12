# Azure compute (HDC)

Deploy **Azure VMs** and **Azure Container Instances (ACI)** with cost estimates and interactive confirmation before billable provision.

## Config

Copy [`config.example.json`](config.example.json) to hdc-private as `packages/infrastructure/azure-compute/config.json`.

## Secrets

| Name | Where |
|------|--------|
| `HDC_AZURE_COMPUTE_SUBSCRIPTION_ID` | `.env` |
| `HDC_AZURE_COMPUTE_TENANT_ID` | `.env` |
| `HDC_AZURE_COMPUTE_CLIENT_ID` | `.env` |
| `HDC_AZURE_COMPUTE_CLIENT_SECRET` | vault |

Service principal needs **Contributor** on the target resource group.

## Commands

```bash
node tools/hdc/cli.mjs run infrastructure azure-compute query --
node tools/hdc/cli.mjs run infrastructure azure-compute deploy -- --instance a --dry-run
node tools/hdc/cli.mjs run infrastructure azure-compute deploy -- --instance a
node tools/hdc/cli.mjs run infrastructure azure-compute maintain --
node tools/hdc/cli.mjs run infrastructure azure-compute teardown -- --instance a --yes
```

Deploy prints a monthly cost estimate (Azure Retail Prices API) and prompts `[y/N]` unless `--yes`. Use `--accept-unknown-cost` when pricing is unavailable.

See [`docs/manually-deployed/azure-compute.md`](../../../docs/manually-deployed/azure-compute.md).
