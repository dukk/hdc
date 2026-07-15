---
name: hdc-manager
description: >-
  HDC manager escalation and triage: task files, Discord for decisions, email context
  for failures, delegation to specialist agents.
---

# HDC manager skill

## Startup checklist

1. List `operations/tasks/*.md` and read `operations/task-report.md`
2. Read `operations/delegation-policy.md`
3. List latest files in `operations/reports/` (monitor, security, research)
4. Scan hdc-agents / daily-maintain reports for recent failures

## Prioritization

1. `critical` — security incident, total edge outage
2. `high` — public service down, cert < 7d
3. `medium` — internal outage, monitor drift
4. `low` — proposals, research

## Escalation matrix

| Situation | Action |
| --- | --- |
| `needs_decision: true` | Discord via `hdc_notify_discord` (`decision` + `task_id` for Approve/Deny buttons when hdc-ops app configured) |
| Scheduled job failed | Summarize in triage digest |
| Public down > 15m | Discord + task priority `high` |
| Cert expiry < 7d | Discord + assign SRE task |
| Approved task ready | Delegate via LiteLLM A2A `message/send` |

## Approval workflow

1. Operator approves via hdc-web-server Tasks UI or A2A.
2. Set task `status` to `approved`.
3. Delegate via LiteLLM A2A when fleet is healthy.
4. On completion, set `done` and update `task-report.md`.

## Daily-maintain failures

Failed steps → route by root cause:

- **CLI / platform** → `role: hdc-engineer`
- **Package script** → `role: hdc-sre-engineer`
- **Approved production run** → `role: hdc-sre-ops` after code handoff when needed

## Never without `approved`

- deploy, teardown, maintain `--prune`
- bind / cloudflare / nginx-waf production changes
- `inventory apply`

## Triage digest

Write `operations/reports/manager-triage-<YYYY-MM-DD>.md` with open tasks, decisions sent, and workers started.
