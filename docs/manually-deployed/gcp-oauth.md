# GCP OAuth (Google Auth Platform) (hdc)

Google Auth Platform OAuth 2.0 web clients (`*.apps.googleusercontent.com`) for Sign in with Google on self-hosted apps are declared and validated with the **gcp-oauth** infrastructure package (`clumps/infrastructure/gcp-oauth/`).

Google does **not** provide a stable public API to create or update these clients. hdc automates **declaration**, **redirect URI validation**, **drift detection** against Console JSON exports, **vault storage**, and **operator checklists**. Create and edit clients in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

## Config (hdc-private)

Copy `clumps/infrastructure/gcp-oauth/config.example.json` to **hdc-private** as `config.json` (same path).

Set `gcp.project_id` to your GCP project. Each `applications[]` entry lists redirect URIs and optional `derive_from` (nginx-waf hostname + callback path).

## Vault keys

Per application, store credentials after Console create (names only in config; values in vault):

```bash
hdc secrets set HDC_GCP_OAUTH_VAULTWARDEN_CLIENT_ID
hdc secrets set HDC_GCP_OAUTH_VAULTWARDEN_CLIENT_SECRET
```

Or import from a Console download in one step:

```bash
hdc run infrastructure gcp-oauth maintain -- --import ./client_secret_123.json
```

Client secrets are shown **once** at creation in Console — download JSON immediately.

## Workflow

1. **Validate / checklist:** `hdc run infrastructure gcp-oauth maintain -- --dry-run`
2. In Console → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
3. Paste **Authorized redirect URIs** and **Authorized JavaScript origins** from the maintain checklist.
4. Download the client JSON.
5. **Import to vault:** `hdc run infrastructure gcp-oauth maintain -- --import ./downloaded.json`
6. **Verify:** `hdc run infrastructure gcp-oauth query -- --import ./downloaded.json --require-vault`

## Import file format

Console download JSON uses a `web` or `installed` block, for example:

```json
{
  "web": {
    "client_id": "123456789.apps.googleusercontent.com",
    "client_secret": "GOCSPX-...",
    "redirect_uris": ["https://app.example.invalid/callback"],
    "javascript_origins": ["https://app.example.invalid"]
  }
}
```

Match import rows to config apps via `existing_client_id`, `import_match`, or `display_name`.

## Commands

```bash
hdc run infrastructure gcp-oauth query --
hdc run infrastructure gcp-oauth query -- --import ./client.json --require-vault
hdc run infrastructure gcp-oauth maintain -- --dry-run
hdc run infrastructure gcp-oauth maintain -- --import ./client.json
```

Flags: `--app <id>`, `--no-derive`, `--skip-vault`, `--no-report`.

## Limitations

| Client type | hdc v1 |
|-------------|--------|
| Auth Platform (`*.apps.googleusercontent.com`) | Console + import/vault/checklist only |
| IAM Workforce `oauthClients` | Not in scope |
| IAP OAuth clients | Not in scope |

## Related

- Reverse proxy hostnames: `clumps/services/nginx-waf/`
- [AGENTS.md](../../AGENTS.md)
