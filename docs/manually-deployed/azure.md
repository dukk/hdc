# Azure app registrations (hdc)

Microsoft Entra application registrations (client IDs, redirect URIs, API permissions) are managed with the **azure** infrastructure package (`clumps/infrastructure/azure/`).

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
node apps/hdc-cli/cli.mjs secrets set HDC_AZURE_CLIENT_SECRET
```

## Config (hdc-private)

Copy `clumps/infrastructure/azure/config.example.json` to **hdc-private** as `config.json` (same path).

Optional inventory target sidecar in hdc-private:

```json
{
  "schema_version": 1,
  "id": "azure",
  "kind": "target",
  "automation_target": "azure",
  "notes": "Entra app registration automation via Microsoft Graph.",
  "auth": {
    "tenant_id_env": "HDC_AZURE_TENANT_ID",
    "client_id_env": "HDC_AZURE_CLIENT_ID",
    "client_secret_vault": "HDC_AZURE_CLIENT_SECRET"
  }
}
```

Path: `inventory/manual/targets/azure.json`

## Workflow

1. **Discover:** `node apps/hdc-cli/cli.mjs run infrastructure azure query --`
2. **Bootstrap import:** `node apps/hdc-cli/cli.mjs run infrastructure azure query -- --import --yes` (replaces `applications[]` from live tenant; `managed: false`; skips hdc automation app)
3. Or copy `suggested_config_entry` objects from JSON stdout into `applications[]`; set `"managed": true` after review.
4. Prefer `match.client_id` from discovery over display name alone.
5. **Deploy** missing apps: `node apps/hdc-cli/cli.mjs run infrastructure azure deploy --`
6. **Maintain** drift: `node apps/hdc-cli/cli.mjs run infrastructure azure maintain --`

Use `--dry-run` on deploy and maintain to preview Graph changes.

## Admin consent

When `required_resource_access` changes, hdc updates the app registration object. **Delegated/application consent** for those permissions may still require **Grant admin consent** in the Entra portal for each API.

## What hdc does not manage

- Client secrets or certificates on managed applications (create in Entra portal; store consumer secrets in the hdc vault)
- Conditional Access policies
- B2C / external identity tenants

## Keycloak Microsoft IdP

For Keycloak to broker Microsoft sign-in, declare a managed app (see hdc-private `clumps/infrastructure/azure/config.json` `keycloak-microsoft-idp`):

1. `node apps/hdc-cli/cli.mjs run infrastructure azure deploy -- --app keycloak-microsoft-idp`
2. Pin `match.client_id` to the Application (client) ID from deploy/query output.
3. In Entra → app → **Certificates & secrets**, create a client secret; `node apps/hdc-cli/cli.mjs secrets set HDC_KEYCLOAK_IDP_MICROSOFT_CLIENT_SECRET`.
4. Copy the same Application ID into the Keycloak realm `identity_providers[].client_id` (e.g. `dukk-sso`), then `hdc run service keycloak maintain`.
5. Grant admin consent for Microsoft Graph delegated scopes when prompted.

Redirect URI shape: `https://<keycloak-host>/realms/<realm>/broker/<alias>/endpoint` (alias `microsoft` by default).

See [Keycloak README](../../clumps/services/keycloak/README.md).

## Troubleshooting

### `AADSTS700016` — application not found in directory

Azure rejected `HDC_AZURE_CLIENT_ID` for tenant `HDC_AZURE_TENANT_ID`. Common causes:

1. **Wrong Application (client) ID** — In [Entra admin center](https://entra.microsoft.com/) → **App registrations** → your automation app → **Overview**, copy **Application (client) ID** (not Object ID, not a secret value, not an Enterprise application ID).
2. **Wrong tenant** — On **Microsoft Entra ID** → **Overview**, copy **Tenant ID** for the same directory where the app is registered. Personal/work tenants differ; switch directory in the portal header if needed.
3. **App not created yet** — Create **HDC Entra Automation** per the bootstrap section above, then update `.env` and `secrets set HDC_AZURE_CLIENT_SECRET`.
4. **Unsaved `.env`** — hdc reads the file on disk. Save `.env` in the editor before re-running; a stale value on disk overrides what you see in an unsaved buffer.

`hdc run infrastructure azure query` logs `tenant …, client_id …` on stderr so you can confirm which IDs were used.

### Vaultwarden / `bw` unavailable

If stderr shows `Vaultwarden backend unavailable … using local vault for HDC_AZURE_CLIENT_SECRET`, hdc fell back to `~/.hdc/vault.enc`. Ensure the secret exists: `node apps/hdc-cli/cli.mjs secrets set HDC_AZURE_CLIENT_SECRET`. Fix `bw` TLS separately if `HDC_VAULTWARDEN_URL` presents the wrong certificate.
