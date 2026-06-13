---
name: hdc-manager
description: >-
  HDC manager escalation and triage: task queue, Discord for decisions, email context
  for failures, delegation to subagents. Use with hdc-manager subagent or triage automations.
disable-model-invocation: true
---

# HDC manager skill

## Startup checklist

1. Read `hdc-private/operations/task-queue.json`
2. Read `hdc-private/operations/delegation-policy.md`
3. List latest files in `operations/reports/` (monitor, security, research)
4. Scan `packages/services/hdc-runner/reports/` for recent failures (hdc-private)

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
| Approved task ready | Delegate `@hdc-sre` with task id |

## Discord notify

```bash
node tools/hdc/lib/notify-discord.mjs --title "HDC decision needed" --message "Task <id>: …"
```

Vault key: `HDC_OPS_DISCORD_WEBHOOK_URL` (Discord channel webhook URL).

## Approval workflow

1. Operator replies in Cursor chat (or Discord thread if wired later).
2. Set task `status` to `approved`.
3. Delegate to role in task (`hdc-sre` most common).
4. On completion, set `done` and reference operation report path.

## Never without `approved`

- deploy, teardown, maintain `--prune`
- bind / cloudflare / nginx-waf production changes
- `inventory apply`

## Daily triage output

Optional: `operations/reports/manager-triage-<YYYY-MM-DD>.md` with open tasks, decisions needed, and delegated work.
