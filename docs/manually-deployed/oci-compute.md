# Oracle Cloud compute (HDC)

HDC package `oci-compute` provisions **Oracle Cloud Infrastructure** networking and compute: VCN, public subnet, internet gateway, NSG, Compute VMs, and Container Instances.

## Prerequisites

1. OCI tenancy and target **compartment**.
2. IAM user with API signing key and policies such as:
   - `manage virtual-network-family in compartment <name>`
   - `manage instance-family in compartment <name>`
   - `manage container-instances in compartment <name>`
3. Repo `.env`:
   - `HDC_OCI_TENANCY_OCID`
   - `HDC_OCI_USER_OCID`
   - `HDC_OCI_FINGERPRINT`
   - `HDC_OCI_REGION`
4. Vault: `node tools/hdc/cli.mjs secrets set HDC_OCI_API_PRIVATE_KEY`
5. hdc-private `packages/infrastructure/oci-compute/config.json` (copy from `config.example.json` in the public repo).

## Image OCIDs

Compute instances require a region-specific `image_ocid` (for example Canonical Ubuntu 22.04 from Marketplace). Look up the OCID in OCI Console → Compute → Custom Images / Marketplace, then set it in config.

## Cost confirmation

Deploy uses fallback price tables when live OCI pricing APIs are not queried. Estimates appear on stderr and in operation reports; deploy prompts unless `--yes`.

| Flag | Effect |
|------|--------|
| `--dry-run` | Plan + estimate only |
| `--yes` | Skip confirmation |
| `--accept-unknown-cost` | Proceed without numeric estimate |

## Commands

```bash
node tools/hdc/cli.mjs run infrastructure oci-compute query --
node tools/hdc/cli.mjs run infrastructure oci-compute query -- --live
node tools/hdc/cli.mjs run infrastructure oci-compute deploy -- --dry-run
node tools/hdc/cli.mjs run infrastructure oci-compute deploy -- --resource a
node tools/hdc/cli.mjs run infrastructure oci-compute maintain -- --prune
node tools/hdc/cli.mjs run infrastructure oci-compute teardown -- --all --yes
```

## Inventory

Add virtual systems with `virt-` prefix (for example `virt-oci-a`) and optional target sidecar `inventory/manual/targets/oci-compute.json` with `automation_target: "oci-compute"`.

## Limitations (v1)

- No automatic image lookup; `image_ocid` required per VM.
- Public subnets only (IGW + default route); no NAT gateway.
- Fallback cost estimates exclude data transfer and tax.
- Container Instances availability varies by region.
