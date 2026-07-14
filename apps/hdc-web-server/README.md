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
| `HDC_WEB_OIDC_ISSUER` | — | e.g. `https://keycloak.hdc.dukk.org/realms/dukk-sso` |
| `HDC_WEB_OIDC_CLIENT_ID` | — | OIDC client id (`hdc-web`) |
| `HDC_WEB_OIDC_CLIENT_SECRET` | — | Confidential client secret (vault) |
| `HDC_WEB_PUBLIC_URL` | — | App base URL (`https://hdc.dukk.org`); used for redirect/post-logout |
| `HDC_WEB_OIDC_REDIRECT_URI` | — | Optional override; default `{PUBLIC_URL}/api/auth/oidc/callback` |
| `HDC_WEB_UI_SESSION_SECRET` | `HDC_HDC_RUNNER_UI_SESSION_SECRET` | HMAC for session cookie |
| `HDC_WEB_API_TOKEN` | `HDC_HDC_RUNNER_API_TOKEN` | Bearer token for agents |
| `HDC_WEB_PORT` | `PORT` | Listen port (default 9120) |
| `HDC_ROOT` | `HDC_RUNNER_INSTALL_ROOT` | Public hdc repo root |
| `HDC_PRIVATE_ROOT` | `HDC_RUNNER_PRIVATE_ROOT` | Private repo (or sibling `../hdc-private`) |
| `HDC_WEB_META_ROOT` | `HDC_RUNNER_META_ROOT` | Jobs/schedules dir (default `~/.hdc/web-meta`) |
| `HDC_WEB_LOG_DIR` | `HDC_RUNNER_LOG_DIR` | Schedule logs (default `<meta>/logs`) |

Human login is **SSO-only** (Keycloak). Shared password login is removed.

Optional `web-config.json` under the meta root: `allowed_verbs`, `allowed_packages`, `allowed_schedule_ids`, `max_concurrent_jobs`, `host`, `port`.

## API

See [API.md](API.md). Public: `GET /api/health`, `GET /api/auth/me`, OIDC login/callback. Auth for other routes: cookie session (`hdc_web_session`) or `Authorization: Bearer`.

## Layout

- `server.mjs` — Node HTTP server
- `lib/` — auth, oidc, jobs, tasks, schedules, inventory, packages
- `web/` — Vite React SPA (Dashboard, Tasks, Schedules, Run package, Jobs, Inventory)
- Tasks use `apps/hdc-agent-server/lib/operations-fs.mjs`

Paperclip bridge and A2A protocol endpoints are **not** included (use hdc-agent-server / LiteLLM).
