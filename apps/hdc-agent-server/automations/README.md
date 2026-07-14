# Automations (hdc-agent-server)

Scripted triggers for the agent fleet. **Primary execution** is the container dispatcher in `lib/dispatcher.mjs` — timers run frequently; the LLM is invoked only when work is detected.

| Spec | Role | Default interval | LLM when |
| --- | --- | --- | --- |
| [manager-triage.md](manager-triage.md) | hdc-manager | 15m | New reports/failures, or after scripting enqueues worker prompts |
| [manager-mailbox.md](manager-mailbox.md) | hdc-manager | with triage tick | Never (IMAP → tasks / UniFi block handoff) |
| [monitor-sweep.md](monitor-sweep.md) | hdc-monitor | 60m | Query digest changes vs watermark |
| [security-sweep.md](security-sweep.md) | hdc-security-expert | 120m | Security query signal / novel alerts |
| [research-weekly.md](research-weekly.md) | hdc-research | 7d | Weekly gate open |

hdc-web-server on hdc-agents-a (`:9120`) is the operator Tasks / jobs UI. Agent ticks are owned by the scripted dispatcher.
