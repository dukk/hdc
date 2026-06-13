# HDC Cursor Automations

Draft specifications for scheduled agents. Create each automation in the **Cursor Automations** editor (Agents Window) using these prompts and triggers.

After creating an automation, ensure the hdc + hdc-private workspace is open so agents can read `operations/` and run `node tools/hdc/cli.mjs`.

| File | Trigger | Role |
| --- | --- | --- |
| [manager-triage.md](manager-triage.md) | Daily 08:00 local | hdc-manager |
| [monitor-sweep.md](monitor-sweep.md) | Every 4 hours | hdc-monitor |
| [security-sweep.md](security-sweep.md) | Every 6 hours | hdc-security-expert |
| [research-weekly.md](research-weekly.md) | Weekly Sun 10:00 | hdc-research |

**Tools:** Enable shell/terminal and file read for all. Research automation may use web search.

**Discord:** Manager automation should run `node tools/hdc/lib/notify-discord.mjs` when tasks have `needs_decision: true` (requires vault `HDC_OPS_DISCORD_WEBHOOK_URL`).

**Email:** hdc-runner cron jobs email failures via postfix-relay automatically; Manager summarizes but does not duplicate unless asked.
