---
name: hdc-manager
description: >-
  HDC manager escalation and triage: task files, per-route notifications (email/Discord/Slack/Teams/Telegram),
  delegation to specialist agents.
---

# HDC manager skill

## Startup checklist

1. List `operations/tasks/*.md` and read `operations/task-report.md`
2. Read `operations/delegation-policy.md`
3. List latest files in `operations/reports/` (monitor, security, research)
4. Scan hdc-agents / daily-maintain reports for recent failures
5. Check clump repo sync state (`hdc_list`); run `hdc_clumps_sync` after sre-engineer handoffs before delegating sre-ops

## Prioritization

1. `critical` — security incident, total edge outage
2. `high` — public service down, cert < 7d
3. `medium` — internal outage, monitor drift
4. `low` — proposals, research

## Escalation matrix

| Situation | Action |
| --- | --- |
| `needs_decision: true` | Scripted dispatcher → `notifications.routes.needs_decision` (email, Discord, Slack, Teams, or Telegram). See [manager-notifications.md](../../../../docs/manually-deployed/manager-notifications.md) |
| Scheduled job failed | Summarize in triage digest |
| Public down > 15m | High-priority task + route per `notifications.routes` (default Discord) |
| Cert expiry < 7d | High-priority task + route per `notifications.routes` (default Discord) |
| Approved task ready | Delegate via LiteLLM A2A `message/send` |

## Approval workflow

1. Operator approves via hdc-web-server Tasks UI or A2A.
2. Set task `status` to `approved`.
3. Delegate via LiteLLM A2A when fleet is healthy.
4. On completion, set `done` and update `task-report.md`.

## Daily-maintain failures

Failed steps → route by root cause:

- **CLI / platform** → `role: hdc-engineer`
- **Package script** → `role: hdc-sre-engineer` (then manager `hdc_clumps_sync` before sre-ops)
- **Approved production run** → `role: hdc-sre-ops` after code handoff and manager sync when needed

## Unknown capability (new or missing automation)

When the operator asks for something the fleet may not know how to do (no matching clump, unclear install path, greenfield service):

1. Create a **`hdc-sre-engineer`** task to scaffold or modify the package (build-only — no deploy in `suggested_commands`).
2. Create a **`hdc-engineer`** task only when CLI schemas, shared `hdc/package/*`, or agent-server support is also required.
3. Do **not** invent package design yourself — engineers use `hdc_web_*` and/or `hdc_request_research`.
4. After sre-engineer pushes hdc-clumps, run `hdc_clumps_sync`, then open **hdc-sre-ops** with `needs_decision` / await `approved` for live deploy.

## Never without `approved`

- deploy, teardown, maintain `--prune`
- bind / cloudflare / nginx-waf production changes
- `inventory apply`

## Triage digest

Write `operations/reports/manager-triage-<YYYY-MM-DD>.md` with open tasks, decisions sent, and workers started.
