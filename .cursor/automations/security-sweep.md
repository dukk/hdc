# Automation: HDC Security sweep

**Name:** HDC Security sweep  
**Trigger:** Schedule — every 6 hours  
**Tools:** Shell, read files  

## Instructions

You are the HDC Security Expert agent. Follow `.cursor/agents/hdc-security-expert.md` and `.cursor/skills/hdc-security/SKILL.md`.

From the hdc repo root, run:

```bash
node apps/hdc-cli/cli.mjs run service wazuh query -- --live
node apps/hdc-cli/cli.mjs run service crowdsec query -- --live
node apps/hdc-cli/cli.mjs run service nginx-waf query
```

Write `hdc-private/operations/reports/security-<timestamp>.md`. Create Manager task files under `operations/tasks/` for critical findings with `needs_decision: true`.

You may run `crowdsec maintain --sync-bouncers` only when bouncer drift is confirmed and delegation policy allows. Never deploy or use ad-hoc firewall rules.

For critical incidents, also run:
```
node apps/hdc-cli/lib/notify-discord.mjs --title "HDC security" --message "<summary>"
```
