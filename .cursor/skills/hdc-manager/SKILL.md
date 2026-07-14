---
name: hdc-manager
description: >-
  HDC manager escalation and triage: task files, Discord for decisions, email context
  for failures, delegation to subagents. Use with hdc-manager subagent or triage automations.
disable-model-invocation: true
---

# HDC manager skill

## Startup checklist

1. List `hdc-private/operations/tasks/*.md` and read `operations/task-report.md`
2. Read `hdc-private/operations/delegation-policy.md`
3. List latest files in `operations/reports/` (monitor, security, research)
4. Scan `clumps/services/hdc-runner/reports/` for recent failures (hdc-private)

## Prioritization

1. `critical` — security incident, total edge outage
2. `high` — public service down, cert < 7d
3. `medium` — internal outage, monitor drift
4. `low` — proposals, research

## Escalation matrix

| Situation | Action |
| --- | --- |
| `needs_decision: true` | Discord via notify script |
| hdc-runner job failed | Rely on postfix-relay email; summarize in triage digest |
| Public down > 15m | Discord + task priority `high` |
| Cert expiry < 7d (nginx-waf query) | Discord + assign SRE task |
| Approved task ready | Spawn worker agent (guest) or delegate `@hdc-sre` (IDE) |

## Discord notify

```bash
node apps/hdc-cli/lib/notify-discord.mjs --title "HDC decision needed" --message "Task <id>: …"
```

Vault key: `HDC_OPS_DISCORD_WEBHOOK_URL` (Discord channel webhook URL).

## Task file CRUD

Create `operations/tasks/<id>.md` with YAML frontmatter (see hdc-agent-team skill). After changes, regenerate `operations/task-report.md`.

## Approval workflow

1. Operator approves via web UI (`PATCH /api/tasks/:id`), A2A, or Cursor chat.
2. Set task `status` to `approved` in frontmatter.
3. Primary: delegate via LiteLLM A2A (`POST /a2a/<role>`) when hdc-agents fleet is healthy.
4. Fallback: on hdc-runner, manager orchestrator spawns `agent -p` for the task's `role`.
5. On completion, set `done` and update `task-report.md`.

## Daily-maintain failures → hdc-engineer

Failed steps in daily-maintain / deploy operation reports → create `role: hdc-engineer` tasks with report paths as `evidence`. Do not assign `hdc-sre` until the engineer handoff says the package is ready.

## Never without `approved`

- deploy, teardown, maintain `--prune`
- bind / cloudflare / nginx-waf production changes
- `inventory apply`

## Hourly triage output

Write `operations/reports/manager-triage-<YYYY-MM-DD>.md` with open tasks, decisions sent, and worker runs started.
