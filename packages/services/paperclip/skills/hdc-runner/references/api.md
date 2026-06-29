# hdc-runner API routes

Base URL: company secret `HDC_RUNNER_API_URL` (LAN only).

Auth: `Authorization: Bearer ${HDC_RUNNER_API_TOKEN}`

## Public

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/health` | `{"ok":true}` |

## Schedules

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/schedules` | Cron, last run, exit code |
| GET | `/api/schedules/:id/log` | Optional `?parsed=1` |
| POST | `/api/schedules/:id/run` | Returns 202 `{job_id,pid}` |

Known schedule ids on hdc-runner-a:

- `monitor-uptime-kuma`
- `monitor-cluster`
- `security-crowdsec`
- `security-wazuh`
- `security-waf`
- `daily-digest`
- `public-edge`, `public-static`, `public-apps`, `public-homeassistant`

## Jobs

| Method | Path | Body |
|--------|------|------|
| GET | `/api/jobs` | — |
| POST | `/api/jobs` | `{tier, package, verb, args?}` |
| GET | `/api/jobs/:id` | `{job, log, log_bytes}` |

## Packages and inventory

| Method | Path |
|--------|------|
| GET | `/api/packages` |
| GET | `/api/inventory/:category` |
| GET | `/api/inventory/:category/:id` |

Categories: `systems`, `services`, `networks`, `targets`.

Full doc: `packages/services/hdc-runner/API.md` in the hdc repo.
