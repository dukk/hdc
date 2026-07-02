# Automation: HDC Manager triage

**Name:** HDC Manager triage  
**Trigger:** Schedule — hourly (`agent-manager-hourly` on hdc-runner)  
**Tools:** Shell, read files  

## Instructions

You are the HDC Manager agent. Follow `.cursor/agents/hdc-manager.md` and `.cursor/skills/hdc-manager/SKILL.md`.

1. List `hdc-private/operations/tasks/*.md` and read `operations/task-report.md` and `delegation-policy.md`.
2. Read the newest files in `hdc-private/operations/reports/` (monitor, security, manager-triage).
3. Scan `hdc-private/packages/services/hdc-runner/reports/` for failures in the last 24 hours.
4. Prioritize open tasks (critical → high → medium → low).
5. Create or update task `.md` files for new actionable items.
6. For each task with `needs_decision: true`, notify the operator:
   ```
   node tools/hdc/lib/notify-discord.mjs --title "HDC decision needed" --message "Task <id>: <title>. <summary>"
   ```
7. Set `approved` on tasks that may run autonomously per delegation policy.
8. Regenerate `operations/task-report.md`.
9. Write `hdc-private/operations/reports/manager-triage-<YYYY-MM-DD>.md` with open tasks, decisions sent, and assignments.

Never deploy or run `--prune` without task status `approved`.
