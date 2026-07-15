# Azure (Entra + compute)

The **azure** infrastructure package (`clumps/infrastructure/azure/`) manages:

1. **Entra** — Microsoft Entra application registrations via Microsoft Graph
2. **Compute** — Azure VMs and ACI via Azure Resource Manager

Use `--section entra|compute|all` on verbs (default **entra** for deploy/maintain/query; teardown is compute-only).

Keep **two service principals**: Graph automation (`Application.ReadWrite.All`) is separate from the ARM compute SP (**Contributor** on the resource group).

## Entra bootstrap

Create a dedicated app registration for hdc (for example **HDC Entra Automation**):

1. In [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations** → **New registration**.
2. Supported account types: **Single tenant** (recommended for home/lab).
3. No redirect URI required for this automation app.
4. Under **Certificates & secrets**, create a **client secret** and store it in the hdc vault (never commit).
5. Under **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**:
   - **Application.ReadWrite.All** (required to create and update app registrations you did not create)
6. **Grant admin consent** for the tenant.

Record in clump `.env` (hdc-private preferred). Default `entra.automation.app_id` is `hdc`:

```bash
HDC_AZURE_ENTRA_TENANT_ID=<directory-tenant-id>
HDC_AZURE_ENTRA_HDC_APPLICATION_ID=<automation-app-application-client-id>
# Optional — portal Secret ID for operator tracking only (never used in token requests):
# HDC_AZURE_ENTRA_HDC_SECRET_ID=<secret-id>
```

Use the **Application (client) ID** from Overview — not the **Secret ID** under Certificates & secrets.

Legacy names `HDC_AZURE_ENTRA_CLIENT_ID` / `HDC_AZURE_TENANT_ID` / `HDC_AZURE_CLIENT_ID` still work with a deprecation warning.

Store the secret **value** (shown only once when created):

```bash
hdc secrets set HDC_AZURE_ENTRA_HDC_SECRET_VALUE
```

Legacy vault key `HDC_AZURE_ENTRA_CLIENT_SECRET` (and older `HDC_AZURE_CLIENT_SECRET`) is still read if the per-app key is missing.

## Compute credentials

Separate ARM service principal (Contributor on the target resource group):

```bash
HDC_AZURE_COMPUTE_SUBSCRIPTION_ID=
HDC_AZURE_COMPUTE_TENANT_ID=
HDC_AZURE_COMPUTE_CLIENT_ID=
hdc secrets set HDC_AZURE_COMPUTE_CLIENT_SECRET
```

## Config (hdc-private)

Copy `clumps/infrastructure/azure/config.example.json` to hdc-private as `config.json`. Schema v2 nests sections:

- `entra.applications[]` — optional `$hdc.include` files under `entra/applications/<id>.json`
- `compute.defaults` / `compute.deployments[]` — optional includes under `compute/deployments/<id>.json`

Optional inventory target:

```json
{
  "schema_version": 1,
  "id": "azure",
  "kind": "target",
  "automation_target": "azure",
  "notes": "Entra app registrations + Azure compute via one azure package.",
  "auth": {
    "tenant_id_env": "HDC_AZURE_ENTRA_TENANT_ID",
    "client_id_env": "HDC_AZURE_ENTRA_HDC_APPLICATION_ID",
    "client_secret_vault": "HDC_AZURE_ENTRA_HDC_SECRET_VALUE"
  }
}
```

Path: `inventory/manual/targets/azure.json`

## Entra workflow

1. **Discover:** `hdc run infrastructure azure query -- --section entra`
2. **Import:** `hdc run infrastructure azure query -- --section entra --import --yes` — merges live apps into `entra.applications` (preserves `id` / `managed`; writes `entra/applications/*.json`; skips hdc automation app)
3. Set `"managed": true` on apps you want deploy/maintain to own; prefer `match.client_id`.
4. **Deploy** missing managed apps: `hdc run infrastructure azure deploy -- --section entra`
5. **Maintain** drift: `hdc run infrastructure azure maintain -- --section entra`

## Compute workflow

Before billable deploy, hdc estimates cost (Azure Retail Prices API), prints on stderr / operation report, and prompts unless `--yes` / `--dry-run`.

```bash
hdc run infrastructure azure query -- --section compute --live
hdc run infrastructure azure deploy -- --section compute --instance a --dry-run
hdc run infrastructure azure deploy -- --section compute --instance a
hdc run infrastructure azure maintain -- --section compute
hdc run infrastructure azure teardown -- --section compute --instance a --yes
```

Flags: `--dry-run`, `--yes`, `--accept-unknown-cost`. Estimates exclude egress, snapshots, reserved discounts, and tax.

## Both sections

```bash
hdc run infrastructure azure query -- --section all
```

## Admin consent (Entra)

When `required_resource_access` changes, hdc updates the app registration object. Consent may still require **Grant admin consent** in the Entra portal.

## What hdc does not manage (Entra)

- Client secrets or certificates on managed applications
- Conditional Access policies
- B2C / external identity tenants

## Keycloak Microsoft IdP

Declare a managed app under `entra/applications/keycloak-microsoft-idp.json` (see hdc-private):

1. `hdc run infrastructure azure deploy -- --section entra --app keycloak-microsoft-idp`
2. Pin `match.client_id` from deploy/query output.
3. Create a client secret in Entra; `secrets set HDC_KEYCLOAK_IDP_MICROSOFT_CLIENT_SECRET`.
4. Copy the Application ID into Keycloak realm `identity_providers[].client_id`, then `hdc run service keycloak maintain`.

Redirect URI: `https://<keycloak-host>/realms/<realm>/broker/<alias>/endpoint`.

## Troubleshooting

### `AADSTS700016` — application not found in directory

Check `HDC_AZURE_ENTRA_<APP>_APPLICATION_ID` (default `HDC_AZURE_ENTRA_HDC_APPLICATION_ID`) and `HDC_AZURE_ENTRA_TENANT_ID`. Use the **Application (client) ID** from Entra Overview — not the **Secret ID**. Legacy `HDC_AZURE_ENTRA_CLIENT_ID` still works. Save `.env` on disk before re-running.

### Vaultwarden / `bw` unavailable

Ensure `HDC_AZURE_ENTRA_<APP>_SECRET_VALUE` (default `HDC_AZURE_ENTRA_HDC_SECRET_VALUE`) exists in the vault hdc falls back to (or temporarily in clump `.env`). Legacy `HDC_AZURE_ENTRA_CLIENT_SECRET` / `HDC_AZURE_CLIENT_SECRET` still work.
