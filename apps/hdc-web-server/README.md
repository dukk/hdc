# hdc-web-server

LAN web UI and JSON API for HDC, ported from the hdc-runner guest web UI.

## Quick start

```powershell
cd apps/hdc-web-server
npm install
npm run build   # optional Vite SPA → dist/
npm start       # node server.mjs
```

Default listen: `http://0.0.0.0:9120` (`HDC_WEB_PORT`).

Without a Vite build, `/` returns a short HTML notice; `/api/health` still works.

## Environment

| Variable | Legacy fallback | Purpose |
|----------|-----------------|---------|
| `HDC_WEB_UI_SESSION_SECRET` | `HDC_HDC_RUNNER_UI_SESSION_SECRET` | HMAC for session cookie; also encrypts `.htpasswd.enc` |
| `HDC_WEB_ADMIN_PASSWORD` | — | Initial admin password (only when admin user does not exist yet) |
| `HDC_WEB_API_TOKEN` | `HDC_HDC_RUNNER_API_TOKEN` | Bearer token for agents |
| `HDC_WEB_OIDC_ISSUER` | — | Optional SSO: Keycloak realm issuer URL |
| `HDC_WEB_OIDC_CLIENT_ID` | — | OIDC client id (`hdc-web`) |
| `HDC_WEB_OIDC_CLIENT_SECRET` | — | Confidential client secret (vault) |
| `HDC_WEB_PUBLIC_URL` | — | App base URL for OIDC redirect/post-logout |
| `HDC_WEB_OIDC_REDIRECT_URI` | — | Optional override; default `{PUBLIC_URL}/api/auth/oidc/callback` |
| `HDC_WEB_PORT` | `PORT` | Listen port (default 9120) |
| `HDC_ROOT` | `HDC_RUNNER_INSTALL_ROOT` | Public hdc repo root |
| `HDC_PRIVATE_ROOT` | `HDC_RUNNER_PRIVATE_ROOT` | Private repo (or sibling `../hdc-private`) |
| `HDC_WEB_META_ROOT` | `HDC_RUNNER_META_ROOT` | Jobs/schedules dir (default `~/.hdc/web-meta`) |
| `HDC_WEB_LOG_DIR` | `HDC_RUNNER_LOG_DIR` | Schedule logs (default `<meta>/logs`) |

Human login defaults to **encrypted htpasswd** (username/password form). Keycloak OIDC SSO is optional when `HDC_WEB_OIDC_*` is fully configured.

### Password auth (default)

On first start (when `auth.mode` is `htpasswd`, the default), the server creates `{metaRoot}/.htpasswd.enc`:

- Usernames and APR1-MD5 password hashes inside an AES-256-GCM blob (same envelope format as `~/.hdc/vault.enc`).
- Encryption key derived from `HDC_WEB_UI_SESSION_SECRET`.
- Default admin username: `admin` (override in `web-config.json`).
- Password from `HDC_WEB_ADMIN_PASSWORD` when set; otherwise a random password is generated and logged once to stderr.
- If the admin user already exists, the password is never changed (env var is ignored).

Set `auth.mode` to `oidc` in `web-config.json` to disable password login.

**Session secret rotation:** changing `HDC_WEB_UI_SESSION_SECRET` invalidates the encrypted htpasswd file. Delete `.htpasswd.enc` and restart to recreate the admin user, or re-encrypt manually.

Optional `web-config.json` under the meta root:

```json
{
  "auth": {
    "mode": "htpasswd",
    "htpasswd_file": ".htpasswd.enc",
    "admin_username": "admin"
  },
  "allowed_verbs": ["query", "maintain"],
  "allowed_packages": [],
  "allowed_schedule_ids": [],
  "max_concurrent_jobs": 1
}
```

## API

See [API.md](API.md). Public: `GET /api/health`, `GET /api/auth/me`, `POST /api/auth/login`, OIDC login/callback. Auth for other routes: cookie session (`hdc_web_session`) or `Authorization: Bearer`.

## Layout

- `server.mjs` — Node HTTP server
- `lib/` — auth, htpasswd, oidc, jobs, tasks, schedules, inventory, packages
- `web/` — Vite React SPA (Dashboard, Tasks, Schedules, Run package, Jobs, Inventory)
- Tasks use `apps/hdc-agent-server/lib/operations-fs.mjs`

Paperclip bridge and A2A protocol endpoints are **not** included (use hdc-agent-server / LiteLLM).
