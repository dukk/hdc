---
name: hdc-runner
description: Use when calling the hdc-runner REST API to run hdc query or maintain jobs, trigger monitor schedules, or read inventory from the automation guest. Do not use for direct SSH or local hdc CLI on operator workstations.
slug: hdc-runner
---

# hdc-runner API skill

Paperclip agents reach homelab automation through **hdc-runner-a** (default `http://192.0.2.125:9120`).

## Company secrets

Bind in Paperclip UI (Settings → Secrets):

| Secret name | Value |
|-------------|-------|
| `HDC_RUNNER_API_URL` | Base URL, e.g. `http://192.0.2.125:9120` |
| `HDC_RUNNER_API_TOKEN` | Same as vault `HDC_HDC_RUNNER_API_TOKEN` |

Every API call:

```http
Authorization: Bearer ${HDC_RUNNER_API_TOKEN}
```

## Quick reference

See `references/api.md` for full route list and `references/curl-examples.md` for copy-paste commands.

## Agent workflow

1. `GET /api/packages` — list packages and allowed verbs
2. `POST /api/jobs` — start ad-hoc job; body `{tier, package, verb, args?}`
3. Poll `GET /api/jobs/:id` until `job.status` is `completed` or `failed`
4. Read `log` for CLI output; post summary to Paperclip issue comment

For curated monitor/security work, prefer schedules:

```http
POST /api/schedules/monitor-uptime-kuma/run
```

Poll returned `job_id` the same way.

## Safety

- Only `query` and `maintain` verbs are exposed (never deploy/teardown)
- Follow `hdc-agent-team` skill for approval rules before `maintain`
- Use safe flags: `--no-reboot`, `--skip-resources`, `--skip-clamav-scan`
- Never run `maintain --prune` without explicit operator approval on the Paperclip issue

## Inventory (read-only)

```http
GET /api/inventory/systems
GET /api/inventory/systems/hdc-runner-a
```

Do not invent hostnames or IPs — use inventory responses.
