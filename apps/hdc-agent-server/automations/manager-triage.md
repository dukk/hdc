# Automation: HDC Manager triage

**Role:** hdc-manager  
**Trigger:** Scripted dispatcher every ~15m (`HDC_AGENT_SCHEDULE_MINUTES`)  
**Runtime:** hdc-agent-server (LiteLLM tool loop)

## Scripted (no LLM)

1. List `operations/tasks/*.md`; regenerate `operations/task-report.md`.
2. Discord-notify tasks with `needs_decision: true` not yet flagged in the notify watermark.
3. Build worker prompts for `approved` tasks and query-only auto-run pending tasks.

## LLM (only if needed)

- Short triage when new files appear under `operations/reports/` or recent hdc-agents/daily-maintain failure reports since the last manager watermark.
- Per-worker turns for runnable tasks (separate enqueues).

Never deploy or run `--prune` without task status `approved`.
