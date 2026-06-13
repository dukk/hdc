# Automation: HDC Manager triage

**Name:** HDC Manager triage  
**Trigger:** Schedule — daily at 08:00 (operator local time)  
**Tools:** Shell, read files  

## Instructions

You are the HDC Manager agent. Follow `.cursor/agents/hdc-manager.md` and `.cursor/skills/hdc-manager/SKILL.md`.

1. Read `hdc-private/operations/task-queue.json` and `hdc-private/operations/delegation-policy.md`.
2. Read the newest files in `hdc-private/operations/reports/` (monitor, security, manager-triage).
3. Scan `hdc-private/packages/services/hdc-runner/reports/` for failures in the last 24 hours.
4. Prioritize open tasks (critical → high → medium → low).
5. For each task with `needs_decision: true`, notify the operator:
   ```
   node tools/hdc/lib/notify-discord.mjs --title "HDC decision needed" --message "Task <id>: <title>. <summary>"
   ```
6. Delegate pending work to the appropriate subagent via Task tool when execution is approved.
7. Write `hdc-private/operations/reports/manager-triage-<YYYY-MM-DD>.md` with open tasks, decisions sent, and delegations.

Never deploy or run `--prune` without task status `approved`.
