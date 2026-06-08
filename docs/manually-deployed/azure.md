# Azure Entra app registrations (hdc)

Microsoft Entra application registrations (client IDs, redirect URIs, API permissions) are managed with the **azure-entra** infrastructure package (`packages/infrastructure/azure-entra/`).

## Bootstrap automation app

Create a dedicated app registration for hdc (for example **HDC Entra Automation**):

1. In [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations** → **New registration**.
2. Supported account types: **Single tenant** (recommended for home/lab).
3. No redirect URI required for this automation app.
4. Under **Certificates & secrets**, create a **client secret** and store it in the hdc vault (never commit).
5. Under **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**:
   - **Application.ReadWrite.All** (required to create and update app registrations you did not create)
6. **Grant admin consent** for the tenant.

Record in `.env`:

```bash
HDC_AZURE_TENANT_ID=<directory-tenant-id>
HDC_AZURE_CLIENT_ID=<automation-app-client-id>
```

Store the secret:

```bash
node tools/hdc/cli.mjs secrets set HDC_AZURE_CLIENT_SECRET
```

## Config (hdc-private)

Copy `packages/infrastructure/azure-entra/config.example.json` to **hdc-private** as `config.json` (same path).

Optional inventory target sidecar in hdc-private:

```json
{
  "schema_version": 1,
  "id": "azure-entra",
  "kind": "target",
  "automation_target": "azure-entra",
  "notes": "Entra app registration automation via Microsoft Graph.",
  "auth": {
    "tenant_id_env": "HDC_AZURE_TENANT_ID",
    "client_id_env": "HDC_AZURE_CLIENT_ID",
    "client_secret_vault": "HDC_AZURE_CLIENT_SECRET"
  }
}
```

Path: `inventory/manual/targets/azure-entra.json`

## Workflow

1. **Discover:** `node tools/hdc/cli.mjs run infrastructure azure-entra query --`
2. Copy `suggested_config_entry` objects from JSON stdout into `applications[]`; set `"managed": true` after review.
3. Prefer `match.client_id` from discovery over display name alone.
4. **Deploy** missing apps: `node tools/hdc/cli.mjs run infrastructure azure-entra deploy --`
5. **Maintain** drift: `node tools/hdc/cli.mjs run infrastructure azure-entra maintain --`

Use `--dry-run` on deploy and maintain to preview Graph changes.

## Admin consent

When `required_resource_access` changes, hdc updates the app registration object. **Delegated/application consent** for those permissions may still require **Grant admin consent** in the Entra portal for each API.

## What hdc does not manage

- Client secrets or certificates on managed applications
- Conditional Access policies
- B2C / external identity tenants
