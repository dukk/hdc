# hdc-runner Web API

JSON REST API on the hdc-runner guest (default `http://<guest-ip>:9120`). Used by the LAN web UI and by Paperclip agents (Bearer token).

## Authentication

### Bearer token (agents)

Set vault key `HDC_HDC_RUNNER_API_TOKEN` (auto-generated on `hdc-runner maintain`). Send on every request:

```http
Authorization: Bearer <token>
```

Authenticated as synthetic user `api-token`.

### Session cookie (web UI)

```http
POST /api/auth/login
Content-Type: application/json

{"username":"hdc","password":"<HDC_HDC_RUNNER_UI_PASSWORD>"}
```

Response sets `hdc_runner_session` HttpOnly cookie (24h).

### Public

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/health` | `{"ok":true}` |

## Agent workflow

1. `GET /api/packages` — discover tier/package/verb
2. `POST /api/jobs` — start ad-hoc job (202 + `job_id`)
3. Poll `GET /api/jobs/:id` until `job.status` is not `running`
4. Read `log` field for CLI output

Or trigger a named schedule:

```http
POST /api/schedules/monitor-uptime-kuma/run
```

Poll the returned `job_id` the same way.

## Routes

### Auth

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/api/auth/login` | `{username,password}` | Sets cookie |
| POST | `/api/auth/logout` | — | Clears cookie |
| GET | `/api/auth/me` | — | `{user, install_root, private_root, meta_root}` |

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

Default `allowed_verbs`: `query`, `maintain` only. `deploy` and `teardown` are never exposed.

### Packages

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/packages` | Catalog filtered by `allowed_verbs` |

### Inventory (read-only)

| Method | Path |
|--------|------|
| GET | `/api/inventory/:category` | `systems`, `services`, `networks`, `targets` |
| GET | `/api/inventory/:category/:id` | Full sidecar JSON |

## Policy (web-config.json)

| Field | Purpose |
|-------|---------|
| `allowed_verbs` | Ad-hoc verbs (default `query`, `maintain`) |
| `allowed_schedule_ids` | When non-empty, only listed schedules may be run via API |
| `allowed_packages` | When non-empty, entries like `service/uptime-kuma` |
| `max_concurrent_jobs` | Default 1 |

Schedules triggered by cron are not restricted by API allowlists.

## Safety (Paperclip agents)

Align with `hdc-private/operations/delegation-policy.md`:

- **Autonomous:** `query`, monitor/security schedule runs, inventory reads
- **Requires approval:** `maintain` with `--prune`, deploy, teardown, BIND/nginx-waf changes
- **Safe maintain flags:** `--no-reboot`, `--skip-resources`, `--skip-clamav-scan`

## Paperclip HTTP bridge

When enabled on the runner guest (`paperclip_bridge` in hdc-runner config), port **9121**:

```http
POST /paperclip/heartbeat
X-HDC-Bridge-Secret: <HDC_PAPERCLIP_AGENT_BRIDGE_SECRET>
Content-Type: application/json
```

Maps task titles to hdc-runner schedule runs. See `packages/services/paperclip/lib/paperclip-agent-bridge.mjs`.

## Examples

```bash
export RUNNER=http://192.0.2.125:9120
export TOKEN=$(node tools/hdc/cli.mjs secrets get HDC_HDC_RUNNER_API_TOKEN)

curl -s -H "Authorization: Bearer $TOKEN" "$RUNNER/api/schedules" | jq .

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tier":"service","package":"uptime-kuma","verb":"query","args":["--live"]}' \
  "$RUNNER/api/jobs"
```
