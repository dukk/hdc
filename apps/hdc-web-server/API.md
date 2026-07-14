# hdc-web-server Web API

JSON REST API (default `http://localhost:9120`). Ported from hdc-runner; Paperclip bridge and A2A are not served here.

## Authentication

### Bearer token (agents)

Prefer `HDC_WEB_API_TOKEN` (legacy `HDC_HDC_RUNNER_API_TOKEN`). Send on every request:

```http
Authorization: Bearer <token>
```

Authenticated as synthetic user `api-token`.

### OIDC SSO (web UI)

Human login uses Keycloak (Authorization Code + PKCE) via the BFF:

1. `GET /api/auth/oidc/login` → 302 to the IdP
2. IdP returns to `GET /api/auth/oidc/callback`
3. Server exchanges the code, loads userinfo, sets `hdc_web_session` HttpOnly cookie (24h)

Env: `HDC_WEB_OIDC_ISSUER`, `HDC_WEB_OIDC_CLIENT_ID`, `HDC_WEB_OIDC_CLIENT_SECRET`, `HDC_WEB_PUBLIC_URL` (or `HDC_WEB_OIDC_REDIRECT_URI`), plus `HDC_WEB_UI_SESSION_SECRET`.

`POST /api/auth/login` (password) returns **410 Gone**.

### Public

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/health` | `{"ok":true}` |
| GET | `/api/auth/me` | `{user, oidc_configured, …}` (`user` may be null) |
| GET | `/api/auth/oidc/login` | 302 to IdP |
| GET | `/api/auth/oidc/callback` | 302 to app with session cookie |
| POST | `/api/discord/interactions` | Discord Interactions (Ed25519-verified). Requires `HDC_OPS_DISCORD_PUBLIC_KEY`. Handles PING and hdc-ops Approve/Deny message components (`custom_id` `hdc:approve:<taskId>` / `hdc:deny:<taskId>`), patching task status like the Tasks UI (`approved` / `blocked`). |

## Routes

### Auth

| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/api/auth/oidc/login` | — | Start SSO |
| GET | `/api/auth/oidc/callback` | — | OIDC redirect; sets cookie |
| POST | `/api/auth/login` | — | **410** — password login removed |
| POST / GET | `/api/auth/logout` | — | Clears cookie; may return `logout_url` for IdP end-session |
| GET | `/api/auth/me` | — | `{user, install_root, private_root, meta_root, oidc_configured}` |

### Schedules

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/schedules` | List with cron, last run, exit code |
| GET | `/api/schedules/:id/log` | Query: `parsed=1`, `offset`, `limit` |
| POST | `/api/schedules/:id/run` | 202 `{job_id,pid}`; subject to `allowed_schedule_ids` |

### Jobs

| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/api/jobs` | — | Up to 50 recent jobs |
| POST | `/api/jobs` | See below | 202; subject to `allowed_verbs` and `allowed_packages` |
| GET | `/api/jobs/:id` | — | `{job, log, log_bytes}` |

**POST /api/jobs body:**

```json
{
  "tier": "service",
  "package": "uptime-kuma",
  "verb": "query",
  "args": ["--live"]
}
```

Or `"args_string": "--live"` (shell metacharacters rejected).

Default `allowed_verbs`: `query`, `maintain` only. `deploy` and `teardown` are never exposed via default policy.

### Packages

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/packages` | Catalog filtered by `allowed_verbs` |

### Inventory (read-only)

| Method | Path |
|--------|------|
| GET | `/api/inventory/:category` | `systems`, `services`, `networks`, `targets` |
| GET | `/api/inventory/:category/:id` | Full sidecar JSON |

### Agent tasks

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/agents` | Yes | Agent roster |
| GET | `/api/tasks` | Yes | List tasks (frontmatter summary) |
| GET | `/api/tasks/report` | Yes | Raw `task-report.md` |
| GET | `/api/tasks/:id` | Yes | Task metadata + body |
| PATCH | `/api/tasks/:id` | Session only | Approve/block |
| POST | `/api/tasks/:id/run` | Yes | Spawn agent-task job (202 + `job_id`) |

Task files live under hdc-private `operations/tasks/` via `operations-fs.mjs`.

Discord buttons call the same status write path as PATCH (internal user `discord`).
Deny sets `status: blocked` and `blocked_reason: Operator declined via Discord`.
